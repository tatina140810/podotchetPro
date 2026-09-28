"""Отчёт принимающего заявки на одобрении у владельца (шаг 3, Тати / Ice 2026-09-28).

Расходы, которые принимающий (Индира) провёл по упрощённым заявкам, приходят
владельцу (organizations.request_reviewer_id — Ice). Владелец:
  • одобряет строку или пачку (status approved, reviewed_by);
  • правит строку, пока она на одобрении (категория, подразделение, расчёт, сумма,
    дата, описание) — каждая правка пишется в журнал;
  • отклоняет строку с причиной: расход отменяется (soft delete, баланс сотрудника
    возвращается), заявка снова «выдано, ждём чек» и уходит принимающему на правку.
Одобрять отчёт принимающего может только владелец (и superadmin) — сама
принимающая свой отчёт не одобряет (см. также guard в routers/expenses.review).
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import (
    BalanceTopUp, Category, Department, Expense, ExpenseReceipt, MoneyRequest, Notification,
    Organization, User,
)
from schemas import (
    HandlerReportApprove, HandlerReportEdit, HandlerReportReject, HandlerReportRow,
)
from services.audit import log_delete, log_update, snapshot
from services.permissions import department_forbidden, forced_department_id
from services.push_service import build_payload, send_push_to_user_sync
from services.soft_delete import soft_delete
from routers.requests import _item_to_out, _receipt_to_out

router = APIRouter(prefix="/api/requests/handler-report", tags=["requests-report"])


def is_request_reviewer(db: Session, me: User) -> bool:
    org = db.get(Organization, me.org_id)
    return bool(org and (org.request_reviewer_id == me.id or me.role == "superadmin"))


def _require_reviewer(db: Session, me: User) -> None:
    if not is_request_reviewer(db, me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Отчёт по заявкам одобряет только назначенный владелец")


def _pair(db: Session, me: User, expense_id: int) -> tuple[Expense, MoneyRequest]:
    """Расход, проведённый по упрощённой заявке ЭТОЙ организации, и сама заявка."""
    req = db.query(MoneyRequest).filter(
        MoneyRequest.expense_id == expense_id, MoneyRequest.org_id == me.org_id,
        MoneyRequest.flow == "simple",
    ).one_or_none()
    e = db.get(Expense, expense_id)
    if req is None or e is None or e.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Строка отчёта не найдена")
    return e, req


def _row(e: Expense, req: MoneyRequest) -> HandlerReportRow:
    return HandlerReportRow(
        expense_id=e.id, request_id=req.id, request_title=req.title,
        requester_name=req.requester.name if req.requester else None,
        items=[_item_to_out(it) for it in req.items],
        category_id=e.category_id, category_name=e.category.name if e.category else None,
        department_id=e.department_id, department_name=e.department.name if e.department else None,
        payment_method=e.payment_method, amount=e.amount, currency=e.currency, amount_kgs=e.amount_kgs,
        issued_amount=req.handler_amount, spent_at=e.spent_at, status=e.status, description=e.description,
        receipts=[_receipt_to_out(r) for r in req.receipts], no_receipt=req.no_receipt,
        no_receipt_comment=req.no_receipt_comment,
        recorded_by_name=e.recorded_by.name if getattr(e, "recorded_by", None) else None,
        reviewed_by_name=e.reviewed_by.name if getattr(e, "reviewed_by", None) else None,
    )


@router.get("", response_model=List[HandlerReportRow])
def handler_report(
    status_filter: str = Query(default="pending", alias="status", pattern="^(pending|approved|all)$"),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    _require_reviewer(db, me)
    q = (db.query(Expense, MoneyRequest)
         .join(MoneyRequest, MoneyRequest.expense_id == Expense.id)
         .filter(MoneyRequest.org_id == me.org_id, MoneyRequest.flow == "simple"))
    if status_filter != "all":
        q = q.filter(Expense.status == status_filter)
    rows = q.order_by(Expense.spent_at.desc(), Expense.id.desc()).limit(1000).all()
    return [_row(e, r) for e, r in rows]


@router.patch("/{expense_id}", response_model=HandlerReportRow)
def edit_row(expense_id: int, payload: HandlerReportEdit,
             db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    _require_reviewer(db, me)
    e, req = _pair(db, me, expense_id)
    if e.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Править можно только строку на одобрении")
    before = snapshot(e)
    if payload.category_id is not None:
        cat = db.get(Category, payload.category_id)
        if not cat or cat.org_id != me.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория не найдена")
        e.category_id = cat.id
    if payload.department_id is not None:
        dep_id = forced_department_id(req.requester) or payload.department_id
        dep = db.get(Department, dep_id)
        if not dep or dep.org_id != me.org_id or department_forbidden(db, me, dep_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")
        e.department_id = dep_id
    if payload.payment_method is not None:
        e.payment_method = payload.payment_method
    if payload.spent_date is not None:
        e.spent_at = datetime.combine(payload.spent_date, datetime.min.time())
    if payload.description is not None:
        e.description = payload.description.strip() or e.description
    if payload.amount is not None:
        issued = Decimal(str(req.handler_amount))
        amount = Decimal(str(payload.amount))
        if amount > issued:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сумма больше, чем выдано по заявке")
        topup = db.get(BalanceTopUp, req.issue_topup_id) if req.issue_topup_id else None
        if topup is not None and topup.amount_kgs is not None and issued > 0:
            e.amount_kgs = (Decimal(str(topup.amount_kgs)) * amount / issued).quantize(Decimal("0.01"))
        elif (e.currency or "KGS") == "KGS":
            e.amount_kgs = amount
        e.amount = amount
    log_update(db, "expense", e, before, me)
    db.commit()
    db.refresh(e)
    return _row(e, req)


@router.post("/approve", response_model=List[HandlerReportRow])
def approve_rows(payload: HandlerReportApprove, db: Session = Depends(get_db),
                 me: User = Depends(get_current_user)):
    _require_reviewer(db, me)
    out = []
    for eid in dict.fromkeys(payload.expense_ids):  # без повторов, порядок сохраняем
        e, req = _pair(db, me, eid)
        if e.status != "pending":
            continue  # уже одобрена — повтор безвреден
        before = snapshot(e)
        e.status = "approved"
        e.reviewed_by_id = me.id
        log_update(db, "expense", e, before, me)
        out.append((e, req))
    db.commit()
    return [_row(e, r) for e, r in out]


@router.post("/{expense_id}/reject")
def reject_row(expense_id: int, payload: HandlerReportReject, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    """Отклонить строку: расход отменён (баланс сотрудника возвращается), заявка —
    снова «выдано, ждём чек», принимающему — на правку с причиной."""
    _require_reviewer(db, me)
    e, req = _pair(db, me, expense_id)
    if e.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Отклонить можно только строку на одобрении")
    log_delete(db, "expense", e, me)
    soft_delete(e, me)
    for r in db.query(ExpenseReceipt).filter(ExpenseReceipt.expense_id == e.id).all():
        db.delete(r)  # копии чеков; оригиналы остаются у заявки
    comment = payload.comment.strip()
    req.expense_id = None
    req.closed_at = None
    req.closed_by_id = None
    req.status = "issued"
    req.returned_comment = comment
    req.returned_at = datetime.utcnow()
    db.add(Notification(user_id=req.approver_id, org_id=req.org_id, type="request_returned", payload={
        "request_id": req.id, "title": req.title, "comment": comment}))
    db.commit()
    background_tasks.add_task(send_push_to_user_sync, req.approver_id, req.org_id, build_payload(
        "request_returned", {"request_id": req.id, "title": req.title, "comment": comment}))
    return {"ok": True, "request_id": req.id}
