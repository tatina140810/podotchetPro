"""Регулярные обязательства — личный справочник регулярных расходов сотрудника.

Подсказка при создании заявок (НЕ создаёт заявку автоматически). Данные на уровне
пользователя.

Права:
  - GET ?user_id=  — свои (по умолчанию) или чужие в режиме read-only, если у me есть
    право видеть этого сотрудника (директор/аудитор — всех, кроме конфиденциальных;
    руководитель — своих подчинённых; сам сотрудник — себя).
  - POST / PATCH / DELETE / reorder — только над СВОИМИ обязательствами.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Category, RecurringObligation, User
from schemas import (
    RecurringObligationCreate,
    RecurringObligationOut,
    RecurringObligationUpdate,
    ReorderPayload,
)
from services.permissions import hidden_user_ids, visible_user_ids


router = APIRouter(prefix="/api/recurring-obligations", tags=["recurring-obligations"])


def _assert_can_view(db: Session, me: User, target_id: int) -> None:
    """Может ли me видеть обязательства пользователя target_id (read-only для чужих)."""
    if target_id == me.id:
        return
    vis = visible_user_ids(db, me)  # None = директор/аудитор видят всех в org
    if vis is not None and target_id not in vis:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к обязательствам сотрудника")
    if target_id in hidden_user_ids(db, me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к обязательствам сотрудника")
    target = db.get(User, target_id)
    if not target or target.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")


def _resolve_category_id(db: Session, org_id: int, category_id: Optional[int]) -> Optional[int]:
    """Категория справочная: None допустимо. Если задана — должна быть в той же org,
    иначе считаем её отсутствующей (None), чтобы не падать на чужом/удалённом id."""
    if category_id is None:
        return None
    cat = db.get(Category, category_id)
    if not cat or cat.org_id != org_id:
        return None
    return category_id


def _own_or_404(db: Session, me: User, ob_id: int) -> RecurringObligation:
    ob = db.get(RecurringObligation, ob_id)
    if not ob or ob.user_id != me.id:
        # Чужие обязательства редактировать нельзя — ведём себя как «не найдено».
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Обязательство не найдено")
    return ob


@router.get("", response_model=List[RecurringObligationOut])
def list_obligations(
    user_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    target_id = user_id or me.id
    _assert_can_view(db, me, target_id)
    rows = (
        db.query(RecurringObligation)
        .filter(RecurringObligation.user_id == target_id)
        .order_by(RecurringObligation.sort_order.asc(), RecurringObligation.id.asc())
        .all()
    )
    return rows


@router.post("", response_model=RecurringObligationOut, status_code=status.HTTP_201_CREATED)
def create_obligation(
    payload: RecurringObligationCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    next_order = (
        db.query(func.coalesce(func.max(RecurringObligation.sort_order), -1))
        .filter(RecurringObligation.user_id == me.id)
        .scalar()
    )
    ob = RecurringObligation(
        org_id=me.org_id,
        user_id=me.id,
        name=payload.name.strip(),
        amount=payload.amount,
        periodicity=payload.periodicity,
        comment=(payload.comment or "").strip() or None,
        category_id=_resolve_category_id(db, me.org_id, payload.category_id),
        sort_order=int(next_order) + 1,
    )
    db.add(ob)
    db.commit()
    db.refresh(ob)
    return ob


@router.patch("/{ob_id}", response_model=RecurringObligationOut)
def update_obligation(
    ob_id: int,
    payload: RecurringObligationUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ob = _own_or_404(db, me, ob_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        ob.name = data["name"].strip()
    if "amount" in data and data["amount"] is not None:
        ob.amount = data["amount"]
    if "periodicity" in data and data["periodicity"] is not None:
        ob.periodicity = data["periodicity"]
    if "comment" in data:
        ob.comment = (data["comment"] or "").strip() or None
    if "category_id" in data:
        ob.category_id = _resolve_category_id(db, me.org_id, data["category_id"])
    db.commit()
    db.refresh(ob)
    return ob


@router.delete("/{ob_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_obligation(
    ob_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ob = _own_or_404(db, me, ob_id)
    db.delete(ob)
    db.commit()
    return None


@router.post("/reorder", response_model=List[RecurringObligationOut])
def reorder_obligations(
    payload: ReorderPayload,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Задать порядок строк. ids — все id обязательств me в нужном порядке."""
    rows = (
        db.query(RecurringObligation)
        .filter(RecurringObligation.user_id == me.id)
        .all()
    )
    by_id = {r.id: r for r in rows}
    # Применяем порядок только к своим id; неизвестные игнорируем.
    order = 0
    for oid in payload.ids:
        r = by_id.get(oid)
        if r is not None:
            r.sort_order = order
            order += 1
    db.commit()
    return (
        db.query(RecurringObligation)
        .filter(RecurringObligation.user_id == me.id)
        .order_by(RecurringObligation.sort_order.asc(), RecurringObligation.id.asc())
        .all()
    )
