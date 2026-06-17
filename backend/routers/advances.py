from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import (
    get_current_user,
    is_director_level,
    require_director_level,
)
from database import get_db
from models import Advance, EmployeeSpec, Organization, User
from services.plan_limits import assert_limit
from schemas import AdvanceCreate, AdvanceOut, AdvanceWarning, TransferCreate
from services.balance import (
    compute_balance,
    issued_total,
    month_bounds,
)
from services.permissions import visible_user_ids


router = APIRouter(prefix="/api/advances", tags=["advances"])


def _to_out(a: Advance) -> AdvanceOut:
    out = AdvanceOut.model_validate(a)
    out.employee_name = a.employee.name if a.employee else None
    out.issued_by_name = a.issued_by.name if a.issued_by else None
    return out


@router.get("", response_model=List[AdvanceOut])
def list_advances(
    employee_id: Optional[int] = None,
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    q = db.query(Advance).filter(Advance.org_id == me.org_id)
    visible = visible_user_ids(db, me)
    if visible is not None:
        q = q.filter(Advance.employee_id.in_(visible))
    if employee_id:
        q = q.filter(Advance.employee_id == employee_id)
    rows = q.order_by(Advance.issued_at.desc()).limit(limit).all()
    return [_to_out(a) for a in rows]


@router.post(
    "",
    response_model=Union[AdvanceOut, AdvanceWarning],
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "Создано"},
        409: {"model": AdvanceWarning, "description": "Превышение лимитов — повторите с force=true"},
    },
)
def create_advance(
    payload: AdvanceCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_director_level),
):
    employee = db.get(User, payload.employee_id)
    if not employee or employee.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")

    # Лимит плана: число выдач за текущий календарный месяц.
    org = db.get(Organization, admin.org_id)
    _m_start, _m_end = month_bounds()
    advances_this_month = (
        db.query(Advance)
        .filter(Advance.org_id == admin.org_id, Advance.issued_at >= _m_start, Advance.issued_at < _m_end)
        .count()
    )
    assert_limit(org, "max_advances_per_month", advances_this_month)

    spec = db.query(EmployeeSpec).filter(EmployeeSpec.user_id == employee.id).first()

    warnings: list[str] = []
    single_limit = Decimal(str(spec.single_limit)) if spec else Decimal(0)
    monthly_limit = Decimal(str(spec.monthly_limit)) if spec else Decimal(0)

    m_start, m_end = month_bounds()
    monthly_used = issued_total(db, admin.org_id, employee.id, start=m_start, end=m_end)

    if single_limit > 0 and payload.amount > single_limit:
        warnings.append(f"Превышен лимит одной выдачи: {single_limit} сом")
    if monthly_limit > 0 and (monthly_used + payload.amount) > monthly_limit:
        warnings.append(f"Превышен месячный лимит: использовано {monthly_used} из {monthly_limit} сом")

    if warnings and not payload.force:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=AdvanceWarning(
                warnings=warnings,
                single_limit=single_limit,
                monthly_limit=monthly_limit,
                monthly_used=monthly_used,
            ).model_dump(mode="json"),
        )

    a = Advance(
        org_id=admin.org_id,
        issued_by_id=admin.id,
        employee_id=employee.id,
        amount=payload.amount,
        currency=payload.currency,
        payment_type=payload.payment_type,
        source="org_funds",
        purpose=payload.purpose,
        comment=payload.comment,
        issued_at=payload.issued_at or datetime.utcnow(),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _to_out(a)


@router.post(
    "/transfer",
    response_model=AdvanceOut,
    status_code=status.HTTP_201_CREATED,
)
def create_transfer(
    payload: TransferCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Перевод денег моему подотчётному (с моего баланса в той же валюте)."""
    sub = db.get(User, payload.subordinate_id)
    if not sub or sub.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Подотчётный не найден")
    if sub.supervisor_id != me.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Это не ваш подотчётный")
    if sub.id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя переводить самому себе")

    from services.balance import compute_balances_by_currency
    balances = compute_balances_by_currency(db, me.org_id, me.id)
    cur_balance = balances.get(payload.currency, Decimal(0))
    if cur_balance < payload.amount:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Недостаточно средств в {payload.currency}: на балансе {cur_balance}, нужно {payload.amount}",
        )

    a = Advance(
        org_id=me.org_id,
        issued_by_id=me.id,
        employee_id=sub.id,
        amount=payload.amount,
        currency=payload.currency,
        payment_type="transfer",
        source="transfer",
        purpose=payload.purpose,
        comment=payload.comment,
        issued_at=datetime.utcnow(),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _to_out(a)


@router.get("/{advance_id}", response_model=AdvanceOut)
def get_advance(advance_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    a = db.get(Advance, advance_id)
    if not a or a.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не найдено")
    visible = visible_user_ids(db, me)
    if visible is not None and a.employee_id not in visible:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    return _to_out(a)


@router.delete("/{advance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_advance(advance_id: int, db: Session = Depends(get_db), admin: User = Depends(require_director_level)):
    a = db.get(Advance, advance_id)
    if not a or a.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не найдено")
    db.delete(a)
    db.commit()
    return None
