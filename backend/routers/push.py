"""Web Push (VAPID): регистрация/удаление подписок браузера + публичный ключ."""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from auth import get_current_user
from config import get_settings
from database import get_db
from models import PushSubscription, User
from schemas import PushSubscribePayload, PushUnsubscribePayload


router = APIRouter(prefix="/api/push", tags=["push"])
settings = get_settings()


@router.get("/vapid-public-key")
def get_vapid_public_key() -> dict[str, str]:
    """VAPID public key для фронта. Если пусто — push на сервере не настроен."""
    return {"publicKey": settings.vapid_public_key or ""}


@router.post("/subscribe", status_code=status.HTTP_200_OK)
def subscribe(
    payload: PushSubscribePayload,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
) -> dict[str, str]:
    """Сохранить push-подписку текущего юзера. Идемпотентно: если этот endpoint
    уже есть в БД (тот же браузер) — переписываем ключи и user."""
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == payload.endpoint)
        .first()
    )
    if existing:
        existing.org_id = me.org_id
        existing.user_id = me.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        existing.user_agent = payload.user_agent
    else:
        db.add(
            PushSubscription(
                org_id=me.org_id,
                user_id=me.id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
                user_agent=payload.user_agent,
            )
        )
    db.commit()
    return {"status": "ok"}


@router.post("/unsubscribe", status_code=status.HTTP_200_OK)
def unsubscribe(
    payload: PushUnsubscribePayload,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
) -> dict[str, str]:
    """Удалить подписку этого endpoint'а (юзер выключил уведомления в UI)."""
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == payload.endpoint,
        PushSubscription.user_id == me.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"status": "ok"}


@router.get("/status")
def get_status(
    endpoint: str = "",
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Проверка: подписан ли этот браузер. Фронт сверяет endpoint своего
    PushSubscription с тем, что в БД — на случай если подписка была отозвана
    с другого устройства."""
    if not endpoint:
        return {"subscribed": False}
    row = (
        db.query(PushSubscription.id)
        .filter(
            PushSubscription.endpoint == endpoint,
            PushSubscription.user_id == me.id,
        )
        .first()
    )
    return {"subscribed": row is not None}
