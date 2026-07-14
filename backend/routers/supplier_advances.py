"""Авансы поставщикам (депозиты в магазине).

Сотрудник вносит предоплату поставщику — его баланс уменьшается, деньги «лежат»
у поставщика. Покупки в этом магазине оплачиваются с депозита
(Expense.payment_source='supplier_advance'), не трогая баланс повторно.

Учёт (без двойного списания):
- deposit  → баланс сотрудника −, остаток депозита +  (в отчётах расходов НЕТ)
- purchase → баланс не меняется, остаток −               (в отчётах ЕСТЬ как обычный расход)
- refund   → баланс сотрудника +, остаток −               (в отчётах НЕТ)
Списание/возврат по балансу — в services/balance.py (_supplier_deposits_out/_supplier_refunds_in).
Покупка создаётся в routers/expenses.py (payment_source='supplier_advance') + вызывает
record_purchase() отсюда.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user, is_director_level, is_director_or_auditor
from database import get_db
from models import (
    Category,
    Department,
    Expense,
    SupplierAdvance,
    SupplierAdvanceTransaction,
    User,
)
from schemas import (
    SupplierAdvanceCreate,
    SupplierAdvanceDeposit,
    SupplierAdvanceOut,
    SupplierAdvanceRefund,
    SupplierAdvanceTransactionOut,
    SupplierAdvanceUpdate,
)
from services.balance import compute_current_balance
from services.permissions import (
    member_active_workspace_id,
    owner_isolation_ws_id,
    visible_user_ids,
)

router = APIRouter(prefix="/api/supplier-advances", tags=["supplier-advances"])

_D = lambda x: Decimal(str(x or 0))  # noqa: E731


# ---------------------------------------------------------------- агрегаты / остаток

def advance_aggregates(db: Session, advance_id: int) -> dict:
    """Σ по типам транзакций депозита + остаток. Всё в валюте депозита."""
    rows = (
        db.query(SupplierAdvanceTransaction.type, SupplierAdvanceTransaction.amount)
        .filter(SupplierAdvanceTransaction.advance_id == advance_id)
        .all()
    )
    deposited = sum((_D(a) for t, a in rows if t == "deposit"), Decimal(0))
    spent = sum((_D(a) for t, a in rows if t == "purchase"), Decimal(0))
    refunded = sum((_D(a) for t, a in rows if t == "refund"), Decimal(0))
    return {
        "deposited": deposited,
        "spent": spent,
        "refunded": refunded,
        "remaining": deposited - spent - refunded,
    }


def advance_remaining(db: Session, advance_id: int) -> Decimal:
    return advance_aggregates(db, advance_id)["remaining"]


def _refresh_status(db: Session, adv: SupplierAdvance) -> None:
    """Автостатус: остаток 0 → depleted; >0 и не closed → active. closed не трогаем."""
    if adv.status == "closed":
        return
    rem = advance_remaining(db, adv.id)
    adv.status = "depleted" if rem <= 0 else "active"


# ---------------------------------------------------------------- доступ

def _visible_advances_query(db: Session, me: User):
    """Скоуп депозитов по правам (как у остальных сущностей):
    - владелец активного пространства → только депозиты этого пространства;
    - director-level / auditor → все депозиты организации;
    - прочие (accountable) → свои + депозиты своего пространства."""
    q = db.query(SupplierAdvance).filter(SupplierAdvance.org_id == me.org_id)
    iso = owner_isolation_ws_id(db, me)
    if iso is not None:
        return q.filter(SupplierAdvance.workspace_id == iso)
    if is_director_or_auditor(me):
        return q
    # accountable: свои (видимые) сотрудники + своё пространство
    visible = visible_user_ids(db, me)
    member_ws = member_active_workspace_id(db, me.id, me.org_id)
    conds = []
    if visible is not None:
        conds.append(SupplierAdvance.employee_id.in_(visible))
    if member_ws:
        conds.append(SupplierAdvance.workspace_id == member_ws)
    if not conds:
        return q.filter(SupplierAdvance.employee_id == me.id)
    from sqlalchemy import or_
    return q.filter(or_(*conds))


def _get_visible_or_404(db: Session, me: User, advance_id: int) -> SupplierAdvance:
    adv = _visible_advances_query(db, me).filter(SupplierAdvance.id == advance_id).first()
    if not adv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Депозит не найден")
    return adv


def _can_manage(me: User, adv: SupplierAdvance, db: Session) -> bool:
    """Кто может вносить/возвращать/закрывать: director-level, владелец пространства
    депозита, или сам сотрудник-держатель."""
    if is_director_level(me):
        return True
    if me.id == adv.employee_id:
        return True
    iso = owner_isolation_ws_id(db, me)
    return iso is not None and adv.workspace_id == iso


# ---------------------------------------------------------------- сериализация

def _tx_out(db: Session, tx: SupplierAdvanceTransaction) -> SupplierAdvanceTransactionOut:
    out = SupplierAdvanceTransactionOut.model_validate(tx)
    if tx.expense_id:
        e = db.get(Expense, tx.expense_id)
        if e:
            out.description = e.description
            out.receipt_url = e.receipt_url
            if e.category_id:
                c = db.get(Category, e.category_id)
                out.category_name = c.name if c else None
            if e.department_id:
                d = db.get(Department, e.department_id)
                out.department_name = d.name if d else None
    return out


def _to_out(db: Session, adv: SupplierAdvance, with_tx: bool = False) -> SupplierAdvanceOut:
    out = SupplierAdvanceOut.model_validate(adv)
    agg = advance_aggregates(db, adv.id)
    out.deposited = agg["deposited"]
    out.spent = agg["spent"]
    out.refunded = agg["refunded"]
    out.remaining = agg["remaining"]
    out.employee_name = adv.employee.name if adv.employee else None
    if with_tx:
        txs = (
            db.query(SupplierAdvanceTransaction)
            .filter(SupplierAdvanceTransaction.advance_id == adv.id)
            .order_by(SupplierAdvanceTransaction.date, SupplierAdvanceTransaction.id)
            .all()
        )
        out.transactions = [_tx_out(db, t) for t in txs]
    else:
        out.transactions = []
    return out


# ---------------------------------------------------------------- endpoints

@router.get("", response_model=List[SupplierAdvanceOut])
def list_advances(
    active_only: bool = False,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    q = _visible_advances_query(db, me)
    if active_only:
        q = q.filter(SupplierAdvance.status == "active")
    rows = q.order_by(SupplierAdvance.created_at.desc()).all()
    return [_to_out(db, a) for a in rows]


@router.get("/{advance_id}", response_model=SupplierAdvanceOut)
def get_advance(advance_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    adv = _get_visible_or_404(db, me, advance_id)
    return _to_out(db, adv, with_tx=True)


@router.post("", response_model=SupplierAdvanceOut, status_code=status.HTTP_201_CREATED)
def create_advance(
    payload: SupplierAdvanceCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    # Чей баланс. По умолчанию — сам вносящий. За другого — только director-level/auditor.
    employee_id = payload.employee_id or me.id
    if employee_id != me.id and not is_director_or_auditor(me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Вносить за другого может только auditor и выше")
    employee = db.get(User, employee_id)
    if not employee or employee.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сотрудник не найден")

    # Сумма первого внесения не может превысить текущий баланс сотрудника.
    balance = compute_current_balance(db, me.org_id, employee_id)
    if _D(payload.amount) > balance:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Сумма аванса ({payload.amount}) больше баланса сотрудника ({balance:.2f} KGS)",
        )

    when = payload.date or datetime.utcnow()
    adv = SupplierAdvance(
        org_id=me.org_id,
        workspace_id=member_active_workspace_id(db, employee_id, me.org_id),
        employee_id=employee_id,
        supplier_name=payload.supplier_name.strip(),
        initial_amount=payload.amount,
        currency=payload.currency,
        status="active",
        comment=payload.comment,
        created_by_id=me.id,
    )
    db.add(adv)
    db.flush()
    db.add(SupplierAdvanceTransaction(
        advance_id=adv.id,
        type="deposit",
        amount=payload.amount,
        date=when,
        created_by_id=me.id,
    ))
    db.commit()
    db.refresh(adv)
    return _to_out(db, adv, with_tx=True)


@router.patch("/{advance_id}", response_model=SupplierAdvanceOut)
def update_advance(
    advance_id: int,
    payload: SupplierAdvanceUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    adv = _get_visible_or_404(db, me, advance_id)
    if not _can_manage(me, adv, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет прав на этот депозит")
    if payload.supplier_name is not None:
        adv.supplier_name = payload.supplier_name.strip()
    if payload.comment is not None:
        adv.comment = payload.comment or None
    db.commit()
    db.refresh(adv)
    return _to_out(db, adv, with_tx=True)


@router.delete("/{advance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_advance(advance_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    adv = _get_visible_or_404(db, me, advance_id)
    if not _can_manage(me, adv, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет прав на этот депозит")
    # Правило: депозит с покупками нельзя удалить (только закрыть) — иначе расходы
    # осиротеют. Без покупок — удаляем; deposit/refund-транзакции уходят каскадом,
    # и баланс сотрудника восстанавливается автоматически (агрегатный расчёт).
    agg = advance_aggregates(db, adv.id)
    if agg["spent"] > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Нельзя удалить депозит с покупками — верните остаток и закройте его",
        )
    db.delete(adv)
    db.commit()
    return None


@router.post("/{advance_id}/deposit", response_model=SupplierAdvanceOut)
def add_deposit(
    advance_id: int,
    payload: SupplierAdvanceDeposit,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    adv = _get_visible_or_404(db, me, advance_id)
    if not _can_manage(me, adv, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет прав на этот депозит")
    if adv.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Депозит закрыт")
    balance = compute_current_balance(db, me.org_id, adv.employee_id)
    if _D(payload.amount) > balance:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Сумма довнесения больше баланса сотрудника ({balance:.2f} KGS)",
        )
    db.add(SupplierAdvanceTransaction(
        advance_id=adv.id,
        type="deposit",
        amount=payload.amount,
        date=payload.date or datetime.utcnow(),
        created_by_id=me.id,
    ))
    db.flush()
    _refresh_status(db, adv)
    db.commit()
    db.refresh(adv)
    return _to_out(db, adv, with_tx=True)


@router.post("/{advance_id}/refund", response_model=SupplierAdvanceOut)
def refund(
    advance_id: int,
    payload: SupplierAdvanceRefund,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    adv = _get_visible_or_404(db, me, advance_id)
    if not _can_manage(me, adv, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет прав на этот депозит")
    rem = advance_remaining(db, adv.id)
    if _D(payload.amount) > rem:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Возврат ({payload.amount}) больше остатка депозита ({rem:.2f})",
        )
    db.add(SupplierAdvanceTransaction(
        advance_id=adv.id,
        type="refund",
        amount=payload.amount,
        date=payload.date or datetime.utcnow(),
        created_by_id=me.id,
    ))
    db.flush()
    _refresh_status(db, adv)
    db.commit()
    db.refresh(adv)
    return _to_out(db, adv, with_tx=True)


@router.post("/{advance_id}/close", response_model=SupplierAdvanceOut)
def close_advance(advance_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    adv = _get_visible_or_404(db, me, advance_id)
    if not _can_manage(me, adv, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет прав на этот депозит")
    rem = advance_remaining(db, adv.id)
    if rem > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Нельзя закрыть: остаток {rem:.2f}. Сначала верните остаток сотруднику.",
        )
    adv.status = "closed"
    db.commit()
    db.refresh(adv)
    return _to_out(db, adv, with_tx=True)


# ---------------------------------------------------------------- вызывается из expenses.py

def record_purchase(db: Session, me: User, advance_id: int, expense: Expense) -> SupplierAdvance:
    """Списать покупку с депозита (создать transaction type='purchase'). Проверяет доступ,
    валюту и остаток. НЕ коммитит — коммит делает вызывающий (create_expense)."""
    adv = _visible_advances_query(db, me).filter(SupplierAdvance.id == advance_id).first()
    if not adv:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Депозит не найден или недоступен")
    if adv.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Депозит закрыт")
    if expense.currency != adv.currency:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Валюта расхода ({expense.currency}) должна совпадать с валютой депозита ({adv.currency})",
        )
    rem = advance_remaining(db, adv.id)
    if _D(expense.amount) > rem:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Сумма покупки ({expense.amount}) больше остатка депозита ({rem:.2f})",
        )
    db.add(SupplierAdvanceTransaction(
        advance_id=adv.id,
        type="purchase",
        amount=expense.amount,
        expense_id=expense.id,
        date=expense.spent_at or datetime.utcnow(),
        created_by_id=me.id,
    ))
    db.flush()
    _refresh_status(db, adv)
    return adv
