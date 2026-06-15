"""Заявки на деньги (MoneyRequest) + строки заявок + workflow approve/reject."""
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import (
    get_current_user,
    is_director_level,
    is_director_or_auditor,
)
from database import get_db
from models import (
    Category,
    Department,
    EmployeeDepartment,
    Expense,
    MoneyRequest,
    MoneyRequestItem,
    Notification,
    User,
)
from schemas import (
    MoneyRequestCreate,
    MoneyRequestItemIn,
    MoneyRequestItemOut,
    MoneyRequestOut,
    MoneyRequestReject,
    MoneyRequestUpdate,
)
from services.push_service import build_payload, send_push_to_user_sync


router = APIRouter(prefix="/api/requests", tags=["requests"])


# ===================== Хелперы =====================

CAN_CREATE_ROLES = ("accountable", "auditor")  # admin/gen_director обычно не создают заявки


def _recalc_total(db: Session, req: MoneyRequest) -> None:
    """Пересчитать total_amount по строкам."""
    total = sum(
        (Decimal(str(it.amount)) * it.quantity for it in req.items),
        Decimal(0),
    )
    req.total_amount = total


def _item_to_out(it: MoneyRequestItem) -> MoneyRequestItemOut:
    out = MoneyRequestItemOut.model_validate(it)
    out.category_name = it.category.name if it.category else None
    return out


def _to_out(req: MoneyRequest) -> MoneyRequestOut:
    out = MoneyRequestOut.model_validate(req)
    out.requester_name = req.requester.name if req.requester else None
    out.approver_name = req.approver.name if req.approver else None
    out.expense_category_name = req.expense_category.name if req.expense_category else None
    out.department_name = req.department.name if req.department else None
    out.items = [_item_to_out(it) for it in req.items]
    return out


def _check_request_ownership(req: MoneyRequest, me: User, action: str) -> None:
    """draft-операции (редактирование строк, submit) доступны только заявителю."""
    if req.requester_id != me.id and not is_director_level(me):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"Только заявитель может {action} эту заявку"
        )


def _check_visible(req: MoneyRequest, me: User) -> None:
    """Видимость заявки: свои + входящие + (для director/auditor — все)."""
    if is_director_or_auditor(me):
        return
    if req.requester_id == me.id or req.approver_id == me.id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к этой заявке")


def _validate_approver(db: Session, me: User, approver_id: int) -> User:
    """Approver должен быть в той же org. Для accountable — это supervisor или admin/gen_director/auditor."""
    approver = db.get(User, approver_id)
    if not approver or approver.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Approver не найден")
    if approver.id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя отправить заявку самому себе")
    if me.role == "accountable":
        allowed = approver.id == me.supervisor_id or approver.role in (
            "gen_director",
            "auditor",
            "admin",
            "superadmin",
        )
        if not allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Заявку можно отправить только своему руководителю, директору, аудитору или admin",
            )
    elif me.role == "auditor":
        # auditor по ТЗ отправляет директору
        if approver.role not in ("gen_director", "admin", "superadmin"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Аудитор может отправить заявку только директору или admin",
            )
    return approver


def _validate_categories(db: Session, me: User, items: list[MoneyRequestItemIn]) -> None:
    cat_ids = {it.category_id for it in items if it.category_id is not None}
    if not cat_ids:
        return
    found = db.query(Category.id).filter(
        Category.org_id == me.org_id, Category.id.in_(cat_ids)
    ).all()
    if len(found) != len(cat_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Одна из категорий не найдена в вашей org")


def _notify(db: Session, user_id: int, org_id: int, ntype: str, payload: dict) -> None:
    n = Notification(user_id=user_id, org_id=org_id, type=ntype, payload=payload)
    db.add(n)


# ===================== Эндпоинты =====================

@router.get("", response_model=List[MoneyRequestOut])
def list_requests(
    status_filter: Optional[str] = Query(default=None, alias="status",
                                          pattern="^(draft|pending|approved|rejected)$"),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    q = db.query(MoneyRequest).filter(MoneyRequest.org_id == me.org_id)
    if not is_director_or_auditor(me):
        q = q.filter(
            or_(
                MoneyRequest.requester_id == me.id,
                MoneyRequest.approver_id == me.id,
            )
        )
    if status_filter:
        q = q.filter(MoneyRequest.status == status_filter)
    if date_from:
        q = q.filter(MoneyRequest.created_at >= date_from)
    if date_to:
        q = q.filter(MoneyRequest.created_at < date_to)

    rows = q.order_by(MoneyRequest.created_at.desc()).limit(limit).all()
    return [_to_out(r) for r in rows]


@router.get("/{request_id}", response_model=MoneyRequestOut)
def get_request(request_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    _check_visible(req, me)
    return _to_out(req)


@router.post("", response_model=MoneyRequestOut, status_code=status.HTTP_201_CREATED)
def create_request(
    payload: MoneyRequestCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    if me.role not in CAN_CREATE_ROLES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Заявку могут создавать только accountable и auditor"
        )
    _validate_approver(db, me, payload.approver_id)
    _validate_categories(db, me, payload.items)

    # Подразделение — обязательно для новых заявок.
    if payload.department_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите подразделение")
    dep = db.get(Department, payload.department_id)
    if not dep or dep.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")
    # accountable может подавать заявку только из своих подразделений.
    if me.role == "accountable":
        is_member = (
            db.query(EmployeeDepartment.id)
            .filter(
                EmployeeDepartment.employee_id == me.id,
                EmployeeDepartment.department_id == payload.department_id,
            )
            .first()
        )
        if not is_member:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Можно выбрать только своё подразделение"
            )

    # Если это «заявка на расход» — категория обязательна.
    if payload.is_expense_on_approve and payload.expense_category_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Для заявки на расход укажите категорию (expense_category_id)",
        )
    if payload.expense_category_id is not None:
        cat = db.get(Category, payload.expense_category_id)
        if not cat or cat.org_id != me.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория расхода не найдена")

    req = MoneyRequest(
        org_id=me.org_id,
        requester_id=me.id,
        approver_id=payload.approver_id,
        status="draft",
        title=payload.title,
        total_amount=Decimal(0),
        currency=(payload.currency or "KGS").upper(),
        department_id=payload.department_id,
        is_expense_on_approve=payload.is_expense_on_approve,
        expense_category_id=payload.expense_category_id,
    )
    db.add(req)
    db.flush()

    for it in payload.items:
        db.add(
            MoneyRequestItem(
                request_id=req.id,
                category_id=it.category_id,
                description=it.description,
                amount=it.amount,
                quantity=it.quantity,
            )
        )

    db.flush()
    db.refresh(req)
    _recalc_total(db, req)
    db.commit()
    db.refresh(req)
    return _to_out(req)


@router.patch("/{request_id}", response_model=MoneyRequestOut)
def update_request(
    request_id: int,
    payload: MoneyRequestUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")

    # auditor+ может править ТОЛЬКО комментарий любой заявки (inline-edit в профиле).
    # Статус/сумму/категорию через этот путь не меняем (B: вариант 1).
    if is_director_or_auditor(me) and payload.comment is not None:
        req.comment = payload.comment

    # Полное редактирование полей — только заявитель и только draft.
    full_fields = (
        payload.title is not None or payload.approver_id is not None
        or payload.currency is not None or payload.is_expense_on_approve is not None
        or payload.expense_category_id is not None
    )
    if full_fields:
        _check_request_ownership(req, me, "редактировать")
        if req.status != "draft":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Редактировать можно только draft")

    if payload.title is not None:
        req.title = payload.title
    if payload.approver_id is not None:
        _validate_approver(db, me, payload.approver_id)
        req.approver_id = payload.approver_id
    if payload.currency is not None:
        req.currency = payload.currency.upper()
    if payload.is_expense_on_approve is not None:
        req.is_expense_on_approve = payload.is_expense_on_approve
    if payload.expense_category_id is not None:
        cat = db.get(Category, payload.expense_category_id)
        if not cat or cat.org_id != me.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория расхода не найдена")
        req.expense_category_id = payload.expense_category_id

    db.commit()
    db.refresh(req)
    return _to_out(req)


@router.post(
    "/{request_id}/items",
    response_model=MoneyRequestItemOut,
    status_code=status.HTTP_201_CREATED,
)
def add_item(
    request_id: int,
    payload: MoneyRequestItemIn,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    _check_request_ownership(req, me, "добавить строку в")
    if req.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Строки можно менять только в draft")
    _validate_categories(db, me, [payload])

    it = MoneyRequestItem(
        request_id=req.id,
        category_id=payload.category_id,
        description=payload.description,
        amount=payload.amount,
        quantity=payload.quantity,
    )
    db.add(it)
    db.flush()
    db.refresh(req)
    _recalc_total(db, req)
    db.commit()
    db.refresh(it)
    return _item_to_out(it)


@router.put("/{request_id}/items/{item_id}", response_model=MoneyRequestItemOut)
def update_item(
    request_id: int,
    item_id: int,
    payload: MoneyRequestItemIn,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    _check_request_ownership(req, me, "редактировать строки")
    if req.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Строки можно менять только в draft")
    it = db.get(MoneyRequestItem, item_id)
    if not it or it.request_id != req.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Строка не найдена")
    _validate_categories(db, me, [payload])

    it.category_id = payload.category_id
    it.description = payload.description
    it.amount = payload.amount
    it.quantity = payload.quantity

    db.flush()
    db.refresh(req)
    _recalc_total(db, req)
    db.commit()
    db.refresh(it)
    return _item_to_out(it)


@router.delete(
    "/{request_id}/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_item(
    request_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    _check_request_ownership(req, me, "удалить строки")
    if req.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Строки можно менять только в draft")
    it = db.get(MoneyRequestItem, item_id)
    if not it or it.request_id != req.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Строка не найдена")
    db.delete(it)
    db.flush()
    db.refresh(req)
    _recalc_total(db, req)
    db.commit()
    return None


@router.post("/{request_id}/submit", response_model=MoneyRequestOut)
def submit_request(
    request_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    _check_request_ownership(req, me, "отправить")
    if req.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Отправить можно только draft")
    if not req.items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Заявка без строк не может быть отправлена")

    req.status = "pending"
    _notify(
        db,
        user_id=req.approver_id,
        org_id=req.org_id,
        ntype="request_submitted",
        payload={
            "request_id": req.id,
            "title": req.title,
            "requester_id": req.requester_id,
            "amount": str(req.total_amount),
        },
    )
    db.commit()
    db.refresh(req)

    background_tasks.add_task(
        send_push_to_user_sync,
        req.approver_id,
        req.org_id,
        build_payload("request_submitted", {
            "request_id": req.id,
            "title": req.title,
            "requester_name": me.name,
            "amount": str(req.total_amount),
        }),
    )
    return _to_out(req)


@router.post("/{request_id}/approve", response_model=MoneyRequestOut)
def approve_request(
    request_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    if req.approver_id != me.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только адресат может одобрить эту заявку")
    if req.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Одобрить можно только pending")

    req.status = "approved"
    req.approved_at = datetime.now(tz=timezone.utc).replace(tzinfo=None)

    # Если это «заявка на расход» — создаём Expense у requester'а:
    # - employee_id = requester (на чьём счету будет расход)
    # - funded_by_id = approver (кто финансировал из своих)
    # - expense_type = 'expense' (конечный расход, влияет на by_category)
    # - source_request_id = req.id (трассировка)
    # - amount_kgs = total_amount (заявка ведётся в KGS)
    # Баланс: списывается у approver через _approved_requests_out (из balance.py).
    # Списывается также у requester через _expenses_approved. Чтобы НЕ было двойного
    # списания с requester — не вызывается _approved_requests_in (нет TopUp). Wait,
    # _approved_requests_in добавляет approved заявку к балансу requester'а. Это даёт
    # +amount у requester, который -amount через Expense → итого 0 у requester ✓.
    # У approver: -amount через _approved_requests_out ✓.
    if req.is_expense_on_approve and req.expense_category_id is not None:
        cur = (req.currency or "KGS").upper()
        if cur == "KGS":
            amount_kgs = req.total_amount
        else:
            from services.exchange import get_current_rate as _rate
            r = _rate(db, req.org_id, cur, "KGS")
            amount_kgs = (Decimal(str(req.total_amount)) * r) if r is not None else req.total_amount
        e = Expense(
            org_id=req.org_id,
            employee_id=req.requester_id,
            category_id=req.expense_category_id,
            department_id=req.department_id,
            amount=req.total_amount,
            currency=cur,
            amount_kgs=amount_kgs,
            description=req.title,
            status="approved",
            reviewed_by_id=req.approver_id,
            recorded_by_id=req.approver_id,
            funded_by_id=req.approver_id,
            source_request_id=req.id,
            expense_type="expense",
            spent_at=datetime.utcnow(),
        )
        db.add(e)

    _notify(
        db,
        user_id=req.requester_id,
        org_id=req.org_id,
        ntype="request_approved",
        payload={
            "request_id": req.id,
            "title": req.title,
            "approver_id": req.approver_id,
            "amount": str(req.total_amount),
        },
    )
    db.commit()
    db.refresh(req)

    background_tasks.add_task(
        send_push_to_user_sync,
        req.requester_id,
        req.org_id,
        build_payload("request_approved", {
            "request_id": req.id,
            "title": req.title,
            "amount": str(req.total_amount),
        }),
    )
    return _to_out(req)


@router.post("/{request_id}/reject", response_model=MoneyRequestOut)
def reject_request(
    request_id: int,
    payload: MoneyRequestReject,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    if req.approver_id != me.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только адресат может отклонить эту заявку")
    if req.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Отклонить можно только pending")

    req.status = "rejected"
    req.comment = payload.comment
    _notify(
        db,
        user_id=req.requester_id,
        org_id=req.org_id,
        ntype="request_rejected",
        payload={
            "request_id": req.id,
            "title": req.title,
            "approver_id": req.approver_id,
            "comment": payload.comment,
        },
    )
    db.commit()
    db.refresh(req)

    background_tasks.add_task(
        send_push_to_user_sync,
        req.requester_id,
        req.org_id,
        build_payload("request_rejected", {
            "request_id": req.id,
            "title": req.title,
            "comment": payload.comment,
        }),
    )
    return _to_out(req)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_request(
    request_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    req = db.get(MoneyRequest, request_id)
    if not req or req.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    # auditor+ может удалить любую заявку (inline-edit в профиле). Связанный Expense
    # сохраняется: expenses.source_request_id = SET NULL при удалении заявки.
    if not is_director_or_auditor(me):
        _check_request_ownership(req, me, "удалить")
        if req.status not in ("draft", "rejected"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Удалять можно только draft или rejected (одобренные — финансовый след)",
            )
    db.delete(req)
    db.commit()
    return None
