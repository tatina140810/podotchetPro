"""Web Push (VAPID) — отправка через pywebpush.

Использование:
  - HTTP-роутер: `background_tasks.add_task(send_push_to_user_sync, user_id, org_id, payload)`
  - WebSocket-handler (async): `asyncio.create_task(send_push_to_user_async(user_id, org_id, payload))`

build_payload даёт стандартизированную структуру для всех типов событий.
Если VAPID-ключи не настроены в .env — функции молча возвращаются (push выключен).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session

from config import get_settings
from database import SessionLocal
from models import PushSubscription


logger = logging.getLogger("podotchet.push")
settings = get_settings()


# ===================== Шаблоны payload =====================

_ICONS = {
    "chat_message": "💬",
    "request_submitted": "📋",
    "request_approved": "✅",
    "request_rejected": "❌",
    "transfer_received": "💸",
    "balance_topup": "💼",
}


def build_payload(event_type: str, data: dict[str, Any]) -> dict[str, Any]:
    """Стандартизированная структура push-уведомления.
    Эмодзи в title — единственный «иконочный» элемент, надёжный кросс-платформенно
    (iOS не показывает icon из manifest для веб-push)."""

    icon = _ICONS.get(event_type, "🔔")

    if event_type == "chat_message":
        sender = str(data.get("sender_name") or "Сообщение")
        content = str(data.get("content") or "")
        preview = content[:120] + ("..." if len(content) > 120 else "")
        title = f"{icon} {sender}"
        body = preview
        url = "/"  # widget откроется по chat:open событию когда фокус вернётся
    elif event_type == "request_submitted":
        title = f"{icon} Новая заявка"
        body = f"{data.get('requester_name', '')}: {data.get('title', '')}\nСумма: {data.get('amount', '')} с"
        url = f"/requests/{data.get('request_id')}" if data.get("request_id") else "/requests"
    elif event_type == "request_approved":
        title = f"{icon} Заявка одобрена"
        body = f"{data.get('title', '')}\nЗачислено: {data.get('amount', '')} с"
        url = f"/requests/{data.get('request_id')}" if data.get("request_id") else "/requests"
    elif event_type == "request_rejected":
        title = f"{icon} Заявка отклонена"
        body = f"{data.get('title', '')}\n{data.get('comment', '')}"
        url = f"/requests/{data.get('request_id')}" if data.get("request_id") else "/requests"
    elif event_type == "transfer_received":
        title = f"{icon} Перевод"
        body = f"Вам передали {data.get('amount', '')} с от {data.get('from_user_name', '')}"
        if data.get("note"):
            body += f"\n{data['note']}"
        url = "/transfers"
    elif event_type == "balance_topup":
        title = f"{icon} Пополнение баланса"
        body = f"+{data.get('amount', '')} с от {data.get('admin_name', 'admin')}"
        if data.get("note"):
            body += f"\n{data['note']}"
        url = "/"
    else:
        title = f"🔔 {event_type}"
        body = ""
        url = "/"

    return {
        "title": title,
        "body": body,
        "icon": "/icons/icon-192.png",
        "badge": "/icons/icon-192.png",
        "tag": event_type,
        "vibrate": [200, 100, 200],
        "url": url,
    }


# ===================== Низкоуровневая отправка =====================

def _send_one(endpoint: str, p256dh: str, auth: str, payload: dict[str, Any]) -> None:
    """Sync-вызов pywebpush. Блокирует на сетевом запросе ~100-500мс."""
    webpush(
        subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=settings.vapid_private_key,
        vapid_claims={"sub": settings.vapid_subject},
    )


def send_push_to_user_sync(user_id: int, org_id: int, payload: dict[str, Any]) -> None:
    """Отправить push всем подпискам конкретного юзера. Открывает свою сессию БД —
    безопасно вызывать из FastAPI BackgroundTasks (ASGI worker)."""
    if not settings.vapid_private_key or not settings.vapid_public_key:
        return  # push выключен — нет ключей в .env

    db: Session = SessionLocal()
    try:
        subs = (
            db.query(PushSubscription)
            .filter(PushSubscription.org_id == org_id, PushSubscription.user_id == user_id)
            .all()
        )
        if not subs:
            return

        dead: list[int] = []
        for sub in subs:
            try:
                _send_one(sub.endpoint, sub.p256dh, sub.auth, payload)
            except WebPushException as exc:
                # 404/410 — подписка отозвана юзером или истекла. Чистим из БД.
                status_code = getattr(getattr(exc, "response", None), "status_code", None)
                if status_code in (404, 410):
                    dead.append(sub.id)
                else:
                    logger.warning("Push failed for endpoint %s: %s", sub.endpoint[:60], exc)
            except Exception as exc:  # сеть/DNS — не убиваем задачу
                logger.warning("Push transport error: %s", exc)

        if dead:
            db.query(PushSubscription).filter(PushSubscription.id.in_(dead)).delete(
                synchronize_session=False
            )
            db.commit()
    finally:
        db.close()


async def send_push_to_user_async(user_id: int, org_id: int, payload: dict[str, Any]) -> None:
    """Async-обёртка для вызова из WebSocket-handler'а.
    asyncio.to_thread не блокирует event loop, пока pywebpush стучится в браузер-пуш-сервис."""
    await asyncio.to_thread(send_push_to_user_sync, user_id, org_id, payload)
