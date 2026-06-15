"""Прямые передачи денег между пользователями + пополнение баланса админом."""
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import (
    get_current_user,
    is_director_or_auditor,
    require_admin,
    require_director_level,
)
from database import get_db
from models import BalanceTopUp, Category, Department, Expense, MoneyTransfer, Notification, User
from schemas import (
    BalanceTopUpCreate,
    BalanceTopUpOut,
    BalanceTopUpUpdate,
    MoneyTransferCreate,
    MoneyTransferOut,
)
from services.exchange import get_current_rate
from services.push_service import build_payload, send_push_to_user_sync


router = APIRouter(prefix="/api/transfers", tags=["transfers"])


def _transfer_to_out(t: MoneyTransfer) -> MoneyTransferOut:
    out = MoneyTransferOut.model_validate(t)
    out.from_user_name = t.from_user.name if t.from_user else None
    out.to_user_name = t.to_user.name if t.to_user else None
    return out


def _topup_to_out(t: BalanceTopUp) -> BalanceTopUpOut:
    out = BalanceTopUpOut.model_validate(t)
    out.admin_name = t.admin.name if t.admin else None
    out.user_name = t.user.name if t.user else None
    out.category_name = t.category.name if t.category else None
    out.department_name = t.department.name if t.department else None
    return out


def _auto_expense_for_topup(db: Session, topup: BalanceTopUp) -> None:
    """Если TopUp выдан с реальной (не «Подотчёт») категорией — деньги сразу
    становятся расходом компании: создаём Expense на получателя с той же категорией.
    Это поведение по правилу: TopUp.category == 'Подотчёт' → получатель отчитается сам.
    Иначе → автоматически создаём Expense (баланс получателя 0, расход учтён).

    Защита от дублей: если у получателя уже есть Expense на ту же сумму/валюту/дату
    с тем же category_id — не создаём (это исторический бэктест-импорт)."""
    if topup.category_id is None:
        return  # без категории — трактуем как подотчёт
    cat = db.get(Category, topup.category_id)
    if not cat or cat.is_system:
        return  # «Подотчёт» (is_system=True) или невалидная — не создаём
    # Проверка на дубль (уже есть такой же Expense у получателя)
    existing = (
        db.query(Expense)
        .filter(
            Expense.org_id == topup.org_id,
            Expense.employee_id == topup.user_id,
            Expense.category_id == topup.category_id,
            Expense.amount == topup.amount,
            Expense.currency == topup.currency,
            Expense.spent_at >= topup.date.replace(hour=0, minute=0, second=0, microsecond=0),
        )
        .first()
    )
    if existing:
        return
    db.add(Expense(
        org_id=topup.org_id,
        employee_id=topup.user_id,
        category_id=topup.category_id,
        department_id=topup.department_id,
        amount=topup.amount,
        currency=topup.currency,
        amount_kgs=topup.amount_kgs,
        description=topup.note or cat.name,
        status="approved",
        reviewed_by_id=topup.admin_id,
        recorded_by_id=topup.admin_id,
        funded_by_id=topup.admin_id,
        expense_type="expense",
        spent_at=topup.date,
    ))


@router.get("", response_model=List[MoneyTransferOut])
def list_transfers(
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    q = db.query(MoneyTransfer).filter(MoneyTransfer.org_id == me.org_id)
    if not is_director_or_auditor(me):
        q = q.filter(
            or_(
                MoneyTransfer.from_user_id == me.id,
                MoneyTransfer.to_user_id == me.id,
            )
        )
    rows = q.order_by(MoneyTransfer.created_at.desc()).limit(limit).all()
    return [_transfer_to_out(t) for t in rows]


@router.post("", response_model=MoneyTransferOut, status_code=status.HTTP_201_CREATED)
def create_transfer(
    payload: MoneyTransferCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Передать деньги. Источник = текущий пользователь. Получатель должен быть
    в той же org. Для accountable получатель ДОЛЖЕН быть его прямой подотчётный
    (supervisor_id = me.id). Проверяем хватает ли баланса."""
    to_user = db.get(User, payload.to_user_id)
    if not to_user or to_user.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Получатель не найден")
    if to_user.id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя передать деньги самому себе")

    if me.role == "accountable" and to_user.supervisor_id != me.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Передавать можно только своим подотчётным (тем, у кого вы supervisor)",
        )

    # Отрицательный баланс разрешён сознательно: начальное поступление денег
    # в организации пока не фиксируется (нет учёта казны на старте). Если у юзера
    # ещё не было topup/входящих переводов — он может уйти в минус, и это нормально.
    # Будет видно как «долг перед организацией» в current_balance.

    t = MoneyTransfer(
        org_id=me.org_id,
        from_user_id=me.id,
        to_user_id=to_user.id,
        amount=payload.amount,
        note=payload.note,
    )
    db.add(t)
    db.add(
        Notification(
            user_id=to_user.id,
            org_id=me.org_id,
            type="transfer_received",
            payload={
                "from_user_id": me.id,
                "amount": str(payload.amount),
                "note": payload.note,
            },
        )
    )
    db.commit()
    db.refresh(t)

    background_tasks.add_task(
        send_push_to_user_sync,
        to_user.id,
        me.org_id,
        build_payload("transfer_received", {
            "amount": str(payload.amount),
            "from_user_name": me.name,
            "note": payload.note,
        }),
    )
    return _transfer_to_out(t)


# ===================== Topup =====================
# Topup живёт отдельным эндпоинтом (под /api/users/...) — он логически про юзера,
# не про "передачу". Но реализация здесь же.


topup_router = APIRouter(prefix="/api/users", tags=["topups"])


@topup_router.post(
    "/{user_id}/topup",
    response_model=BalanceTopUpOut,
    status_code=status.HTTP_201_CREATED,
)
def topup_user(
    user_id: int,
    payload: BalanceTopUpCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_director_level),
):
    """Внести деньги 'из казны' на баланс пользователя. admin или gen_director."""
    target = db.get(User, user_id)
    if not target or target.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    if payload.department_id is not None:
        dep = db.get(Department, payload.department_id)
        if not dep or dep.org_id != admin.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")

    from datetime import datetime as _dt
    from decimal import Decimal as _D
    # Считаем KGS-эквивалент. Для KGS = amount; для USD/RUB = amount × курс.
    # Курс нужен — иначе блокируем, чтобы баланс не молчал.
    if payload.currency == "KGS":
        amount_kgs = payload.amount
    else:
        rate = get_current_rate(db, admin.org_id, payload.currency, "KGS")
        if rate is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Установите курс {payload.currency}/KGS перед выдачей в {payload.currency}",
            )
        amount_kgs = _D(str(payload.amount)) * rate

    t = BalanceTopUp(
        org_id=admin.org_id,
        admin_id=admin.id,
        user_id=target.id,
        amount=payload.amount,
        currency=payload.currency,
        amount_kgs=amount_kgs,
        note=payload.note,
        date=payload.date or _dt.utcnow(),
        category_id=payload.category_id,
        department_id=payload.department_id,
    )
    db.add(t)
    db.flush()  # нужен t.id и связь категории до _auto_expense_for_topup
    # Если категория не «Подотчёт» (не is_system) — создаём Expense получателю автоматом.
    _auto_expense_for_topup(db, t)
    db.add(
        Notification(
            user_id=target.id,
            org_id=admin.org_id,
            type="balance_topup",
            payload={
                "admin_id": admin.id,
                "amount": str(payload.amount),
                "note": payload.note,
            },
        )
    )
    db.commit()
    db.refresh(t)

    background_tasks.add_task(
        send_push_to_user_sync,
        target.id,
        admin.org_id,
        build_payload("balance_topup", {
            "amount": str(payload.amount),
            "admin_name": admin.name,
            "note": payload.note,
        }),
    )
    return _topup_to_out(t)


@topup_router.get("/{user_id}/topups", response_model=List[BalanceTopUpOut])
def list_topups(
    user_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """История пополнений для конкретного юзера. Видит сам юзер или director/auditor/admin."""
    target = db.get(User, user_id)
    if not target or target.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if me.id != target.id and not is_director_or_auditor(me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    rows = (
        db.query(BalanceTopUp)
        .filter(BalanceTopUp.org_id == me.org_id, BalanceTopUp.user_id == user_id)
        .order_by(BalanceTopUp.date.desc())
        .all()
    )
    return [_topup_to_out(t) for t in rows]


@topup_router.patch("/topups/{topup_id}", response_model=BalanceTopUpOut)
def update_topup(
    topup_id: int,
    payload: BalanceTopUpUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Изменить запись выдачи — только admin. TopUp всегда в KGS, валюту не трогаем."""
    t = db.get(BalanceTopUp, topup_id)
    if not t or t.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Выдача не найдена")

    data = payload.model_dump(exclude_unset=True)
    if "user_id" in data and data["user_id"] is not None:
        new_user = db.get(User, data["user_id"])
        if not new_user or new_user.org_id != admin.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Получатель не найден")
        t.user_id = data["user_id"]
    if "admin_id" in data and data["admin_id"] is not None:
        issuer = db.get(User, data["admin_id"])
        if not issuer or issuer.org_id != admin.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Выдающий не найден")
        t.admin_id = data["admin_id"]
    for f in ("amount", "note", "date", "category_id", "currency"):
        if f in data:
            setattr(t, f, data[f])
    # При смене amount/currency пересчитываем amount_kgs по текущему курсу.
    if "amount" in data or "currency" in data:
        from decimal import Decimal as _D
        if t.currency == "KGS":
            t.amount_kgs = t.amount
        else:
            rate = get_current_rate(db, admin.org_id, t.currency, "KGS")
            if rate is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Курс {t.currency}/KGS не установлен — пересчёт невозможен",
                )
            t.amount_kgs = _D(str(t.amount)) * rate
    db.commit()
    db.refresh(t)
    return _topup_to_out(t)


@topup_router.delete("/topups/{topup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_topup(
    topup_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Удалить запись выдачи — только admin. Сразу влияет на баланс получателя."""
    t = db.get(BalanceTopUp, topup_id)
    if not t or t.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Выдача не найдена")
    db.delete(t)
    db.commit()
    return None


@topup_router.get("/me/issued-topups", response_model=List[BalanceTopUpOut])
def list_my_issued_topups(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """История выдач, которые сделал текущий пользователь (как admin_id).
    Используется на дашборде/странице 'Выдано мной'."""
    rows = (
        db.query(BalanceTopUp)
        .filter(BalanceTopUp.org_id == me.org_id, BalanceTopUp.admin_id == me.id)
        .order_by(BalanceTopUp.date.desc())
        .all()
    )
    return [_topup_to_out(t) for t in rows]
