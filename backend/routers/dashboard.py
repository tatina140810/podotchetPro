from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from auth import get_current_user, is_director_or_auditor, is_director_level
from database import get_db
from models import (
    Advance,
    BalanceTopUp,
    EmployeeSpec,
    Expense,
    Income,
    MoneyRequest,
    MoneyTransfer,
    User,
)
from services.permissions import auditor_department_ids
from services.balance import (
    compute_current_balance,
    compute_total_issued,
    compute_total_received,
    issued_total,
    load_org_rates,
    month_bounds,
    spent_total,
    to_kgs_expr,
)


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def dashboard(db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    if is_director_or_auditor(me):
        return _director_dashboard(db, me)
    return _accountable_dashboard(db, me)


def _director_dashboard(db: Session, me: User) -> dict:
    # Загружаем курсы один раз — используем во всех агрегатах.
    rates = load_org_rates(db, me.org_id)
    usd_kgs = rates.get("USD")

    # Ограниченный аудитор видит цифры только своего подразделения. Выдачи/авансы
    # (Advance) к подразделению не привязаны — для него они = 0.
    dept_scope = auditor_department_ids(db, me)

    if dept_scope is not None:
        total_issued = Decimal(0)
    else:
        total_issued = Decimal(str(
            db.query(func.coalesce(func.sum(Advance.amount), 0))
            .filter(Advance.org_id == me.org_id).scalar() or 0
        ))
    # Все расходы в KGS-эквиваленте по ТЕКУЩЕМУ курсу.
    expense_expr = to_kgs_expr(Expense.amount, Expense.currency, rates)
    spent_q = db.query(func.coalesce(func.sum(expense_expr), 0)).filter(
        Expense.org_id == me.org_id,
        Expense.status.in_(("approved", "pending")),
    )
    pending_q = db.query(func.count(Expense.id)).filter(
        Expense.org_id == me.org_id, Expense.status == "pending",
    )
    if dept_scope is not None:
        spent_q = spent_q.filter(Expense.department_id.in_(dept_scope))
        pending_q = pending_q.filter(Expense.department_id.in_(dept_scope))
    total_spent = Decimal(str(spent_q.scalar() or 0))
    pending_expenses = pending_q.scalar() or 0
    pending_requests_for_me = (
        db.query(func.count(MoneyRequest.id))
        .filter(
            MoneyRequest.org_id == me.org_id,
            MoneyRequest.status == "pending",
            MoneyRequest.approver_id == me.id,
        )
        .scalar() or 0
    )
    pending_requests_total_q = db.query(func.count(MoneyRequest.id)).filter(
        MoneyRequest.org_id == me.org_id, MoneyRequest.status == "pending",
    )
    if dept_scope is not None:
        pending_requests_total_q = pending_requests_total_q.filter(
            MoneyRequest.department_id.in_(dept_scope))
    pending_requests_total = pending_requests_total_q.scalar() or 0

    # Выдачи к подразделению не привязаны → ограниченному аудитору их не показываем.
    last_advances = [] if dept_scope is not None else (
        db.query(Advance).filter(Advance.org_id == me.org_id)
        .order_by(Advance.issued_at.desc()).limit(5).all()
    )
    last_expenses_q = db.query(Expense).filter(Expense.org_id == me.org_id)
    if dept_scope is not None:
        last_expenses_q = last_expenses_q.filter(Expense.department_id.in_(dept_scope))
    last_expenses = last_expenses_q.order_by(Expense.spent_at.desc()).limit(5).all()

    my_issued = (
        compute_total_issued(db, me.org_id, me.id, rates=rates) if is_director_level(me) else 0
    )

    # Остаток в обороте org = Income + TopUp − Expense (все в KGS по текущему курсу).
    topup_expr = to_kgs_expr(BalanceTopUp.amount, BalanceTopUp.currency, rates)
    income_expr = to_kgs_expr(Income.amount, Income.currency, rates)
    topups_q = db.query(func.coalesce(func.sum(topup_expr), 0)).filter(
        BalanceTopUp.org_id == me.org_id)
    income_q = db.query(func.coalesce(func.sum(income_expr), 0)).filter(
        Income.org_id == me.org_id)
    cash_spent_q = db.query(func.coalesce(func.sum(expense_expr), 0)).filter(
        Expense.org_id == me.org_id,
        Expense.status.in_(("approved", "pending")),
    )
    if dept_scope is not None:
        topups_q = topups_q.filter(BalanceTopUp.department_id.in_(dept_scope))
        income_q = income_q.filter(Income.department_id.in_(dept_scope))
        cash_spent_q = cash_spent_q.filter(Expense.department_id.in_(dept_scope))
    total_topups_kgs = Decimal(str(topups_q.scalar() or 0))
    total_income_kgs = Decimal(str(income_q.scalar() or 0))
    spent_kgs = Decimal(str(cash_spent_q.scalar() or 0))
    cash_kgs = total_topups_kgs + total_income_kgs - spent_kgs
    cash_usd = (cash_kgs / usd_kgs) if usd_kgs and usd_kgs > 0 else None

    return {
        "view": "director",
        "totals": {
            "issued": float(total_issued),
            "spent": float(total_spent),
            "balance": float(total_issued - total_spent),
            "pending_count": int(pending_expenses),
            "pending_requests_for_me": int(pending_requests_for_me),
            "pending_requests_total": int(pending_requests_total),
            "my_issued": float(my_issued),
        },
        "cash_balance": {
            "kgs": float(cash_kgs),
            "usd": float(cash_usd) if cash_usd is not None else None,
            "rate": float(usd_kgs) if usd_kgs else None,
        },
        "recent_advances": [
            {
                "id": a.id, "amount": float(a.amount),
                "currency": getattr(a, "currency", None) or "KGS",
                "employee": a.employee.name if a.employee else "—",
                "issued_at": a.issued_at.isoformat(),
            } for a in last_advances
        ],
        "recent_expenses": [
            {
                "id": e.id, "amount": float(e.amount),
                "currency": e.currency or "KGS",
                "employee": e.employee.name if e.employee else "—",
                "category": e.category.name if e.category else "—",
                "status": e.status,
                "is_verified": e.is_verified,
                "spent_at": e.spent_at.isoformat(),
            } for e in last_expenses
        ],
    }


def _display_currency(db: Session, user: User, rates: dict) -> "tuple[str, Decimal]":
    """(B) Валюта отображения баланса сотрудника: если ВСЯ его активность
    (расходы/выдачи/переводы/приходы/авансы) в одной валюте — показываем в ней;
    иначе (или пусто) — сом (KGS). Сходится по построению: для одновалютного C
    сом-баланс = native×курс[C], значит native = сом/курс[C] точно. Хук исключает
    удалённые записи из distinct."""
    uid = user.id
    curs: set[str] = set()
    for c, in db.query(Expense.currency).filter(Expense.employee_id == uid).distinct():
        curs.add(c or "KGS")
    for c, in db.query(BalanceTopUp.currency).filter(
        or_(BalanceTopUp.user_id == uid, BalanceTopUp.admin_id == uid)
    ).distinct():
        curs.add(c or "KGS")
    for c, in db.query(MoneyTransfer.currency).filter(
        or_(MoneyTransfer.from_user_id == uid, MoneyTransfer.to_user_id == uid)
    ).distinct():
        curs.add(c or "KGS")
    for c, in db.query(Income.currency).filter(Income.received_by_id == uid).distinct():
        curs.add(c or "KGS")
    for c, in db.query(Advance.currency).filter(Advance.employee_id == uid).distinct():
        curs.add(c or "KGS")
    if len(curs) == 1:
        c = next(iter(curs))
        return c, rates.get(c, Decimal("1"))
    return "KGS", Decimal("1")


def _accountable_dashboard(db: Session, user: User) -> dict:
    rates = load_org_rates(db, user.org_id)
    issued = issued_total(db, user.org_id, user.id)
    spent = spent_total(db, user.org_id, user.id, rates=rates)
    m_start, m_end = month_bounds()
    monthly_spent = spent_total(db, user.org_id, user.id, start=m_start, end=m_end, rates=rates)

    spec = db.query(EmployeeSpec).filter(EmployeeSpec.user_id == user.id).first()
    monthly_limit = Decimal(str(spec.monthly_limit)) if spec else Decimal(0)
    allowed_categories = spec.allowed_categories if spec else None

    current_balance = compute_current_balance(db, user.org_id, user.id, rates=rates)
    total_received = compute_total_received(db, user.org_id, user.id, rates=rates)

    # (B) Отображаем сводные суммы в родной валюте сотрудника, если она одна.
    disp_cur, disp_rate = _display_currency(db, user, rates)

    def _disp(v: Decimal) -> float:
        return float(v / disp_rate) if disp_rate else float(v)

    # Pending заявки этого юзера (исходящие)
    pending_my_requests = (
        db.query(func.count(MoneyRequest.id))
        .filter(
            MoneyRequest.org_id == user.org_id,
            MoneyRequest.requester_id == user.id,
            MoneyRequest.status == "pending",
        )
        .scalar() or 0
    )

    last_expenses = (
        db.query(Expense).filter(Expense.employee_id == user.id)
        .order_by(Expense.spent_at.desc()).limit(5).all()
    )

    return {
        "view": "accountable",
        "totals": {
            # Старые поля — для обратной совместимости с MyDashboard
            "issued": float(issued),
            "spent": _disp(spent),
            "balance": float(issued - spent),
            # Лимит и месячный расход — в сомах (лимит задаётся в сомах, ProgressBar сравнивает их между собой)
            "monthly_spent": float(monthly_spent),
            "monthly_limit": float(monthly_limit),
            "monthly_remaining": float(monthly_limit - monthly_spent) if monthly_limit > 0 else None,
            # Новые поля — current_balance / total_received / счётчик заявок
            "current_balance": _disp(current_balance),
            "total_received": _disp(total_received),
            # (B) валюта отображения сводных карточек (родная, если одна; иначе KGS)
            "balance_currency": disp_cur,
            "pending_my_requests": int(pending_my_requests),
        },
        "allowed_categories": allowed_categories,
        "recent_expenses": [
            {
                "id": e.id, "amount": float(e.amount),
                "currency": e.currency or "KGS",
                "category": e.category.name if e.category else "—",
                "status": e.status,
                "is_verified": e.is_verified,
                "spent_at": e.spent_at.isoformat(),
                "review_comment": e.review_comment,
            } for e in last_expenses
        ],
    }
