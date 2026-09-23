"""Admin-режим — bulk import исторических данных + поиск/устранение дублей TopUp+Expense.
Каждая строка обрабатывается независимо (partial errors).

Доступ к импорту: admin/superadmin — полный. Сотрудник с флагом users.can_bulk_import —
урезанный: только СВОИ расходы (тип expense, employee = он сам); приходы и выдачи
запрещены, иначе сотрудник мог бы нарисовать себе поступление денег. Остальное
(включая статус approved у импортированных расходов) — как у админского импорта."""
import io
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_admin, require_bulk_import
from database import get_db
from models import BalanceTopUp, Category, Department, Expense, ExpenseReceipt, Income, IncomeSource, MoneyRequest, User
from schemas import (
    BulkImportError,
    BulkImportItem,
    BulkImportPayload,
    BulkImportResult,
)
from services.exchange import get_current_rate
from services.plan_limits import ensure_can_export
from services.sheets_sync import enqueue_expense, enqueue_income, enqueue_topup
from services.permissions import (
    department_forbidden,
    hidden_user_ids,
    resolve_department,
    member_active_workspace_id,
    owner_isolation_ws_id,
    workspace_details_hidden,
    workspace_member_ids,
)


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _resolve_amount_kgs(
    db: Session, org_id: int, amount: Decimal, currency: str
) -> Optional[Decimal]:
    """Возвращает KGS-эквивалент или None если currency≠KGS и курса нет."""
    if currency == "KGS":
        return amount
    rate = get_current_rate(db, org_id, currency, "KGS")
    if rate is None:
        return None
    return amount * rate


def _resolve_department(db: Session, admin: User, item: BulkImportItem, owner: User) -> int:
    """Подразделение обязательно для expense в импорте. Возвращает его id.

    Жёсткая привязка сотрудника (users.forced_department_id) сильнее того, что
    выбрано в строке импорта — как и в обычной форме расхода."""
    department_id = resolve_department(owner, admin, item.department_id)
    if department_id is None:
        raise ValueError("department_id обязателен")
    dep = db.get(Department, department_id)
    if not dep or dep.org_id != admin.org_id:
        raise ValueError(f"Подразделение id={department_id} не найдено")
    return dep.id


def _create_expense(db: Session, admin: User, item: BulkImportItem) -> None:
    if item.user_id is None:
        raise ValueError("user_id обязателен для expense")
    employee = db.get(User, item.user_id)
    if not employee or employee.org_id != admin.org_id:
        raise ValueError(f"Пользователь user_id={item.user_id} не найден")
    iso = owner_isolation_ws_id(db, admin)
    if iso is not None and employee.id not in workspace_member_ids(db, iso):
        raise ValueError("В пространстве можно вносить только по участникам пространства")
    if item.category_id is not None:
        cat = db.get(Category, item.category_id)
        if not cat or cat.org_id != admin.org_id:
            raise ValueError(f"Категория id={item.category_id} не найдена")
    department_id = _resolve_department(db, admin, item, employee)
    amount_kgs = _resolve_amount_kgs(db, admin.org_id, item.amount, item.currency)
    if amount_kgs is None:
        raise ValueError(f"Курс {item.currency}/KGS не установлен")
    # Чеки строки: новый формат (список) + legacy-поле одиночного чека.
    receipts: list[tuple[str, Optional[str]]] = []
    if item.receipt_url:
        receipts.append((item.receipt_url, None))
    for r in item.receipts or []:
        if r.url and all(r.url != u for u, _ in receipts):
            receipts.append((r.url, r.name))
    e = Expense(
        org_id=admin.org_id,
        employee_id=employee.id,
        category_id=item.category_id,
        department_id=department_id,
        amount=item.amount,
        currency=item.currency,
        amount_kgs=amount_kgs,
        description=item.description,
        status="approved",         # admin вносит сразу как утверждённый
        reviewed_by_id=admin.id,
        recorded_by_id=admin.id,   # пометка «внесено admin»
        # Помечаем по УЧАСТНИКУ-сотруднику (его пространство), а не по импортёру.
        workspace_id=member_active_workspace_id(db, employee.id, admin.org_id),
        is_personal_contribution=bool(item.is_personal_contribution),
        payment_method=item.payment_method,
        receipt_url=receipts[0][0] if receipts else None,  # legacy-поле = первый чек
        spent_at=item.date or datetime.utcnow(),
    )
    db.add(e)
    db.flush()
    enqueue_expense(db, e)
    # Чеки/документы, если приложены: дублируем в expense_receipts (единый источник галереи).
    if receipts:
        db.flush()  # нужен e.id
        for url, name in receipts:
            db.add(ExpenseReceipt(
                org_id=admin.org_id,
                expense_id=e.id,
                file_url=url,
                file_name=name,
                uploaded_by_id=employee.id,
            ))


def _create_income(db: Session, admin: User, item: BulkImportItem) -> None:
    receiver_id = item.received_by_id or item.user_id
    if receiver_id is None:
        raise ValueError("received_by_id (или user_id) обязателен для income")
    # Источник: из справочника (source_id) или свободный текст (source).
    source_id = None
    source_name = item.source
    if item.source_id is not None:
        src = db.get(IncomeSource, item.source_id)
        if not src or src.org_id != admin.org_id:
            raise ValueError(f"Источник id={item.source_id} не найден")
        source_id = src.id
        source_name = src.name
    if not source_name:
        raise ValueError("source (или source_id) обязателен для income")
    receiver = db.get(User, receiver_id)
    if not receiver or receiver.org_id != admin.org_id:
        raise ValueError(f"Получатель id={receiver_id} не найден")
    iso = owner_isolation_ws_id(db, admin)
    if iso is not None and receiver.id not in workspace_member_ids(db, iso):
        raise ValueError("В пространстве можно вносить только по участникам пространства")
    amount_kgs = _resolve_amount_kgs(db, admin.org_id, item.amount, item.currency)
    if amount_kgs is None:
        raise ValueError(f"Курс {item.currency}/KGS не установлен")
    inc = Income(
        org_id=admin.org_id,
        amount=item.amount,
        currency=item.currency,
        amount_kgs=amount_kgs,
        source=source_name,
        source_id=source_id,
        description=item.description,
        received_by_id=receiver.id,
        created_by_id=admin.id,
        payment_method=item.payment_method,
        department_id=resolve_department(receiver, admin, None),
        date=item.date or datetime.utcnow(),
    )
    db.add(inc)
    db.flush()
    enqueue_income(db, inc)


def _create_topup(db: Session, admin: User, item: BulkImportItem) -> None:
    if item.user_id is None:
        raise ValueError("user_id обязателен для topup")
    target = db.get(User, item.user_id)
    if not target or target.org_id != admin.org_id:
        raise ValueError(f"Пользователь user_id={item.user_id} не найден")
    iso = owner_isolation_ws_id(db, admin)
    if iso is not None and target.id not in workspace_member_ids(db, iso):
        raise ValueError("В пространстве можно вносить только по участникам пространства")
    # KGS-эквивалент для multi-currency TopUp
    amount_kgs = _resolve_amount_kgs(db, admin.org_id, item.amount, item.currency)
    if amount_kgs is None:
        raise ValueError(f"Курс {item.currency}/KGS не установлен")
    # «Кто выдал» — если указан явно (исторический топап от другого сотрудника),
    # ставим его; иначе — текущий admin.
    issued_by_id = admin.id
    if item.issued_by_id is not None:
        issuer = db.get(User, item.issued_by_id)
        if not issuer or issuer.org_id != admin.org_id:
            raise ValueError(f"«Кто выдал» id={item.issued_by_id} не найден")
        issued_by_id = issuer.id
    # Категория для topup опциональна — для отчётности «выдача на канцелярию» и т.п.
    if item.category_id is not None:
        cat = db.get(Category, item.category_id)
        if not cat or cat.org_id != admin.org_id:
            raise ValueError(f"Категория id={item.category_id} не найдена")
    # Подразделение для выдачи опционально (как в обычной модалке «Выдать»).
    department_id = None
    if item.department_id is not None:
        dep = db.get(Department, item.department_id)
        if not dep or dep.org_id != admin.org_id:
            raise ValueError(f"Подразделение id={item.department_id} не найдено")
        department_id = dep.id
    t = BalanceTopUp(
        org_id=admin.org_id,
        admin_id=issued_by_id,
        user_id=target.id,
        amount=item.amount,
        currency=item.currency,
        amount_kgs=amount_kgs,
        note=item.note,
        date=item.date or datetime.utcnow(),
        category_id=item.category_id,
        department_id=resolve_department(target, admin, department_id),
        payment_method=item.payment_method,
        workspace_id=iso,          # владелец импортирует в своё пространство
    )
    db.add(t)
    db.flush()
    enqueue_topup(db, t)
    # Если категория не «Подотчёт» — авто-Expense получателю (как в /topup endpoint).
    from routers.transfers import _sync_topup_expense
    _sync_topup_expense(db, t)
    # Авто-расход от выдачи тоже метим пространством (иначе утечёт в общий учёт).
    if iso is not None:
        auto = db.query(Expense).filter(Expense.source_topup_id == t.id).first()
        if auto is not None:
            auto.workspace_id = iso


_HANDLERS = {
    "expense": _create_expense,
    "income": _create_income,
    "topup": _create_topup,
}


# ===================== Дубли TopUp + Expense =====================
# Логика пользователя: "Билим выдал Чоро 9000$ на закр комп" иногда оформляется
# двумя записями (TopUp + Expense у получателя). Это двойной учёт.
# Find — показать подозрительные пары. Fix — слить (перенести категорию/note в Expense,
# удалить TopUp), оставив Expense у получателя с recorded_by_id = тот, кто выдавал.

@router.post("/find-duplicates")
def find_duplicates(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Ищет пары TopUp + Expense, где:
    - TopUp.user_id == Expense.employee_id (получатель = тот, кто оформил расход)
    - currency совпадают
    - суммы совпадают (±1%)
    - даты в пределах ±3 дней
    Возвращает список потенциальных дублей для ручного подтверждения."""
    topups = (
        db.query(BalanceTopUp)
        .filter(BalanceTopUp.org_id == admin.org_id)
        .all()
    )
    expenses = (
        db.query(Expense)
        .filter(Expense.org_id == admin.org_id, Expense.status.in_(("approved", "pending")))
        .all()
    )
    # Индекс расходов по (employee_id, currency) для быстрого поиска
    exp_idx: dict[tuple, list[Expense]] = {}
    for e in expenses:
        exp_idx.setdefault((e.employee_id, e.currency), []).append(e)

    pairs: list[dict] = []
    for t in topups:
        candidates = exp_idx.get((t.user_id, t.currency), [])
        for e in candidates:
            # ±1% по сумме
            t_amt = Decimal(str(t.amount))
            e_amt = Decimal(str(e.amount))
            if t_amt == 0:
                continue
            diff_pct = abs(t_amt - e_amt) / t_amt
            if diff_pct > Decimal("0.01"):
                continue
            # ±3 дня
            days_diff = abs((t.date.date() - e.spent_at.date()).days)
            if days_diff > 3:
                continue
            pairs.append({
                "topup": {
                    "id": t.id,
                    "date": t.date.isoformat(),
                    "issued_by": t.admin.name if t.admin else None,
                    "issued_by_id": t.admin_id,
                    "receiver": t.user.name if t.user else None,
                    "receiver_id": t.user_id,
                    "amount": float(t.amount),
                    "currency": t.currency,
                    "note": t.note,
                    "category_id": t.category_id,
                    "category_name": t.category.name if t.category else None,
                },
                "expense": {
                    "id": e.id,
                    "date": e.spent_at.isoformat(),
                    "employee": e.employee.name if e.employee else None,
                    "employee_id": e.employee_id,
                    "amount": float(e.amount),
                    "currency": e.currency,
                    "description": e.description,
                    "category_id": e.category_id,
                    "category_name": e.category.name if e.category else None,
                },
                "days_diff": days_diff,
                "amount_diff_pct": float(diff_pct * 100),
            })
    return {"pairs": pairs}


@router.post("/fix-duplicate/{topup_id}")
def fix_duplicate(
    topup_id: int,
    expense_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Сливает дубль: переносит category_id + note из TopUp в Expense,
    проставляет Expense.recorded_by_id = TopUp.admin_id (кто выдавал из своих).
    Затем удаляет TopUp.

    Эффект: вместо двух записей остаётся одна Expense у получателя с указанием,
    что финансировал Билим (через recorded_by_id)."""
    t = db.get(BalanceTopUp, topup_id)
    if not t or t.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "TopUp не найден")
    e = db.get(Expense, expense_id)
    if not e or e.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense не найден")

    # Перенос: category из TopUp → в Expense (если у Expense пусто или хочется заменить)
    if t.category_id is not None:
        e.category_id = t.category_id
    # description: если у Expense пусто — берём note из TopUp
    if not e.description and t.note:
        e.description = t.note
    # recorded_by_id — кто финансировал (выдал из своих)
    e.recorded_by_id = t.admin_id
    db.delete(t)
    db.commit()
    return {
        "ok": True,
        "expense_id": e.id,
        "topup_deleted": topup_id,
        "new_category_id": e.category_id,
        "recorded_by_id": e.recorded_by_id,
    }


def _recent_operations_rows(
    db: Session,
    admin: User,
    *,
    limit: int,
    offset: int = 0,
    employee_id: Optional[int] = None,
    category_id: Optional[int] = None,
    department_id: Optional[int] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    kind: Optional[str] = None,
    payment_method: Optional[str] = None,
) -> tuple[list[dict], int]:
    """Единая выборка «последних операций» (Expense + Income + TopUp + Request)
    с фильтрами и правами. Используется и списком на экране импорта, и Excel-выгрузкой,
    чтобы фильтры и видимость строк считались ровно одной формулой.
    employee_id: для expense=employee_id, income=received_by_id, topup=user_id.
    category_id: применяется только к Expense и TopUp (у Income нет категории —
    при выбранной категории Income исключаются).
    kind: фильтр по типу операции (expense | income | topup | request); None = все типы.
    Возвращает (строки среза [offset : offset+limit], total)."""
    offset = max(0, offset)
    # date_to включающий: до конца дня (фронт шлёт начало дня)
    date_to_exclusive = date_to + timedelta(days=1) if date_to else None

    # ---- Базовые запросы с применением фильтров (для total и для выборки) ----
    eq = db.query(Expense).filter(Expense.org_id == admin.org_id)
    iq = db.query(Income).filter(Income.org_id == admin.org_id)
    tq = db.query(BalanceTopUp).filter(BalanceTopUp.org_id == admin.org_id)
    rq = db.query(MoneyRequest).filter(MoneyRequest.org_id == admin.org_id)
    # Флаг: показывать ли Income/Requests (исключаем когда фильтр по категории — у них её нет;
    # Income исключаем и при фильтре по подразделению — у прихода нет подразделения).
    # kind (если задан) дополнительно сужает до одного типа операции.
    # «Приход» (kind="income") трактуем как ВСЁ полученное сотрудником: внешний приход
    # (Income) + выдача на баланс (BalanceTopUp) — это совпадает с разделом «Приходы»
    # в отчёте по сотруднику. «Выдача» (kind="topup") — только выдачи.
    show_expense = kind is None or kind == "expense"
    show_topup = kind is None or kind == "topup" or kind == "income"
    # Income теперь может иметь подразделение (технические авто-приходы), поэтому
    # при фильтре по подразделению приходы НЕ исключаем — фильтруем их по department_id ниже.
    include_income = category_id is None and (kind is None or kind == "income")
    include_requests = category_id is None and (kind is None or kind == "request")
    # Форма расчёта (нал/безнал) есть у расхода, прихода и выдачи; у заявки её нет,
    # поэтому при таком фильтре заявки из списка выпадают.
    if payment_method is not None:
        eq = eq.filter(Expense.payment_method == payment_method)
        iq = iq.filter(Income.payment_method == payment_method)
        tq = tq.filter(BalanceTopUp.payment_method == payment_method)
        include_requests = False

    if employee_id is not None:
        eq = eq.filter(Expense.employee_id == employee_id)
        iq = iq.filter(Income.received_by_id == employee_id)
        tq = tq.filter(
            (BalanceTopUp.user_id == employee_id) |
            (BalanceTopUp.admin_id == employee_id)
        )
        rq = rq.filter(
            (MoneyRequest.requester_id == employee_id) |
            (MoneyRequest.approver_id == employee_id)
        )
    if category_id is not None:
        eq = eq.filter(Expense.category_id == category_id)
        tq = tq.filter(BalanceTopUp.category_id == category_id)
    if department_id is not None:
        eq = eq.filter(Expense.department_id == department_id)
        tq = tq.filter(BalanceTopUp.department_id == department_id)
        iq = iq.filter(Income.department_id == department_id)
        rq = rq.filter(MoneyRequest.department_id == department_id)
    # Фича 2: операции конфиденциальных сотрудников скрыты (для admin/auditor; superadmin видит всё).
    hidden = hidden_user_ids(db, admin)
    if hidden:
        eq = eq.filter(Expense.employee_id.notin_(hidden))
        iq = iq.filter(Income.received_by_id.notin_(hidden))
        tq = tq.filter(BalanceTopUp.admin_id.notin_(hidden), BalanceTopUp.user_id.notin_(hidden))
        rq = rq.filter(MoneyRequest.requester_id.notin_(hidden), MoneyRequest.approver_id.notin_(hidden))
    # Изоляция владельца пространства: только операции его пространства.
    iso = owner_isolation_ws_id(db, admin)
    if iso is not None:
        # Владелец: только операции его пространства.
        members = workspace_member_ids(db, iso)
        eq = eq.filter(Expense.workspace_id == iso)
        iq = iq.filter(Income.received_by_id.in_(members))
        tq = tq.filter(BalanceTopUp.workspace_id == iso)
        rq = rq.filter(MoneyRequest.requester_id.in_(members), MoneyRequest.approver_id.in_(members))
    elif workspace_details_hidden(db, admin):
        # Общий admin/auditor: историю пространств не показываем (детализация скрыта).
        eq = eq.filter(Expense.workspace_id.is_(None))
        tq = tq.filter(BalanceTopUp.workspace_id.is_(None))
    if amount_min is not None:
        eq = eq.filter(Expense.amount >= amount_min)
        iq = iq.filter(Income.amount >= amount_min)
        tq = tq.filter(BalanceTopUp.amount >= amount_min)
        rq = rq.filter(MoneyRequest.total_amount >= amount_min)
    if amount_max is not None:
        eq = eq.filter(Expense.amount <= amount_max)
        iq = iq.filter(Income.amount <= amount_max)
        tq = tq.filter(BalanceTopUp.amount <= amount_max)
        rq = rq.filter(MoneyRequest.total_amount <= amount_max)
    rq_date = func.coalesce(MoneyRequest.approved_at, MoneyRequest.created_at)
    if date_from is not None:
        eq = eq.filter(Expense.spent_at >= date_from)
        iq = iq.filter(Income.date >= date_from)
        tq = tq.filter(BalanceTopUp.date >= date_from)
        rq = rq.filter(rq_date >= date_from)
    if date_to_exclusive is not None:
        eq = eq.filter(Expense.spent_at < date_to_exclusive)
        iq = iq.filter(Income.date < date_to_exclusive)
        tq = tq.filter(BalanceTopUp.date < date_to_exclusive)
        rq = rq.filter(rq_date < date_to_exclusive)

    total = (eq.count() if show_expense else 0) + (iq.count() if include_income else 0) + (tq.count() if show_topup else 0) + (rq.count() if include_requests else 0)

    # Точный итог по ВСЕМУ фильтру (не по странице) — по каждой валюте отдельно:
    # складывать разные валюты нельзя. Считаем в БД, чтобы не зависеть от пагинации.
    totals: dict[str, Decimal] = {}
    # Та же сумма, но с разбивкой по форме расчёта: {"cash": {"RUB": ...}, "bank": {...},
    # "unset": {...}} — «наличные / безнал / не указано» в шапке списка.
    by_method: dict[str, dict[str, Decimal]] = {}

    def _add_totals(query, amount_col, currency_col, method_col=None) -> None:
        cols = [currency_col] + ([method_col] if method_col is not None else [])
        rows_agg = query.with_entities(
            *cols, func.coalesce(func.sum(amount_col), 0)
        ).group_by(*cols).all()
        for row in rows_agg:
            cur = row[0] or "KGS"
            amt = Decimal(str(row[-1] or 0))
            totals[cur] = totals.get(cur, Decimal("0")) + amt
            if method_col is not None:
                key = row[1] or "unset"
                by_method.setdefault(key, {})
                by_method[key][cur] = by_method[key].get(cur, Decimal("0")) + amt

    if show_expense:
        _add_totals(eq, Expense.amount, Expense.currency, Expense.payment_method)
    if include_income:
        _add_totals(iq, Income.amount, Income.currency, Income.payment_method)
    if show_topup:
        _add_totals(tq, BalanceTopUp.amount, BalanceTopUp.currency, BalanceTopUp.payment_method)
    if include_requests:
        # У заявки формы расчёта нет — в разбивку она не попадает, только в общий итог.
        _add_totals(rq, MoneyRequest.total_amount, MoneyRequest.currency)

    # Берём из каждого типа по (offset + limit) последних — этого хватит чтобы
    # после слияния и сортировки корректно вернуть срез [offset : offset+limit].
    take = offset + limit
    rows: list[dict] = []

    expense_rows = eq.order_by(Expense.spent_at.desc()).limit(take).all() if show_expense else []
    for e in expense_rows:
        recs = [{"id": r.id, "url": r.file_url, "name": r.file_name} for r in e.receipts]
        if not recs and e.receipt_url:  # legacy одиночный чек
            recs = [{"id": None, "url": e.receipt_url, "name": None}]
        rows.append({
            "kind": "expense",
            "id": e.id,
            "date": e.spent_at.isoformat(),
            "who": e.employee.name if e.employee else None,
            "employee_id": e.employee_id,
            "category_id": e.category_id,
            "amount": float(e.amount),
            "currency": e.currency,
            "description": e.description,
            "category_name": e.category.name if e.category else None,
            "status": e.status,
            "is_personal_contribution": bool(e.is_personal_contribution),
            "expense_type": e.expense_type,
            "department_id": e.department_id,
            "payment_method": e.payment_method,
            "receipts": recs,
        })

    if include_income:
        for i in iq.order_by(Income.date.desc()).limit(take).all():
            rows.append({
                "kind": "income",
                "id": i.id,
                "date": i.date.isoformat(),
                "who": i.received_by.name if i.received_by else None,
                "received_by_id": i.received_by_id,
                "amount": float(i.amount),
                "currency": i.currency,
                "description": i.description,
                "source": i.source,
                "department_id": i.department_id,
                "payment_method": i.payment_method,
            })

    topup_rows = tq.order_by(BalanceTopUp.date.desc()).limit(take).all() if show_topup else []
    for t in topup_rows:
        rows.append({
            "kind": "topup",
            "id": t.id,
            "date": t.date.isoformat(),
            "issued_by": t.admin.name if t.admin else None,
            "issued_by_id": t.admin_id,
            "who": t.user.name if t.user else None,
            "user_id": t.user_id,
            "category_id": t.category_id,
            "department_id": t.department_id,
            "amount": float(t.amount),
            "currency": t.currency,
            "note": t.note,
            "category_name": t.category.name if t.category else None,
            "payment_method": t.payment_method,
        })

    if include_requests:
        for r in rq.order_by(rq_date.desc()).limit(take).all():
            effective_date = r.approved_at or r.created_at
            rows.append({
                "kind": "request",
                "id": r.id,
                "date": effective_date.isoformat(),
                "who": r.requester.name if r.requester else None,
                "issued_by": r.approver.name if r.approver else None,
                "issued_by_id": r.approver_id,
                "employee_id": r.requester_id,
                "amount": float(r.total_amount),
                "currency": r.currency,
                "description": r.title,
                "source": r.status,
            })

    # Сортируем по date desc, затем по kind+id для устойчивого порядка
    rows.sort(key=lambda r: (r["date"], r["kind"], r["id"]), reverse=True)
    return (
        rows[offset : offset + limit],
        total,
        {
            "by_currency": {k: float(v) for k, v in totals.items()},
            "by_method": {
                m: {c: float(v) for c, v in cur_map.items()}
                for m, cur_map in by_method.items()
            },
        },
    )


@router.get("/recent-operations")
def recent_operations(
    limit: int = 30,
    offset: int = 0,
    employee_id: Optional[int] = None,
    category_id: Optional[int] = None,
    department_id: Optional[int] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    kind: Optional[str] = None,
    payment_method: Optional[str] = Query(default=None, pattern="^(cash|bank)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Последние N операций org с пагинацией и фильтрами. Возвращает {items, total, has_more}."""
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    page, total, totals = _recent_operations_rows(
        db, admin,
        limit=limit,
        offset=offset,
        employee_id=employee_id,
        category_id=category_id,
        department_id=department_id,
        amount_min=amount_min,
        amount_max=amount_max,
        date_from=date_from,
        date_to=date_to,
        kind=kind,
        payment_method=payment_method,
    )
    return {
        "items": page,
        "total": total,
        # Итог по всему фильтру, по валютам: {"RUB": 1234.5, "KGS": 100.0}
        "totals": totals["by_currency"],
        # Он же с разбивкой «наличные / безнал / не указано»
        "totals_by_method": totals["by_method"],
        "has_more": (offset + limit) < total,
    }


# Потолок строк одной выгрузки: экспорт идёт одним запросом в память,
# без него большой org мог бы уронить сервер на openpyxl.
RECENT_OPS_EXPORT_MAX_ROWS = 10000

_PAYMENT_METHOD_RU = {"cash": "Наличные", "bank": "Безнал"}

_RECENT_OPS_KIND_RU = {
    "expense": "Расход",
    "income": "Приход",
    "topup": "Выдача",
    "request": "Заявка",
}


def _recent_op_counterparty(row: dict) -> str:
    """«Кто / Кому» — ровно как в таблице на экране."""
    who = row.get("who") or ""
    issued_by = row.get("issued_by") or ""
    if row["kind"] == "topup" and issued_by:
        return f"{issued_by} -> {who or '—'}"
    if row["kind"] == "request" and issued_by:
        return f"{who or '?'} -> {issued_by}"
    return who or "—"


@router.get("/recent-operations/export.xlsx")
def recent_operations_export(
    employee_id: Optional[int] = None,
    category_id: Optional[int] = None,
    department_id: Optional[int] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    kind: Optional[str] = None,
    payment_method: Optional[str] = Query(default=None, pattern="^(cash|bank)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Excel-выгрузка «Последних операций» по ТЕМ ЖЕ фильтрам, что и на экране,
    но по всем страницам сразу (до RECENT_OPS_EXPORT_MAX_ROWS строк)."""
    ensure_can_export(db, admin)
    rows, total, _totals = _recent_operations_rows(
        db, admin,
        limit=RECENT_OPS_EXPORT_MAX_ROWS,
        offset=0,
        employee_id=employee_id,
        category_id=category_id,
        department_id=department_id,
        amount_min=amount_min,
        amount_max=amount_max,
        date_from=date_from,
        date_to=date_to,
        kind=kind,
        payment_method=payment_method,
    )

    wb = Workbook()
    ws = wb.active
    ws.title = "Операции"

    headers = ["Дата", "Тип", "Кто / Кому", "Сумма", "Валюта", "Форма расчёта",
               "Категория / Источник", "Комментарий"]
    ws.append(headers)
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="4F46E5")
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill

    for r in rows:
        try:
            date_txt = datetime.fromisoformat(r["date"]).strftime("%d.%m.%Y")
        except (TypeError, ValueError):
            date_txt = (r.get("date") or "")[:10]
        ws.append([
            date_txt,
            _RECENT_OPS_KIND_RU.get(r["kind"], r["kind"]),
            _recent_op_counterparty(r),
            float(r["amount"]) if r.get("amount") is not None else 0,
            r.get("currency") or "",
            _PAYMENT_METHOD_RU.get(r.get("payment_method"), ""),
            r.get("category_name") or r.get("source") or "—",
            r.get("description") or r.get("note") or "",
        ])

    # Подытоги по каждой валюте: единого SUM нет намеренно — в выгрузке валюты
    # смешаны (KGS/USD/EUR/RUB) и складывать их вместе некорректно.
    # Суммируем в Decimal (не во float) — накопление копеек в float даёт хвосты.
    totals: dict[str, Decimal] = {}
    for r in rows:
        if r.get("amount") is None:
            continue
        cur = r.get("currency") or ""
        totals[cur] = totals.get(cur, Decimal("0")) + Decimal(str(r["amount"]))
    if totals:
        ws.append([])
        total_font = Font(bold=True)
        for cur, tot in sorted(totals.items()):
            ws.append(["", "", "ИТОГО", float(tot), cur, "", "", ""])
            for cell in ws[ws.max_row]:
                cell.font = total_font

    if total > len(rows):
        ws.append([])
        ws.append(["", "", f"Показаны первые {len(rows)} из {total} операций — сузьте фильтр"])

    widths = [12, 12, 30, 16, 8, 14, 26, 44]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w
    for row_idx in range(2, ws.max_row + 1):
        ws.cell(row=row_idx, column=4).number_format = '#,##0.00'

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    fname = f"operations_{datetime.now().strftime('%Y-%m-%d')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{fname}\"; filename*=UTF-8''{quote(fname)}",
        },
    )


def _enforce_self_import(db: Session, me: User, item: BulkImportItem) -> None:
    """Ограничения импорта для сотрудника с флагом (не admin/superadmin):
    только свои расходы. Проверка в сервисе, а не в UI."""
    if me.role in ("admin", "superadmin"):
        return
    if item.type != "expense":
        raise ValueError("Можно импортировать только расходы")
    if item.user_id is not None and item.user_id != me.id:
        raise ValueError("Можно импортировать только свои расходы")
    item.user_id = me.id
    if item.department_id is not None and department_forbidden(db, me, item.department_id):
        raise ValueError(f"Подразделение id={item.department_id} не найдено")


@router.post(
    "/bulk-import",
    response_model=BulkImportResult,
    status_code=status.HTTP_200_OK,
)
def bulk_import(
    payload: BulkImportPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_bulk_import),
):
    """Импорт массива операций. Каждая строка — своя мини-транзакция:
    при ошибке откатывается только она, остальные продолжают.

    Сотруднику с флагом can_bulk_import доступны только свои расходы —
    см. _enforce_self_import.
    """
    created = 0
    errors: list[BulkImportError] = []
    for idx, item in enumerate(payload.items):
        handler = _HANDLERS.get(item.type)
        if handler is None:
            errors.append(BulkImportError(index=idx, error=f"Неизвестный type: {item.type}"))
            continue
        try:
            _enforce_self_import(db, admin, item)
            handler(db, admin, item)
            db.commit()
            created += 1
        except Exception as e:
            db.rollback()
            errors.append(BulkImportError(index=idx, error=str(e)))
    return BulkImportResult(created=created, errors=errors)
