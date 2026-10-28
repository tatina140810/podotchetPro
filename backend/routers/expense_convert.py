"""Перевод ошибочно внесённого расхода в выдачу (Тати 2026-10-28).

Расход и выдача — разные записи (expenses / balance_topups) с разным влиянием на баланс,
поэтому «сменить тип» = в ОДНОЙ транзакции создать выдачу и мягко удалить расход.
Расход не стирается: он помечается удалённым, его полный снимок пишется в журнал изменений
(record_change_log), а id созданной выдачи — в поле converted_to_topup_id ответа и в журнал.

Кто может: те же роли, что создают и правят выдачи (аудитор и выше).
Не переводятся расходы с побочными связями — их правят там, где они созданы:
передача (парная выдача получателю), авто-расход выдачи, расход по заявке, покупка с
депозита поставщика, расход с авто-приходом, расход в ожидании еженедельной выдачи.
"""
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import require_director_or_auditor
from database import get_db
from models import BalanceTopUp, Category, Department, Expense, RecordChangeLog, SheetsOutbox, User
from routers.expenses import _dept_blocked, _workspace_blocked
from routers.transfers import _sync_topup_expense
from services.audit import log_delete
from services.exchange import get_current_rate
from services.permissions import department_forbidden, member_active_workspace_id, resolve_department
from services.sheets_sync import enqueue_topup
from services.soft_delete import soft_delete

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


class ConvertToTopUp(BaseModel):
    issued_by_id: int                       # кто выдал (обязательно — у расхода такого поля нет)
    user_id: Optional[int] = None           # кому выдали; по умолчанию — сотрудник расхода
    amount: Optional[Decimal] = Field(default=None, gt=0)
    currency: Optional[Literal["KGS", "USD", "EUR", "RUB"]] = None
    date: Optional[datetime] = None
    note: Optional[str] = Field(default=None, max_length=500)
    department_id: Optional[int] = None
    payment_method: Optional[Literal["cash", "bank"]] = None


class ConvertResult(BaseModel):
    topup_id: int
    # Строка расхода уже ушла в Google-таблицу: её там нужно поправить руками
    # (выгрузка только добавляет строки и ничего в таблице не переписывает).
    sheets_note: Optional[str] = None


def _refuse_reason(e: Expense) -> Optional[str]:
    if e.expense_type != "expense" or e.to_user_id is not None:
        return "Это передача другому сотруднику — её нельзя перевести в выдачу. Удалите передачу и внесите выдачу."
    if e.source_topup_id is not None:
        return "Этот расход создан автоматически из выдачи — измените саму выдачу."
    if e.source_request_id is not None:
        return "Расход создан по заявке — его меняют через заявку."
    if e.payment_source != "balance":
        return "Расход оплачен с депозита поставщика — его нельзя перевести в выдачу."
    if e.auto_income or e.auto_income_income_id is not None:
        return "У расхода есть авто-приход — сначала снимите отметку «Учесть как приход»."
    if e.report_hold:
        return "Расход ждёт еженедельной выдачи по заявке — его меняют через отчёт по заявкам."
    return None


@router.post("/{expense_id}/convert-to-topup", response_model=ConvertResult)
def convert_expense_to_topup(
    expense_id: int,
    payload: ConvertToTopUp,
    db: Session = Depends(get_db),
    me: User = Depends(require_director_or_auditor),
):
    # FOR UPDATE: два одновременных нажатия не создадут две выдачи из одного расхода.
    e = db.query(Expense).filter(Expense.id == expense_id).with_for_update().first()
    if not e or e.org_id != me.org_id or e.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не найдено")
    if _workspace_blocked(db, me, e) or _dept_blocked(db, me, e):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не найдено")
    reason = _refuse_reason(e)
    if reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reason)

    issuer = db.get(User, payload.issued_by_id)
    if not issuer or issuer.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "«Кто выдал» не найден")
    target = db.get(User, payload.user_id if payload.user_id is not None else e.employee_id)
    if not target or target.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Получатель не найден")
    if issuer.id == target.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Выдающий и получатель — один человек")

    # Подразделение: как при обычной выдаче — привязка получателя сильнее формы.
    department_id = resolve_department(
        target, me, payload.department_id if payload.department_id is not None else e.department_id)
    if department_id is not None:
        dep = db.get(Department, department_id)
        if not dep or dep.org_id != me.org_id or department_forbidden(db, me, department_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")

    amount = Decimal(str(payload.amount if payload.amount is not None else e.amount))
    currency = payload.currency or e.currency
    # КГС-эквивалент: сумма и валюта прежние → берём зафиксированный у расхода
    # (балансу всё равно, а исторический эквивалент не «плывёт» от сегодняшнего курса).
    if amount == Decimal(str(e.amount)) and currency == e.currency and e.amount_kgs is not None:
        amount_kgs = e.amount_kgs
    elif currency == "KGS":
        amount_kgs = amount
    else:
        rate = get_current_rate(db, me.org_id, currency, "KGS")
        if rate is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"Установите курс {currency}/KGS перед выдачей в {currency}")
        amount_kgs = amount * rate

    # Категория «Подотчёт» (системная) у выдачи допустима. Реальную не переносим: выдача
    # с реальной категорией сама создала бы расход получателю — то есть вернула бы расход.
    cat = db.get(Category, e.category_id) if e.category_id is not None else None
    category_id = cat.id if cat is not None and cat.is_system else None

    t = BalanceTopUp(
        org_id=me.org_id,
        admin_id=issuer.id,
        user_id=target.id,
        amount=amount,
        currency=currency,
        amount_kgs=amount_kgs,
        note=(payload.note if payload.note is not None else e.description) or None,
        date=payload.date or e.spent_at,
        category_id=category_id,
        department_id=department_id,
        payment_method=payload.payment_method if payload.payment_method is not None else e.payment_method,
        workspace_id=member_active_workspace_id(db, target.id, me.org_id),
    )
    db.add(t)
    db.flush()
    _sync_topup_expense(db, t)  # без реальной категории авто-расхода нет — вызов для единообразия

    # Google-таблица: строка расхода ещё в очереди → снимаем её и ставим выдачу.
    # Уже выгружена → вторую строку не добавляем (было бы задвоение), говорим поправить руками.
    sheets_note = None
    queued = (db.query(SheetsOutbox)
              .filter(SheetsOutbox.entity_type == "expense", SheetsOutbox.entity_id == e.id)
              .all())
    if any(q.status == "sent" for q in queued):
        sheets_note = ("Расход уже выгружен в Google-таблицу «Локомотив» — там строку нужно "
                       "поправить вручную: таблица сама не меняется.")
    else:
        for q in queued:
            if q.status == "pending":
                q.status = "skipped"
                q.last_error = f"расход переведён в выдачу #{t.id}"
        enqueue_topup(db, t)

    log_delete(db, "expense", e, me)
    db.add(RecordChangeLog(
        org_id=me.org_id, entity_type="expense", entity_id=e.id, changed_by=me.id,
        action="convert", diff={"converted_to_topup_id": t.id},
    ))
    soft_delete(e, me)
    db.commit()
    return ConvertResult(topup_id=t.id, sheets_note=sheets_note)
