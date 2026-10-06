"""Отчёт «Цепочка расходов»: куда ушли деньги человека по всей цепочке его
дальнейших выдач — до конечных расходов (Ice → Индира → её подотчётные → ...).

Правила, на которых держится верность цифр:
- выдача / перевод / заявка ВНУТРИ цепочки — не расход, а перемещение: расход
  считается один раз — у того, кто реально потратил;
- все суммы в сомах по ТЕКУЩЕМУ курсу и по тем же фильтрам/датам, что и баланс
  (services.balance), поэтому «остаток на начало/конец» узла — это
  compute_current_balance на эти даты, то же число, что в карточке сотрудника;
- по каждому узлу сверка: начало + получено − потрачено − передано = конец;
  по цепочке целиком внутренние передачи взаимно сокращаются:
  начало + приходы извне = расходы + ушло из цепочки + конец.
Цепочка строится по реальным движениям денег за период (не по supervisor_id).
Каждый человек в дереве один раз (родитель — первый, кто выдал ему деньги, в
порядке обхода в ширину); получение от второго человека цепочки видно в узле.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models import (
    BalanceTopUp,
    Category,
    Expense,
    ExpenseReceipt,
    Income,
    MoneyRequest,
    MoneyTransfer,
    SupplierAdvance,
    SupplierAdvanceTransaction,
    User,
)
from services.balance import APPROVED_OR_PENDING, load_org_rates

MAX_DEPTH = 8                      # защита от бесконечной цепочки
CHECK_TOLERANCE = Decimal("0.05")  # копеечные расхождения float-курса в SQL баланса
HIDDEN_LABEL = "Скрытый сотрудник"
WS_MASK_LABEL = "Проектное пространство"

# Типы движений, которые связывают двух людей (по ним строится дерево).
LINK_KINDS = ("topup", "transfer", "request")


@dataclass
class Move:
    kind: str                 # topup | transfer | request | income | expense | supplier_deposit | supplier_refund
    date: datetime
    amount: Decimal           # в исходной валюте
    currency: str
    kgs: Decimal              # сомы по текущему курсу (как в балансе)
    src: Optional[int]        # кто отдал (None — извне: приход, возврат от поставщика)
    dst: Optional[int]        # кто получил (None — наружу: расход, аванс поставщику)
    ref_id: int
    note: Optional[str] = None
    label: Optional[str] = None      # категория / источник / поставщик
    category_id: Optional[int] = None
    status: Optional[str] = None
    report_hold: bool = False
    auto: bool = False               # авто-расход из выдачи с категорией
    receipts: int = 0
    workspace_id: Optional[int] = None  # для маскировки деталей пространств


@dataclass
class Node:
    user_id: int
    name: str
    parent_id: Optional[int]
    depth: int
    moves: list[Move] = field(default_factory=list)


def _to_kgs(amount, currency: Optional[str], rates: dict[str, Decimal]) -> Decimal:
    """То же правило, что services.balance.to_kgs_expr: неизвестная валюта = сомы."""
    a = Decimal(str(amount or 0))
    rate = rates.get(currency or "KGS")
    return a * rate if rate is not None else a


def _in_period(q, col, start: Optional[datetime], end: Optional[datetime]):
    if start is not None:
        q = q.filter(col >= start)
    if end is not None:
        q = q.filter(col < end)
    return q


def _category_labels(db: Session, org_id: int) -> dict[int, str]:
    cats = db.query(Category).filter(Category.org_id == org_id).all()
    by_id = {c.id: c for c in cats}
    out = {}
    for c in cats:
        parent = by_id.get(c.parent_id) if c.parent_id else None
        out[c.id] = f"{parent.name} / {c.name}" if parent else c.name
    return out


def load_moves(db: Session, org_id: int, uid: int, start: Optional[datetime],
               end: Optional[datetime], rates: dict[str, Decimal],
               cat_labels: dict[int, str]) -> list[Move]:
    """Все движения денег человека за период — ровно то, что меняет его баланс
    (фильтры и колонки дат совпадают с services.balance)."""
    moves: list[Move] = []

    # Выдачи (BalanceTopUp): admin_id отдал → user_id получил. Выдача самому себе
    # в балансе взаимно гасится — пропускаем.
    q = db.query(BalanceTopUp).filter(
        BalanceTopUp.org_id == org_id,
        (BalanceTopUp.user_id == uid) | (BalanceTopUp.admin_id == uid),
        BalanceTopUp.user_id != BalanceTopUp.admin_id,
    )
    for t in _in_period(q, BalanceTopUp.date, start, end).all():
        moves.append(Move(
            kind="topup", date=t.date, amount=Decimal(str(t.amount)), currency=t.currency,
            kgs=_to_kgs(t.amount, t.currency, rates), src=t.admin_id, dst=t.user_id,
            ref_id=t.id, note=t.note, label=cat_labels.get(t.category_id),
            category_id=t.category_id, report_hold=bool(t.report_hold),
            workspace_id=t.workspace_id,
        ))

    # Переводы между сотрудниками (баланс считает в сомах как amount_kgs/amount).
    q = db.query(MoneyTransfer).filter(
        MoneyTransfer.org_id == org_id,
        (MoneyTransfer.to_user_id == uid) | (MoneyTransfer.from_user_id == uid),
        MoneyTransfer.to_user_id != MoneyTransfer.from_user_id,
    )
    for t in _in_period(q, MoneyTransfer.created_at, start, end).all():
        kgs = Decimal(str(t.amount_kgs if t.amount_kgs is not None else t.amount))
        moves.append(Move(
            kind="transfer", date=t.created_at, amount=Decimal(str(t.amount)),
            currency=t.currency or "KGS", kgs=kgs, src=t.from_user_id, dst=t.to_user_id,
            ref_id=t.id, note=t.note,
        ))

    # Одобренные заявки старого типа: approver отдал → requester получил.
    q = db.query(MoneyRequest).filter(
        MoneyRequest.org_id == org_id,
        MoneyRequest.status == "approved",
        (MoneyRequest.requester_id == uid) | (MoneyRequest.approver_id == uid),
        MoneyRequest.requester_id != MoneyRequest.approver_id,
    )
    for r in _in_period(q, MoneyRequest.created_at, start, end).all():
        moves.append(Move(
            kind="request", date=r.approved_at or r.created_at,
            amount=Decimal(str(r.total_amount)), currency=r.currency or "KGS",
            kgs=_to_kgs(r.total_amount, r.currency, rates), src=r.approver_id,
            dst=r.requester_id, ref_id=r.id, note=r.title,
        ))

    # Приходы извне.
    q = db.query(Income).filter(Income.org_id == org_id, Income.received_by_id == uid)
    for i in _in_period(q, Income.date, start, end).all():
        moves.append(Move(
            kind="income", date=i.date, amount=Decimal(str(i.amount)), currency=i.currency,
            kgs=_to_kgs(i.amount, i.currency, rates), src=None, dst=uid, ref_id=i.id,
            note=i.description, label=i.source,
        ))

    # Конечные расходы — только те, что списывают баланс (как _expenses_approved):
    # transfer-расход учтён парной выдачей, расход с депозита — авансом поставщику.
    q = db.query(Expense).filter(
        Expense.org_id == org_id,
        Expense.employee_id == uid,
        Expense.status.in_(APPROVED_OR_PENDING),
        Expense.expense_type == "expense",
        Expense.payment_source == "balance",
    )
    expenses = _in_period(q, Expense.spent_at, start, end).all()
    receipts = _receipt_counts(db, [e.id for e in expenses])
    for e in expenses:
        cnt = receipts.get(e.id, 0) or (1 if e.receipt_url else 0)
        moves.append(Move(
            kind="expense", date=e.spent_at, amount=Decimal(str(e.amount)),
            currency=e.currency, kgs=_to_kgs(e.amount, e.currency, rates), src=uid,
            dst=None, ref_id=e.id, note=e.description,
            label=cat_labels.get(e.category_id) or "Без категории",
            category_id=e.category_id, status=e.status,
            report_hold=bool(e.report_hold), auto=e.source_topup_id is not None,
            receipts=cnt, workspace_id=e.workspace_id,
        ))

    # Авансы поставщикам: внесение уменьшает баланс, возврат — увеличивает.
    q = (
        db.query(SupplierAdvanceTransaction, SupplierAdvance)
        .join(SupplierAdvance, SupplierAdvance.id == SupplierAdvanceTransaction.advance_id)
        .filter(
            SupplierAdvance.org_id == org_id,
            SupplierAdvance.employee_id == uid,
            SupplierAdvanceTransaction.type.in_(("deposit", "refund")),
        )
    )
    for tx, adv in _in_period(q, SupplierAdvanceTransaction.date, start, end).all():
        deposit = tx.type == "deposit"
        moves.append(Move(
            kind="supplier_deposit" if deposit else "supplier_refund", date=tx.date,
            amount=Decimal(str(tx.amount)), currency=adv.currency,
            kgs=_to_kgs(tx.amount, adv.currency, rates),
            src=uid if deposit else None, dst=None if deposit else uid,
            ref_id=tx.id, label=adv.supplier_name,
        ))
    return moves


def _receipt_counts(db: Session, expense_ids: list[int]) -> dict[int, int]:
    if not expense_ids:
        return {}
    from sqlalchemy import func
    rows = (
        db.query(ExpenseReceipt.expense_id, func.count(ExpenseReceipt.id))
        .filter(ExpenseReceipt.expense_id.in_(expense_ids))
        .group_by(ExpenseReceipt.expense_id)
        .all()
    )
    return {eid: n for eid, n in rows}


def build_chain(db: Session, org_id: int, root_id: int, start: Optional[datetime],
                end: Optional[datetime], allowed=lambda uid: True) -> list[Node]:
    """Обход в ширину по выдачам/переводам/заявкам за период. allowed(uid) — можно
    ли включать человека в цепочку (права зрителя); недоступный остаётся снаружи."""
    rates = load_org_rates(db, org_id)
    cat_labels = _category_labels(db, org_id)
    names = {u.id: u.name for u in db.query(User).filter(User.org_id == org_id).all()}

    nodes: dict[int, Node] = {}
    order: list[int] = []
    queue: list[tuple[int, Optional[int], int]] = [(root_id, None, 0)]
    while queue:
        uid, parent, depth = queue.pop(0)
        if uid in nodes:
            continue
        node = Node(uid, names.get(uid, f"#{uid}"), parent, depth,
                    load_moves(db, org_id, uid, start, end, rates, cat_labels))
        nodes[uid] = node
        order.append(uid)
        if depth >= MAX_DEPTH:
            continue
        # Детей — по убыванию выданной суммы (крупные получатели первыми).
        given: dict[int, Decimal] = defaultdict(Decimal)
        for m in node.moves:
            if m.kind in LINK_KINDS and m.src == uid and m.dst is not None:
                given[m.dst] += m.kgs
        for child, _ in sorted(given.items(), key=lambda kv: -kv[1]):
            if child not in nodes and allowed(child):
                queue.append((child, uid, depth + 1))
    return [nodes[u] for u in order]
