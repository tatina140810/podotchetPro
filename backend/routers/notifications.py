"""Уведомления (запись в БД, без push/email)."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Notification, User
from schemas import NotificationOut


router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=List[NotificationOut])
def list_notifications(
    only_unread: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    q = db.query(Notification).filter(
        Notification.org_id == me.org_id,
        Notification.user_id == me.id,
    )
    if only_unread:
        q = q.filter(Notification.is_read.is_(False))
    rows = q.order_by(Notification.created_at.desc()).limit(limit).all()
    return rows


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    n = (
        db.query(Notification)
        .filter(
            Notification.org_id == me.org_id,
            Notification.user_id == me.id,
            Notification.is_read.is_(False),
        )
        .count()
    )
    return {"count": n}


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    n = db.get(Notification, notification_id)
    if not n or n.user_id != me.id or n.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Уведомление не найдено")
    n.is_read = True
    db.commit()
    return None


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.org_id == me.org_id,
        Notification.user_id == me.id,
        Notification.is_read.is_(False),
    ).update({Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return None
