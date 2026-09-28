"""Упрощённые заявки (Тати / Ice, 2026-09-28).

Путь заявки:
  1. Сотрудник пишет свободно (описание, заказчик, кол-во, сумма, комментарий) —
     заявка сразу уходит «принимающему» организации (organizations.request_handler_id,
     в «Исаадат» — Индира). Статус pending.
  2. Принимающий «Одобрить»: разноска как в «Импорте истории» — категория,
     подразделение, нал/безнал, сумма и валюта к выдаче, дата, комментарий.
     Статус accepted. ДЕНЬГИ НЕ ДВИГАЮТСЯ — заявка копится у принимающего.
  3. «Выдал»: выдача balance_topups принимающий → заявитель (у принимающего минус,
     у заявителя плюс). Статус issued, заявителю — «ждём отчёт».
  4. Чек (заявитель или принимающий прикладывает) или «нет чека» + комментарий →
     принимающий «Провести расход»: расход ЗАЯВИТЕЛЯ (у него минус), внёс —
     принимающий (recorded_by). Статус closed. Расход в статусе pending — его
     одобряет владелец в отчёте принимающего (шаг 3).

Статус 'approved' здесь НЕ используется: он двигает деньги сам
(services/balance._approved_requests_in/out), а деньги этого пути двигает только выдача.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import (
    BalanceTopUp, Category, Department, Expense, ExpenseReceipt, MoneyRequest, MoneyRequestItem,
    Notification, Organization, RecordChangeLog, User,
)
from schemas import (
    MoneyRequestOut, RequestsConfigOut, SimpleRequestAccept, SimpleRequestClose, SimpleRequestCreate,
)
from services.exchange import get_current_rate
from services.permissions import department_forbidden, forced_department_id, member_active_workspace_id
from services.push_service import build_payload, send_push_to_user_sync
from services.sheets_sync import enqueue_topup
from routers.requests import _to_out

router = APIRouter(prefix="/api/requests", tags=["requests-simple"])


def _handler_of(db: Session, org_id: int) -> Optional[User]:
    org = db.get(Organization, org_id)
    if not org or not org.request_handler_id:
        return None
    h = db.get(User, org.request_handler_id)
    return h if h and h.is_active and h.org_id == org_id else None


def _load_simple(db: Session, me: User, request_id: int) -> MoneyRequest:
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id or req.flow != "simple":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    # Одобряет и выдаёт только принимающий, которому заявка адресована.
    if req.approver_id != me.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Действие доступно только принимающему заявку")
    return req


def _push(background_tasks: BackgroundTasks, user_id: int, org_id: int, event: str, data: dict) -> None:
    background_tasks.add_task(send_push_to_user_sync, user_id, org_id, build_payload(event, data))


@router.get("/config", response_model=RequestsConfigOut)
def requests_config(db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    """Какую форму заявки показать: упрощённую — всем, кроме самого принимающего
    (ему заявку отправлять некому, у него прежняя форма с выбором адресата)."""
    h = _handler_of(db, me.org_id)
    return RequestsConfigOut(
        handler_id=h.id if h else None,
        handler_name=h.name if h else None,
        simple_form=bool(h and h.id != me.id),
    )


@router.post("/simple", response_model=MoneyRequestOut, status_code=status.HTTP_201_CREATED)
def create_simple_request(
    payload: SimpleRequestCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    h = _handler_of(db, me.org_id)
    if h is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В организации не назначен принимающий заявки")
    if h.id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Принимающий подаёт заявку через обычную форму")
    first = payload.items[0].description.strip()
    req = MoneyRequest(
        org_id=me.org_id, requester_id=me.id, approver_id=h.id, status="pending", flow="simple",
        title=(first if len(payload.items) == 1 else f"{first} и ещё {len(payload.items) - 1}")[:200],
        currency=payload.currency, department_id=forced_department_id(me),
    )
    db.add(req)
    db.flush()
    total = Decimal(0)
    for it in payload.items:
        db.add(MoneyRequestItem(
            request_id=req.id, description=it.description.strip(), amount=it.amount, quantity=it.quantity,
            customer=(it.customer or "").strip() or None, comment=(it.comment or "").strip() or None,
        ))
        total += Decimal(str(it.amount)) * it.quantity
    req.total_amount = total
    db.add(Notification(user_id=h.id, org_id=me.org_id, type="request_submitted", payload={
        "request_id": req.id, "title": req.title, "requester_id": me.id, "amount": str(total)}))
    db.commit()
    db.refresh(req)
    _push(background_tasks, h.id, me.org_id, "request_submitted",
          {"request_id": req.id, "title": req.title, "requester_name": me.name, "amount": str(total)})
    return _to_out(req)


@router.post("/{request_id}/accept", response_model=MoneyRequestOut)
def accept_simple_request(
    request_id: int,
    payload: SimpleRequestAccept,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = _load_simple(db, me, request_id)
    if req.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Одобрить можно только заявку на рассмотрении")
    cat = db.get(Category, payload.category_id)
    if not cat or cat.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория не найдена")
    # Жёсткая привязка заявителя к подразделению важнее выбора в окне.
    dep_id = forced_department_id(req.requester) or payload.department_id
    dep = db.get(Department, dep_id)
    if not dep or dep.org_id != me.org_id or department_forbidden(db, me, dep_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")

    req.handler_category_id = cat.id
    req.department_id = dep_id
    req.handler_payment_method = payload.payment_method
    req.handler_amount = payload.amount
    req.handler_currency = payload.currency
    req.handler_date = payload.spent_date
    req.handler_comment = (payload.comment or "").strip() or None
    req.status = "accepted"
    req.approved_at = datetime.utcnow()
    db.add(RecordChangeLog(org_id=req.org_id, entity_type="money_request", entity_id=req.id,
                           action="update", changed_by=me.id, diff={"accepted": {
                               "category_id": cat.id, "department_id": dep_id,
                               "payment_method": payload.payment_method, "amount": str(payload.amount),
                               "currency": payload.currency, "date": payload.spent_date.isoformat()}}))
    db.add(Notification(user_id=req.requester_id, org_id=req.org_id, type="request_accepted", payload={
        "request_id": req.id, "title": req.title, "amount": str(payload.amount), "currency": payload.currency}))
    db.commit()
    db.refresh(req)
    _push(background_tasks, req.requester_id, req.org_id, "request_accepted",
          {"request_id": req.id, "title": req.title, "amount": str(payload.amount), "currency": payload.currency})
    return _to_out(req)


@router.post("/{request_id}/issue", response_model=MoneyRequestOut)
def issue_simple_request(
    request_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """«Выдал»: выдача принимающий → заявитель. Повтор не создаёт вторую выдачу —
    строку блокируем (FOR UPDATE) и проверяем, что выдачи ещё нет (+ UNIQUE в БД)."""
    req = db.query(MoneyRequest).filter(MoneyRequest.id == request_id).with_for_update().one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    req = _load_simple(db, me, request_id)
    if req.issue_topup_id is not None or req.status == "issued":
        raise HTTPException(status.HTTP_409_CONFLICT, "По этой заявке деньги уже выданы")
    if req.status != "accepted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Выдать можно только одобренную заявку")

    cur = (req.handler_currency or "KGS").upper()
    amount = Decimal(str(req.handler_amount))
    if cur == "KGS":
        amount_kgs = amount
    else:
        rate = get_current_rate(db, req.org_id, cur, "KGS")
        if rate is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Установите курс {cur}/KGS перед выдачей в {cur}")
        amount_kgs = amount * rate

    now = datetime.utcnow()
    t = BalanceTopUp(
        org_id=req.org_id, admin_id=me.id, user_id=req.requester_id, amount=amount, currency=cur,
        amount_kgs=amount_kgs, note=f"Выдача по заявке №{req.id}: {req.title}"[:500], date=now,
        # Без категории: это выдача под отчёт, расход появится по чеку (шаг 2),
        # иначе _sync_topup_expense списал бы его сразу.
        category_id=None, department_id=req.department_id, payment_method=req.handler_payment_method,
        workspace_id=member_active_workspace_id(db, req.requester_id, req.org_id),
    )
    db.add(t)
    db.flush()
    enqueue_topup(db, t)
    req.issue_topup_id = t.id
    req.issued_at = now
    req.issued_by_id = me.id
    req.status = "issued"
    db.add(Notification(user_id=req.requester_id, org_id=req.org_id, type="request_issued", payload={
        "request_id": req.id, "title": req.title, "amount": str(amount), "currency": cur}))
    db.commit()
    db.refresh(req)
    _push(background_tasks, req.requester_id, req.org_id, "request_issued",
          {"request_id": req.id, "title": req.title, "amount": str(amount), "currency": cur})
    return _to_out(req)


@router.post("/{request_id}/close", response_model=MoneyRequestOut)
def close_simple_request(
    request_id: int,
    payload: SimpleRequestClose,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Провести расход по выданной заявке и закрыть её. Нужен чек или отметка
    «нет чека» с комментарием. Повтор не создаёт второй расход (FOR UPDATE + UNIQUE)."""
    locked = db.query(MoneyRequest).filter(MoneyRequest.id == request_id).with_for_update().one_or_none()
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    req = _load_simple(db, me, request_id)
    if req.expense_id is not None or req.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Расход по этой заявке уже проведён")
    if req.status != "issued":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Провести расход можно только по выданной заявке")
    note = (payload.no_receipt_comment or "").strip()
    if payload.no_receipt:
        if len(note) < 3:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "«Нет чека» — напишите комментарий, почему")
    elif not req.receipts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Приложите чек или отметьте «нет чека» с комментарием")

    cur = (req.handler_currency or "KGS").upper()
    amount = Decimal(str(payload.amount if payload.amount is not None else req.handler_amount))
    issued = Decimal(str(req.handler_amount))
    if amount > issued:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Потрачено больше, чем выдано по заявке")
    # КГС по тому же курсу, что и выдача: иначе копеечная разница курсов оставила бы
    # у сотрудника «хвост» при полностью потраченной выдаче.
    topup = db.get(BalanceTopUp, req.issue_topup_id) if req.issue_topup_id else None
    if topup is not None and topup.amount_kgs is not None and issued > 0:
        amount_kgs = (Decimal(str(topup.amount_kgs)) * amount / issued).quantize(Decimal("0.01"))
    elif cur == "KGS":
        amount_kgs = amount
    else:
        rate = get_current_rate(db, req.org_id, cur, "KGS")
        if rate is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Установите курс {cur}/KGS")
        amount_kgs = amount * rate

    spent = datetime.combine(req.handler_date, datetime.min.time()) if req.handler_date else datetime.utcnow()
    lines = "; ".join(
        f"{it.description}" + (f" ({it.customer})" if it.customer else "") for it in req.items
    )
    e = Expense(
        org_id=req.org_id, employee_id=req.requester_id, category_id=req.handler_category_id,
        department_id=req.department_id, amount=amount, currency=cur, amount_kgs=amount_kgs,
        description=f"Заявка №{req.id}: {lines}"[:1000], status="pending",
        recorded_by_id=me.id, funded_by_id=me.id, source_request_id=req.id, expense_type="expense",
        payment_source="balance", payment_method=req.handler_payment_method, spent_at=spent,
        workspace_id=member_active_workspace_id(db, req.requester_id, req.org_id),
    )
    db.add(e)
    db.flush()
    # Чеки заявки — и к расходу: в отчёте Индиры и у проверяющего они на месте.
    for r in req.receipts:
        db.add(ExpenseReceipt(org_id=req.org_id, expense_id=e.id, file_url=r.file_url,
                              file_name=r.file_name, uploaded_by_id=r.uploaded_by_id))
    now = datetime.utcnow()
    req.no_receipt = bool(payload.no_receipt)
    req.no_receipt_comment = note or None
    req.expense_id = e.id
    req.closed_at = now
    req.closed_by_id = me.id
    req.status = "closed"
    db.add(Notification(user_id=req.requester_id, org_id=req.org_id, type="request_closed", payload={
        "request_id": req.id, "title": req.title, "amount": str(amount), "currency": cur}))
    db.commit()
    db.refresh(req)
    _push(background_tasks, req.requester_id, req.org_id, "request_closed",
          {"request_id": req.id, "title": req.title, "amount": str(amount), "currency": cur})
    return _to_out(req)
