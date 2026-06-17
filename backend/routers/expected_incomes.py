"""Ожидаемые пополнения — суммы, которые сотрудник планирует получить.

По галочке «получено» создаётся реальный Income (модуль «Приходы»):
  - one_time → запись помечается received (архив);
  - monthly/weekly → создаётся Income, запись остаётся pending, expected_date
    сдвигается на следующий период.

Права:
  - GET ?user_id= — свои (по умолчанию) или чужие read-only (visible_user_ids +
    скрытие конфиденциальных через hidden_user_ids).
  - POST / PATCH / DELETE / receive — только над своими.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import ExpectedIncome, Income, User
from schemas import ExpectedIncomeCreate, ExpectedIncomeOut, ExpectedIncomeUpdate
from services.exchange import get_current_rate
from services.permissions import hidden_user_ids, visible_user_ids


router = APIRouter(prefix="/api/expected-incomes", tags=["expected-incomes"])


def _assert_can_view(db: Session, me: User, target_id: int) -> None:
    if target_id == me.id:
        return
    vis = visible_user_ids(db, me)
    if vis is not None and target_id not in vis:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к ожидаемым пополнениям сотрудника")
    if target_id in hidden_user_ids(db, me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к ожидаемым пополнениям сотрудника")


def _own_or_404(db: Session, me: User, exp_id: int) -> ExpectedIncome:
    exp = db.get(ExpectedIncome, exp_id)
    if not exp or exp.user_id != me.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ожидаемое пополнение не найдено")
    return exp


def _to_out(db: Session, org_id: int, exp: ExpectedIncome) -> ExpectedIncomeOut:
    out = ExpectedIncomeOut.model_validate(exp)
    if exp.currency == "KGS":
        out.amount_kgs = exp.amount
    else:
        rate = get_current_rate(db, org_id, exp.currency, "KGS")
        out.amount_kgs = (Decimal(str(exp.amount)) * rate) if rate is not None else None
    return out


def _shift_date(base: Optional[datetime], periodicity: str) -> Optional[datetime]:
    """Сдвиг ожидаемой даты на следующий период (от base или от сегодня)."""
    start = base or datetime.utcnow()
    if periodicity == "weekly":
        return start + timedelta(days=7)
    if periodicity == "monthly":
        month = start.month + 1
        year = start.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        # День месяца с защитой от 31→февраль.
        day = start.day
        while day > 28:
            try:
                return start.replace(year=year, month=month, day=day)
            except ValueError:
                day -= 1
        return start.replace(year=year, month=month, day=day)
    return base


@router.get("", response_model=List[ExpectedIncomeOut])
def list_expected(
    user_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    target_id = user_id or me.id
    _assert_can_view(db, me, target_id)
    rows = (
        db.query(ExpectedIncome)
        .filter(ExpectedIncome.user_id == target_id)
        .order_by(ExpectedIncome.status.asc(), ExpectedIncome.expected_date.asc().nullslast(), ExpectedIncome.id.desc())
        .all()
    )
    return [_to_out(db, me.org_id, r) for r in rows]


@router.post("", response_model=ExpectedIncomeOut, status_code=status.HTTP_201_CREATED)
def create_expected(
    payload: ExpectedIncomeCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    exp = ExpectedIncome(
        org_id=me.org_id,
        user_id=me.id,
        name=payload.name.strip(),
        amount=payload.amount,
        currency=payload.currency,
        expected_date=payload.expected_date,
        periodicity=payload.periodicity,
        comment=(payload.comment or "").strip() or None,
        status="pending",
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return _to_out(db, me.org_id, exp)


@router.patch("/{exp_id}", response_model=ExpectedIncomeOut)
def update_expected(
    exp_id: int,
    payload: ExpectedIncomeUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    exp = _own_or_404(db, me, exp_id)
    if exp.status == "received":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Полученную запись нельзя редактировать")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        exp.name = data["name"].strip()
    if "amount" in data and data["amount"] is not None:
        exp.amount = data["amount"]
    if "currency" in data and data["currency"] is not None:
        exp.currency = data["currency"]
    if "expected_date" in data:
        exp.expected_date = data["expected_date"]
    if "periodicity" in data and data["periodicity"] is not None:
        exp.periodicity = data["periodicity"]
    if "comment" in data:
        exp.comment = (data["comment"] or "").strip() or None
    db.commit()
    db.refresh(exp)
    return _to_out(db, me.org_id, exp)


@router.delete("/{exp_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expected(
    exp_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    exp = _own_or_404(db, me, exp_id)
    db.delete(exp)
    db.commit()
    return None


@router.post("/{exp_id}/receive", response_model=ExpectedIncomeOut)
def receive_expected(
    exp_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Подтвердить получение → создать реальный Income и обновить запись."""
    exp = _own_or_404(db, me, exp_id)
    if exp.status == "received":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Уже получено")

    # КГС-эквивалент фиксируется на момент получения (как в income.create_income).
    if exp.currency == "KGS":
        amount_kgs: Optional[Decimal] = Decimal(str(exp.amount))
    else:
        rate = get_current_rate(db, me.org_id, exp.currency, "KGS")
        if rate is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Установите курс {exp.currency}/KGS перед получением",
            )
        amount_kgs = Decimal(str(exp.amount)) * rate

    inc = Income(
        org_id=me.org_id,
        amount=exp.amount,
        currency=exp.currency,
        amount_kgs=amount_kgs,
        source=exp.name,
        description="из ожидаемых пополнений",
        received_by_id=me.id,
        created_by_id=me.id,
        date=datetime.utcnow(),
    )
    db.add(inc)
    db.flush()  # получить inc.id

    if exp.periodicity == "one_time":
        exp.status = "received"
        exp.received_at = datetime.utcnow()
        exp.created_income_id = inc.id
    else:
        # Регулярное: остаётся pending, дата сдвигается на следующий период.
        exp.created_income_id = inc.id
        exp.expected_date = _shift_date(exp.expected_date, exp.periodicity)
        exp.status = "pending"

    db.commit()
    db.refresh(exp)
    return _to_out(db, me.org_id, exp)
