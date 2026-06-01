"""Командный чат: REST + WebSocket.

Архитектура:
- Multi-tenant: все запросы строго фильтруются по org_id из JWT.
- Непрочитанные считаются через chat_members.last_read_at (корректно для групп).
- ConnectionManager хранит активные WebSocket в памяти процесса.
  Backend запускается в 1 воркер uvicorn (см. deploy/podotchetpro.service);
  при росте нагрузки заменить на Redis pub/sub.
"""
import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from auth import decode_token, get_current_user, require_admin
from database import SessionLocal, get_db
from models import ChatMember, ChatMessage, ChatRoom, User
from services.push_service import build_payload, send_push_to_user_async
from schemas import (
    ChatDirectCreate,
    ChatMessageCreate,
    ChatMessageOut,
    ChatRoomCreate,
    ChatRoomMemberOut,
    ChatRoomOut,
)


router = APIRouter(prefix="/api/chat", tags=["chat"])


# ===================== ConnectionManager =====================

class ConnectionManager:
    """Один (room_id) -> список (user_id, WebSocket).

    Один пользователь может держать несколько вкладок — храним списком.
    """

    def __init__(self) -> None:
        # room_id -> list of (user_id, websocket)
        self._rooms: dict[int, list[tuple[int, WebSocket]]] = defaultdict(list)

    async def connect(self, room_id: int, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._rooms[room_id].append((user_id, ws))

    def disconnect(self, room_id: int, ws: WebSocket) -> None:
        bucket = self._rooms.get(room_id)
        if not bucket:
            return
        self._rooms[room_id] = [(uid, w) for (uid, w) in bucket if w is not ws]
        if not self._rooms[room_id]:
            self._rooms.pop(room_id, None)

    async def broadcast(self, room_id: int, payload: dict) -> None:
        bucket = list(self._rooms.get(room_id, []))
        for _, ws in bucket:
            try:
                await ws.send_json(payload)
            except Exception:
                # сокет уже мёртв — удалим тихо
                self.disconnect(room_id, ws)


manager = ConnectionManager()


# ===================== Хелперы =====================

def _ensure_member(db: Session, room_id: int, user: User) -> ChatRoom:
    """Комната должна принадлежать org текущего юзера и юзер должен быть её участником."""
    room = db.get(ChatRoom, room_id)
    if not room or room.org_id != user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Комната не найдена")
    is_member = db.query(ChatMember).filter_by(room_id=room_id, user_id=user.id).first()
    if not is_member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Вы не участник этой комнаты")
    return room


def _direct_room_name(a: User, b: User, viewer_id: int) -> str:
    """В direct-чате имя комнаты — имя собеседника с точки зрения смотрящего."""
    other = b if a.id == viewer_id else a
    return other.name


def _message_to_out(msg: ChatMessage, sender_name: str, db: Session) -> ChatMessageOut:
    reply_preview = None
    reply_sender_name = None
    if msg.reply_to_id:
        parent = db.get(ChatMessage, msg.reply_to_id)
        if parent:
            reply_preview = parent.content[:120]
            parent_sender = db.get(User, parent.sender_id)
            reply_sender_name = parent_sender.name if parent_sender else None
    return ChatMessageOut(
        id=msg.id,
        room_id=msg.room_id,
        sender_id=msg.sender_id,
        sender_name=sender_name,
        content=msg.content,
        reply_to_id=msg.reply_to_id,
        reply_preview=reply_preview,
        reply_sender_name=reply_sender_name,
        created_at=msg.created_at,
    )


def _room_to_out(room: ChatRoom, viewer: User, db: Session) -> ChatRoomOut:
    members_rows = (
        db.query(ChatMember, User)
        .join(User, User.id == ChatMember.user_id)
        .filter(ChatMember.room_id == room.id)
        .all()
    )
    members = [
        ChatRoomMemberOut(user_id=u.id, name=u.name, role=u.role) for (_, u) in members_rows
    ]

    last_msg = (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id == room.id)
        .order_by(ChatMessage.created_at.desc())
        .first()
    )
    last_out = None
    if last_msg:
        sender = db.get(User, last_msg.sender_id)
        last_out = _message_to_out(last_msg, sender.name if sender else "—", db)

    # last_read_at для viewer
    own_member = next((m for (m, _) in members_rows if m.user_id == viewer.id), None)
    last_read = own_member.last_read_at if own_member else None
    q = db.query(sa_func.count(ChatMessage.id)).filter(
        ChatMessage.room_id == room.id,
        ChatMessage.sender_id != viewer.id,  # свои сообщения не считаем непрочитанными
    )
    if last_read is not None:
        q = q.filter(ChatMessage.created_at > last_read)
    unread = int(q.scalar() or 0)

    display_name = room.name
    if room.room_type == "direct":
        # для direct показываем имя собеседника
        other = next(
            (u for (m, u) in members_rows if u.id != viewer.id),
            None,
        )
        if other:
            display_name = other.name

    return ChatRoomOut(
        id=room.id,
        name=display_name,
        room_type=room.room_type,
        members=members,
        last_message=last_out,
        unread_count=unread,
    )


# ===================== REST: комнаты =====================

@router.get("/rooms", response_model=list[ChatRoomOut])
def list_rooms(db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    rooms = (
        db.query(ChatRoom)
        .join(ChatMember, ChatMember.room_id == ChatRoom.id)
        .filter(ChatRoom.org_id == me.org_id, ChatMember.user_id == me.id)
        .order_by(ChatRoom.created_at.desc())
        .all()
    )
    return [_room_to_out(r, me, db) for r in rooms]


@router.post("/rooms", response_model=ChatRoomOut, status_code=status.HTTP_201_CREATED)
def create_group_room(
    payload: ChatRoomCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Создать групповую комнату. Только admin своей организации."""
    room = ChatRoom(
        org_id=admin.org_id,
        name=payload.name,
        room_type="group",
        created_by_id=admin.id,
    )
    db.add(room)
    db.flush()

    # admin всегда участник
    user_ids: set[int] = {admin.id}
    if payload.member_ids:
        # фильтруем — все user_id должны быть в той же org
        ok_users = (
            db.query(User.id)
            .filter(User.org_id == admin.org_id, User.id.in_(payload.member_ids))
            .all()
        )
        user_ids.update(uid for (uid,) in ok_users)

    for uid in user_ids:
        db.add(ChatMember(room_id=room.id, user_id=uid))

    db.commit()
    db.refresh(room)
    return _room_to_out(room, admin, db)


@router.post(
    "/rooms/direct",
    response_model=ChatRoomOut,
    status_code=status.HTTP_200_OK,
)
def create_or_get_direct(
    payload: ChatDirectCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Создать direct-чат или вернуть существующий между me и payload.user_id."""
    if payload.user_id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя создать чат с самим собой")

    other = db.get(User, payload.user_id)
    if not other or other.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    # Ищем существующий direct: комната room_type=direct, в которой ровно эти два user_id
    m1 = db.query(ChatMember).filter_by(user_id=me.id).subquery()
    m2 = db.query(ChatMember).filter_by(user_id=other.id).subquery()
    existing = (
        db.query(ChatRoom)
        .join(m1, m1.c.room_id == ChatRoom.id)
        .join(m2, m2.c.room_id == ChatRoom.id)
        .filter(ChatRoom.org_id == me.org_id, ChatRoom.room_type == "direct")
        .first()
    )
    if existing:
        return _room_to_out(existing, me, db)

    room = ChatRoom(
        org_id=me.org_id,
        name=other.name,  # для UI; фактическое отображение строится динамически
        room_type="direct",
        created_by_id=me.id,
    )
    db.add(room)
    db.flush()
    db.add(ChatMember(room_id=room.id, user_id=me.id))
    db.add(ChatMember(room_id=room.id, user_id=other.id))
    db.commit()
    db.refresh(room)
    return _room_to_out(room, me, db)


# ===================== REST: сообщения =====================

@router.get("/rooms/{room_id}/messages", response_model=list[ChatMessageOut])
def get_messages(
    room_id: int,
    before: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    _ensure_member(db, room_id, me)
    q = db.query(ChatMessage).filter(ChatMessage.room_id == room_id)
    if before:
        q = q.filter(ChatMessage.created_at < before)
    rows = q.order_by(ChatMessage.created_at.desc()).limit(limit).all()
    rows = list(reversed(rows))  # вернём по возрастанию времени
    out: list[ChatMessageOut] = []
    for msg in rows:
        sender = db.get(User, msg.sender_id)
        out.append(_message_to_out(msg, sender.name if sender else "—", db))
    return out


@router.post("/rooms/{room_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    room_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    _ensure_member(db, room_id, me)
    member = (
        db.query(ChatMember).filter_by(room_id=room_id, user_id=me.id).first()
    )
    if member:
        member.last_read_at = datetime.now(tz=timezone.utc).replace(tzinfo=None)
        db.commit()
    return None


# ===================== WebSocket =====================

@router.websocket("/ws/{room_id}")
async def chat_ws(websocket: WebSocket, room_id: int, token: str = Query(...)):
    """WebSocket-соединение для конкретной комнаты.

    Авторизация: ?token=<JWT>. Заголовки в браузерных WS недоступны.
    При подключении отдаёт последние 50 сообщений. Затем broadcast'ит новые.
    """
    # 1) валидируем токен
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub", 0))
    except HTTPException:
        await websocket.close(code=4401)
        return

    # 2) валидируем доступ к комнате (своя сессия — WS вне зоны действия Depends(get_db))
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user or not user.is_active:
            await websocket.close(code=4401)
            return
        room = db.get(ChatRoom, room_id)
        if not room or room.org_id != user.org_id:
            await websocket.close(code=4404)
            return
        member = (
            db.query(ChatMember).filter_by(room_id=room_id, user_id=user.id).first()
        )
        if not member:
            await websocket.close(code=4403)
            return

        # 3) принимаем соединение и шлём историю
        await manager.connect(room_id, user.id, websocket)
        history = (
            db.query(ChatMessage)
            .filter(ChatMessage.room_id == room_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(50)
            .all()
        )
        history = list(reversed(history))
        await websocket.send_json(
            {
                "type": "history",
                "messages": [
                    _message_to_out(
                        m,
                        (db.get(User, m.sender_id).name if db.get(User, m.sender_id) else "—"),
                        db,
                    ).model_dump(mode="json")
                    for m in history
                ],
            }
        )
    except Exception:
        await websocket.close(code=1011)
        db.close()
        return

    # 4) основной цикл — приём сообщений
    try:
        while True:
            data = await websocket.receive_json()
            # ожидаем {type:"message", content:"...", reply_to_id?:int}
            if data.get("type") != "message":
                continue
            content = (data.get("content") or "").strip()
            if not content:
                continue
            if len(content) > 4000:
                content = content[:4000]

            reply_to_id = data.get("reply_to_id")
            if reply_to_id is not None:
                parent = db.get(ChatMessage, reply_to_id)
                if not parent or parent.room_id != room_id:
                    reply_to_id = None  # игнорируем мусор

            msg = ChatMessage(
                room_id=room_id,
                sender_id=user.id,
                content=content,
                reply_to_id=reply_to_id,
            )
            db.add(msg)
            db.commit()
            db.refresh(msg)

            out = _message_to_out(msg, user.name, db).model_dump(mode="json")
            await manager.broadcast(room_id, {"type": "message", "message": out})

            # Web Push всем участникам комнаты, кроме отправителя.
            # Создаём в фоне, не ждём — иначе блокируется WS-цикл.
            recipient_ids = [
                uid for (uid,) in db.query(ChatMember.user_id)
                .filter(ChatMember.room_id == room_id, ChatMember.user_id != user.id)
                .all()
            ]
            if recipient_ids:
                payload = build_payload("chat_message", {
                    "sender_name": user.name,
                    "content": content,
                })
                for rid in recipient_ids:
                    asyncio.create_task(send_push_to_user_async(rid, user.org_id, payload))
    except WebSocketDisconnect:
        pass
    except Exception:
        # любая другая ошибка — закрываем тихо
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        manager.disconnect(room_id, websocket)
        db.close()
