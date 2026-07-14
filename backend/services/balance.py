"""Расчёт балансов: выдано / потрачено / остаток.

ВАЖНО: KGS-эквивалент multi-currency операций (Expense, Income, BalanceTopUp)
считается по ТЕКУЩЕМУ курсу (см. load_org_rates), а не по snapshot amount_kgs.
При смене курса все отчёты автоматически пересчитываются.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from models import (
    Advance,
    BalanceTopUp,
    ExchangeRate,
    Expense,
    Income,
    MoneyRequest,
    MoneyTransfer,
    SupplierAdvance,
    SupplierAdvanceTransaction,
)
from services.exchange import fetch_nbkr_rates, get_current_rate


APPROVED_OR_PENDING = ("approved", "pending")

# Валюты, которые поддерживаем «из коробки» (в т.ч. подтягиваем из НБКР).
DEFAULT_CURRENCIES = ["USD", "RUB", "EUR"]


# ===================== Курсы валют =====================

def load_org_rates(
    db: Session, org_id: int, currencies: Optional[list[str]] = None
) -> dict[str, Decimal]:
    """Текущие курсы X→KGS для org. KGS всегда = 1.
    Если для какой-то валюты курс не задан в БД — подтягивает из НБКР и сохраняет
    (чтобы дальнейшие запросы были быстрыми)."""
    if currencies is None:
        currencies = DEFAULT_CURRENCIES
    rates: dict[str, Decimal] = {"KGS": Decimal("1")}
    missing: list[str] = []
    for cur in currencies:
        r = get_current_rate(db, org_id, cur, "KGS")
        if r is not None:
            rates[cur] = r
        else:
            missing.append(cur)
    if missing:
        nbkr = fetch_nbkr_rates(missing)
        if nbkr:
            for iso, rate in nbkr.items():
                db.add(ExchangeRate(
                    org_id=org_id,
                    from_currency=iso,
                    to_currency="KGS",
                    rate=rate,
                    created_by_id=None,
                ))
                rates[iso] = rate
            db.commit()
    return rates


def to_kgs_expr(amount_col, currency_col, rates: dict[str, Decimal]):
    """SQL CASE: amount * rate[currency]. Для неизвестной валюты — считаем как KGS
    (else_=amount_col), чтобы запись не выпадала из расчёта молча. Лучше явная
    «приблизительная» сумма, чем потерянная."""
    whens = [
        (currency_col == iso, amount_col * float(rate))
        for iso, rate in rates.items()
    ]
    return case(*whens, else_=amount_col)


# ===================== Legacy KGS-only (Advance) =====================

def issued_total(db: Session, org_id: int, user_id: int,
                 start: Optional[datetime] = None,
                 end: Optional[datetime] = None) -> Decimal:
    q = db.query(func.coalesce(func.sum(Advance.amount), 0)).filter(
        Advance.org_id == org_id,
        Advance.employee_id == user_id,
    )
    if start:
        q = q.filter(Advance.issued_at >= start)
    if end:
        q = q.filter(Advance.issued_at < end)
    return Decimal(str(q.scalar() or 0))


def transferred_out_total(db: Session, org_id: int, user_id: int,
                          start: Optional[datetime] = None,
                          end: Optional[datetime] = None) -> Decimal:
    """Авансы, которые user выдал из своего баланса (source='transfer'). Legacy KGS."""
    q = db.query(func.coalesce(func.sum(Advance.amount), 0)).filter(
        Advance.org_id == org_id,
        Advance.issued_by_id == user_id,
        Advance.source == "transfer",
    )
    if start:
        q = q.filter(Advance.issued_at >= start)
    if end:
        q = q.filter(Advance.issued_at < end)
    return Decimal(str(q.scalar() or 0))


# ===================== Multi-currency агрегаты (live-конвертация) =====================

def spent_total(db: Session, org_id: int, user_id: int,
                start: Optional[datetime] = None,
                end: Optional[datetime] = None,
                statuses: tuple = APPROVED_OR_PENDING,
                rates: Optional[dict[str, Decimal]] = None) -> Decimal:
    """Сумма расходов юзера в KGS-эквиваленте, по ТЕКУЩЕМУ курсу."""
    if rates is None:
        rates = load_org_rates(db, org_id)
    expr = to_kgs_expr(Expense.amount, Expense.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        Expense.org_id == org_id,
        Expense.employee_id == user_id,
        Expense.status.in_(statuses),
    )
    if start:
        q = q.filter(Expense.spent_at >= start)
    if end:
        q = q.filter(Expense.spent_at < end)
    return Decimal(str(q.scalar() or 0))


def pending_total(db: Session, org_id: int, user_id: Optional[int] = None,
                  start: Optional[datetime] = None,
                  end: Optional[datetime] = None,
                  category_id: Optional[int] = None,
                  rates: Optional[dict[str, Decimal]] = None) -> Decimal:
    """Сумма pending расходов в KGS-эквиваленте, по текущему курсу."""
    if rates is None:
        rates = load_org_rates(db, org_id)
    expr = to_kgs_expr(Expense.amount, Expense.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        Expense.org_id == org_id,
        Expense.status == "pending",
    )
    if user_id is not None:
        q = q.filter(Expense.employee_id == user_id)
    if category_id is not None:
        q = q.filter(Expense.category_id == category_id)
    if start:
        q = q.filter(Expense.spent_at >= start)
    if end:
        q = q.filter(Expense.spent_at < end)
    return Decimal(str(q.scalar() or 0))


def compute_balance(db: Session, org_id: int, user_id: int) -> Decimal:
    """KGS-баланс (обратная совместимость): берём KGS-strand из per-currency расчёта."""
    return compute_balances_by_currency(db, org_id, user_id).get("KGS", Decimal(0))


def compute_balances_by_currency(db: Session, org_id: int, user_id: int) -> dict[str, Decimal]:
    """Per-currency native (НЕ конвертирует) — для отдельного отображения по каждой валюте."""
    result: dict[str, Decimal] = {}
    for cur, total in db.query(
        Advance.currency, func.coalesce(func.sum(Advance.amount), 0)
    ).filter(
        Advance.org_id == org_id,
        Advance.employee_id == user_id,
    ).group_by(Advance.currency).all():
        cur_key = cur or "KGS"
        result[cur_key] = result.get(cur_key, Decimal(0)) + Decimal(str(total or 0))
    for cur, total in db.query(
        Expense.currency, func.coalesce(func.sum(Expense.amount), 0)
    ).filter(
        Expense.org_id == org_id,
        Expense.employee_id == user_id,
        Expense.status.in_(APPROVED_OR_PENDING),
    ).group_by(Expense.currency).all():
        cur_key = cur or "KGS"
        result[cur_key] = result.get(cur_key, Decimal(0)) - Decimal(str(total or 0))
    for cur, total in db.query(
        Advance.currency, func.coalesce(func.sum(Advance.amount), 0)
    ).filter(
        Advance.org_id == org_id,
        Advance.issued_by_id == user_id,
        Advance.source == "transfer",
    ).group_by(Advance.currency).all():
        cur_key = cur or "KGS"
        result[cur_key] = result.get(cur_key, Decimal(0)) - Decimal(str(total or 0))
    return result


def month_bounds(now: Optional[datetime] = None) -> tuple[datetime, datetime]:
    now = now or datetime.utcnow()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


# ===================== Новый флоу: current_balance, total_received, total_issued =====================

def _approved_requests_in(db: Session, org_id: int, user_id: int,
                          end: Optional[datetime] = None,
                          rates: Optional[dict[str, Decimal]] = None) -> Decimal:
    """MoneyRequest — KGS-эквивалент по текущему курсу (мультивалютные с 2026-05-25)."""
    if rates is None:
        rates = load_org_rates(db, org_id)
    expr = to_kgs_expr(MoneyRequest.total_amount, MoneyRequest.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        MoneyRequest.org_id == org_id,
        MoneyRequest.requester_id == user_id,
        MoneyRequest.status == "approved",
    )
    if end:
        q = q.filter(MoneyRequest.created_at < end)
    return Decimal(str(q.scalar() or 0))


def _approved_requests_out(db: Session, org_id: int, user_id: int,
                           end: Optional[datetime] = None,
                           rates: Optional[dict[str, Decimal]] = None) -> Decimal:
    if rates is None:
        rates = load_org_rates(db, org_id)
    expr = to_kgs_expr(MoneyRequest.total_amount, MoneyRequest.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        MoneyRequest.org_id == org_id,
        MoneyRequest.approver_id == user_id,
        MoneyRequest.status == "approved",
    )
    if end:
        q = q.filter(MoneyRequest.created_at < end)
    return Decimal(str(q.scalar() or 0))


def _transfers_in(db: Session, org_id: int, user_id: int,
                  end: Optional[datetime] = None) -> Decimal:
    """MoneyTransfer в KGS-эквиваленте: amount_kgs у мультивалютных, amount у старых
    (там amount_kgs=NULL и amount уже в сомах)."""
    kgs = func.coalesce(MoneyTransfer.amount_kgs, MoneyTransfer.amount)
    q = db.query(func.coalesce(func.sum(kgs), 0)).filter(
        MoneyTransfer.org_id == org_id,
        MoneyTransfer.to_user_id == user_id,
    )
    if end:
        q = q.filter(MoneyTransfer.created_at < end)
    return Decimal(str(q.scalar() or 0))


def _transfers_out(db: Session, org_id: int, user_id: int,
                   end: Optional[datetime] = None) -> Decimal:
    kgs = func.coalesce(MoneyTransfer.amount_kgs, MoneyTransfer.amount)
    q = db.query(func.coalesce(func.sum(kgs), 0)).filter(
        MoneyTransfer.org_id == org_id,
        MoneyTransfer.from_user_id == user_id,
    )
    if end:
        q = q.filter(MoneyTransfer.created_at < end)
    return Decimal(str(q.scalar() or 0))


def _topups_in(db: Session, org_id: int, user_id: int, rates: dict[str, Decimal],
               end: Optional[datetime] = None) -> Decimal:
    """BalanceTopUp в KGS-эквиваленте по ТЕКУЩЕМУ курсу."""
    expr = to_kgs_expr(BalanceTopUp.amount, BalanceTopUp.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        BalanceTopUp.org_id == org_id,
        BalanceTopUp.user_id == user_id,
    )
    if end:
        q = q.filter(BalanceTopUp.date < end)
    return Decimal(str(q.scalar() or 0))


def _topups_out(db: Session, org_id: int, user_id: int, rates: dict[str, Decimal],
                end: Optional[datetime] = None) -> Decimal:
    """Сумма BalanceTopUp, которые юзер выдал другим (admin_id = user_id)."""
    expr = to_kgs_expr(BalanceTopUp.amount, BalanceTopUp.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        BalanceTopUp.org_id == org_id,
        BalanceTopUp.admin_id == user_id,
    )
    if end:
        q = q.filter(BalanceTopUp.date < end)
    return Decimal(str(q.scalar() or 0))


def _income_in(db: Session, org_id: int, user_id: int, rates: dict[str, Decimal],
               end: Optional[datetime] = None) -> Decimal:
    """Income в KGS-эквиваленте по ТЕКУЩЕМУ курсу."""
    expr = to_kgs_expr(Income.amount, Income.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        Income.org_id == org_id,
        Income.received_by_id == user_id,
    )
    if end:
        q = q.filter(Income.date < end)
    return Decimal(str(q.scalar() or 0))


def _expenses_approved(db: Session, org_id: int, user_id: int, rates: dict[str, Decimal],
                       end: Optional[datetime] = None) -> Decimal:
    """Конечные расходы юзера (expense_type='expense', approved+pending) в KGS.
    Transfer-Expense (expense_type='transfer') НЕ списывает — у него парный BalanceTopUp
    у получателя, и списание идёт через _topups_out (admin_id=user). Избегаем double-count.
    Расходы с payment_source='supplier_advance' ТОЖЕ не списывают баланс — деньги уже
    ушли при внесении аванса (учтено в _supplier_deposits_out). Иначе двойное списание."""
    expr = to_kgs_expr(Expense.amount, Expense.currency, rates)
    q = db.query(func.coalesce(func.sum(expr), 0)).filter(
        Expense.org_id == org_id,
        Expense.employee_id == user_id,
        Expense.status.in_(APPROVED_OR_PENDING),
        Expense.expense_type == "expense",
        Expense.payment_source == "balance",
    )
    if end:
        q = q.filter(Expense.spent_at < end)
    return Decimal(str(q.scalar() or 0))


def _supplier_deposits_out(db: Session, org_id: int, user_id: int, rates: dict[str, Decimal],
                           end: Optional[datetime] = None) -> Decimal:
    """Внесения аванса поставщику (type='deposit') — уменьшают баланс сотрудника.
    Деньги перемещаются с баланса на депозит у поставщика (не расход, в отчётах нет)."""
    expr = to_kgs_expr(SupplierAdvanceTransaction.amount, SupplierAdvance.currency, rates)
    q = (
        db.query(func.coalesce(func.sum(expr), 0))
        .join(SupplierAdvance, SupplierAdvance.id == SupplierAdvanceTransaction.advance_id)
        .filter(
            SupplierAdvance.org_id == org_id,
            SupplierAdvance.employee_id == user_id,
            SupplierAdvanceTransaction.type == "deposit",
        )
    )
    if end:
        q = q.filter(SupplierAdvanceTransaction.date < end)
    return Decimal(str(q.scalar() or 0))


def _supplier_refunds_in(db: Session, org_id: int, user_id: int, rates: dict[str, Decimal],
                         end: Optional[datetime] = None) -> Decimal:
    """Возвраты остатка депозита (type='refund') — возвращаются на баланс сотрудника."""
    expr = to_kgs_expr(SupplierAdvanceTransaction.amount, SupplierAdvance.currency, rates)
    q = (
        db.query(func.coalesce(func.sum(expr), 0))
        .join(SupplierAdvance, SupplierAdvance.id == SupplierAdvanceTransaction.advance_id)
        .filter(
            SupplierAdvance.org_id == org_id,
            SupplierAdvance.employee_id == user_id,
            SupplierAdvanceTransaction.type == "refund",
        )
    )
    if end:
        q = q.filter(SupplierAdvanceTransaction.date < end)
    return Decimal(str(q.scalar() or 0))


def compute_current_balance(db: Session, org_id: int, user_id: int,
                            rates: Optional[dict[str, Decimal]] = None,
                            end: Optional[datetime] = None) -> Decimal:
    """Накопительный остаток. Если end задан — считает суммы только до этой даты."""
    if rates is None:
        rates = load_org_rates(db, org_id)
    return (
        _approved_requests_in(db, org_id, user_id, end=end)
        + _transfers_in(db, org_id, user_id, end=end)
        + _topups_in(db, org_id, user_id, rates, end=end)
        + _income_in(db, org_id, user_id, rates, end=end)
        + _supplier_refunds_in(db, org_id, user_id, rates, end=end)
        - _approved_requests_out(db, org_id, user_id, end=end)
        - _transfers_out(db, org_id, user_id, end=end)
        - _topups_out(db, org_id, user_id, rates, end=end)
        - _expenses_approved(db, org_id, user_id, rates, end=end)
        - _supplier_deposits_out(db, org_id, user_id, rates, end=end)
    )


def compute_total_received(db: Session, org_id: int, user_id: int,
                           rates: Optional[dict[str, Decimal]] = None) -> Decimal:
    if rates is None:
        rates = load_org_rates(db, org_id)
    return (
        _approved_requests_in(db, org_id, user_id)
        + _transfers_in(db, org_id, user_id)
        + _topups_in(db, org_id, user_id, rates)
        + _income_in(db, org_id, user_id, rates)
    )


def compute_total_issued(db: Session, org_id: int, user_id: int,
                         rates: Optional[dict[str, Decimal]] = None) -> Decimal:
    """BalanceTopUp.admin_id=user_id — сумма всего, что этот user выдал другим, в KGS."""
    if rates is None:
        rates = load_org_rates(db, org_id)
    expr = to_kgs_expr(BalanceTopUp.amount, BalanceTopUp.currency, rates)
    total = db.query(func.coalesce(func.sum(expr), 0)).filter(
        BalanceTopUp.org_id == org_id,
        BalanceTopUp.admin_id == user_id,
    ).scalar()
    return Decimal(str(total or 0))
