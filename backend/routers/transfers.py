"""Прямые передачи денег между пользователями + пополнение баланса админом."""
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import (
    get_current_user,
    is_director_or_auditor,
    require_admin,
    require_director_level,
    require_director_or_auditor,
)
from database import get_db
from models import BalanceTopUp, Category, Department, Expense, MoneyTransfer, Notification, User
from schemas import (
    BalanceTopUpCreate,
    BalanceTopUpOut,
    BalanceTopUpUpdate,
    MoneyTransferCreate,
    MoneyTransferOut,
    MoneyTransferUpdate,
)
from services.audit import log_delete, log_update, snapshot
from services.balance import compute_current_balance, load_org_rates
from services.exchange import get_current_rate
from services.soft_delete import soft_delete
from services.permissions import (
    member_active_workspace_id,
    owner_isolation_ws_id,
    workspace_member_ids,
)
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


def _sync_topup_expense(db: Session, topup: BalanceTopUp) -> None:
    """Синхронизирует авто-расход, привязанный к выдаче (Expense.source_topup_id).

    Правило: выдача с реальной (не системной «Подотчёт») категорией → деньги сразу
    становятся расходом получателя (Expense на employee=получатель, та же категория,
    баланс получателя по этой паре = 0). Без категории или с системной «Подотчёт» →
    авто-расхода быть не должно — получатель отчитается сам.

    Вызывается и при СОЗДАНИИ, и при РЕДАКТИРОВАНИИ выдачи, поэтому покрывает все случаи:
      • расход нужен, его нет  → создаём;
      • расход нужен, он есть    → обновляем поля под текущее состояние выдачи;
      • расход не нужен, он есть → удаляем.

    db.flush() перед вызовом обязателен — нужен topup.id.
    """
    linked = db.query(Expense).filter(Expense.source_topup_id == topup.id).all()
    cat = db.get(Category, topup.category_id) if topup.category_id is not None else None
    should_have = cat is not None and not cat.is_system

    if not should_have:
        for e in linked:
            db.delete(e)  # категорию убрали/сменили на «Подотчёт» — авто-расход больше не нужен
        return

    if linked:
        e = linked[0]
        for extra in linked[1:]:  # подстраховка от задвоения после бэкфилла
            db.delete(extra)
    else:
        # Legacy: авто-расход мог быть создан до появления source_topup_id (без связи).
        # Не плодим дубль — пытаемся «усыновить» подходящий непривязанный расход.
        e = (
            db.query(Expense)
            .filter(
                Expense.source_topup_id.is_(None),
                Expense.org_id == topup.org_id,
                Expense.employee_id == topup.user_id,
                Expense.category_id == topup.category_id,
                Expense.amount == topup.amount,
                Expense.currency == topup.currency,
                Expense.expense_type == "expense",
                Expense.spent_at >= topup.date.replace(hour=0, minute=0, second=0, microsecond=0),
            )
            .first()
        )
        if e is None:
            e = Expense(org_id=topup.org_id, expense_type="expense", status="approved")
            db.add(e)
        e.source_topup_id = topup.id

    # Приводим расход в соответствие текущему состоянию выдачи (на случай правок).
    e.employee_id = topup.user_id
    e.category_id = topup.category_id
    e.department_id = topup.department_id
    e.workspace_id = topup.workspace_id  # авто-расход в том же пространстве, что и выдача
    e.amount = topup.amount
    e.currency = topup.currency
    e.amount_kgs = topup.amount_kgs
    e.description = topup.note or cat.name
    e.reviewed_by_id = topup.admin_id
    e.recorded_by_id = topup.admin_id
    e.funded_by_id = topup.admin_id
    e.spent_at = topup.date


@router.get("", response_model=List[MoneyTransferOut])
def list_transfers(
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    q = db.query(MoneyTransfer).filter(MoneyTransfer.org_id == me.org_id)
    iso = owner_isolation_ws_id(db, me)
    if iso is not None:
        # Владелец пространства: только переводы между участниками его пространства.
        members = workspace_member_ids(db, iso)
        q = q.filter(
            MoneyTransfer.from_user_id.in_(members),
            MoneyTransfer.to_user_id.in_(members),
        )
    elif not is_director_or_auditor(me):
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
    """Передать деньги. Источник = текущий пользователь. Получатель — любой
    сотрудник той же org (деньги уходят только с баланса отправителя, поэтому
    подотчётному разрешено передавать любому коллеге, не только подчинённым)."""
    to_user = db.get(User, payload.to_user_id)
    if not to_user or to_user.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Получатель не найден")
    if to_user.id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя передать деньги самому себе")

    # KGS-эквивалент фиксируем на момент перевода (как у выдач/пополнений): по нему
    # считается общий баланс. Для не-KGS нужен курс — иначе перевод не провести.
    if payload.currency == "KGS":
        amount_kgs = payload.amount
    else:
        rate = get_current_rate(db, me.org_id, payload.currency, "KGS")
        if rate is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Установите курс {payload.currency}/KGS перед переводом в {payload.currency}",
            )
        amount_kgs = Decimal(str(payload.amount)) * rate

    # Отрицательный баланс разрешён сознательно: начальное поступление денег
    # в организации пока не фиксируется (нет учёта казны на старте). Если у юзера
    # ещё не было topup/входящих переводов — он может уйти в минус, и это нормально.
    # Будет видно как «долг перед организацией» в current_balance.

    t = MoneyTransfer(
        org_id=me.org_id,
        from_user_id=me.id,
        to_user_id=to_user.id,
        amount=payload.amount,
        currency=payload.currency,
        amount_kgs=amount_kgs,
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


def _can_modify_transfer(me: User, t: MoneyTransfer) -> bool:
    """Править/отменять передачу может только ОТПРАВИТЕЛЬ (или admin/директор).
    Получатель — нет: иначе он мог бы задним числом изменить полученную сумму."""
    return me.id == t.from_user_id or is_director_or_auditor(me)


@router.patch("/{transfer_id}", response_model=MoneyTransferOut)
def update_transfer(
    transfer_id: int,
    payload: MoneyTransferUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    t = db.get(MoneyTransfer, transfer_id)  # хук: soft-deleted → None → 404
    if not t or t.org_id != me.org_id or t.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Передача не найдена")
    if not _can_modify_transfer(me, t):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Изменить передачу может только отправитель")

    # Курсы грузим ДО мутаций (load_org_rates может коммитить при добивке из НБКР —
    # не хотим коммитить наполовину применённую правку).
    rates = load_org_rates(db, t.org_id)
    before = snapshot(t)
    data = payload.model_dump(exclude_unset=True)
    old_to = t.to_user_id

    if data.get("to_user_id") is not None:
        to_user = db.get(User, data["to_user_id"])
        if not to_user or to_user.org_id != me.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Получатель не найден")
        if to_user.id == t.from_user_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя передать деньги самому себе")
        t.to_user_id = to_user.id
    for f in ("amount", "currency", "note"):
        if f in data:
            setattr(t, f, data[f])
    if "amount" in data or "currency" in data:
        if t.currency == "KGS":
            t.amount_kgs = t.amount
        else:
            rate = get_current_rate(db, me.org_id, t.currency, "KGS")
            if rate is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Курс {t.currency}/KGS не установлен — пересчёт невозможен",
                )
            t.amount_kgs = Decimal(str(t.amount)) * rate
        rates = load_org_rates(db, t.org_id, [t.currency])

    db.flush()  # применить правку, чтобы баланс считался по новому состоянию
    # Гвард: баланс затронутых получателей (старого и нового) не должен уйти в минус —
    # деньги обезличены, отрицательный баланс = «уже потрачены дальше».
    for uid in {old_to, t.to_user_id}:
        if compute_current_balance(db, t.org_id, uid, rates=rates) < Decimal("-0.01"):
            db.rollback()
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Нельзя так изменить передачу: у получателя баланс уйдёт в минус "
                "(эти деньги уже потрачены или переданы дальше). Сначала отмените "
                "связанные операции получателя.",
            )

    log_update(db, "transfer", t, before, me)
    # Уведомляем получателя(ей) об изменении — чтобы сумма не «поехала» незаметно.
    for uid in {old_to, t.to_user_id}:
        db.add(Notification(
            org_id=me.org_id, user_id=uid, type="transfer_updated",
            payload={"transfer_id": t.id, "from_user_id": t.from_user_id, "amount": str(t.amount)},
        ))
    db.commit()
    db.refresh(t)
    for uid in {old_to, t.to_user_id}:
        background_tasks.add_task(
            send_push_to_user_sync, uid, me.org_id,
            build_payload("transfer_updated", {"amount": str(t.amount), "from_user_name": me.name}),
        )
    return _transfer_to_out(t)


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer(
    transfer_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Отменить передачу. Откатывает баланс И отправителя, И получателя (в одной
    транзакции — через soft-delete записи, балансы вычисляются на лету). Только
    отправитель/admin. Нельзя отменить, если получатель уже потратил эти деньги."""
    t = db.get(MoneyTransfer, transfer_id)
    if not t or t.org_id != me.org_id or t.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Передача не найдена")
    if not _can_modify_transfer(me, t):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Отменить передачу может только отправитель")

    rates = load_org_rates(db, t.org_id)
    t_kgs = Decimal(str(t.amount_kgs if t.amount_kgs is not None else t.amount))
    # После отмены баланс получателя уменьшится на t_kgs (входящий перевод исчезнет).
    balance_after = compute_current_balance(db, t.org_id, t.to_user_id, rates=rates) - t_kgs
    if balance_after < Decimal("-0.01"):
        recipient = db.get(User, t.to_user_id)
        name = recipient.name if recipient else "получатель"
        shortfall = (-balance_after).quantize(Decimal("1"))
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Нельзя отменить передачу: {name} уже потратил или передал эти деньги "
            f"дальше (после отмены баланс уйдёт в минус на {shortfall:,} с). "
            f"Сначала отмените связанные операции получателя.".replace(",", " "),
        )

    log_delete(db, "transfer", t, me)
    soft_delete(t, me)
    db.add(Notification(
        org_id=me.org_id, user_id=t.to_user_id, type="transfer_cancelled",
        payload={"transfer_id": t.id, "from_user_id": t.from_user_id, "amount": str(t.amount)},
    ))
    db.commit()
    background_tasks.add_task(
        send_push_to_user_sync, t.to_user_id, me.org_id,
        build_payload("transfer_cancelled", {"amount": str(t.amount), "from_user_name": me.name}),
    )
    return None


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
    admin: User = Depends(require_director_or_auditor),
):
    """Внести деньги 'из казны' на баланс пользователя. auditor и выше."""
    target = db.get(User, user_id)
    if not target or target.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    if payload.department_id is not None:
        dep = db.get(Department, payload.department_id)
        if not dep or dep.org_id != admin.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")

    # «Кто выдал»: по умолчанию текущий пользователь; для «передал дальше» из профиля
    # можно указать сотрудника-отправителя (issued_by_id). Проверяем org.
    issuer_id = admin.id
    if payload.issued_by_id is not None:
        issuer = db.get(User, payload.issued_by_id)
        if not issuer or issuer.org_id != admin.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "«Кто выдал» не найден")
        issuer_id = issuer.id

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
        admin_id=issuer_id,
        user_id=target.id,
        amount=payload.amount,
        currency=payload.currency,
        amount_kgs=amount_kgs,
        note=payload.note,
        date=payload.date or _dt.utcnow(),
        category_id=payload.category_id,
        department_id=payload.department_id,
        # Привязка к активному пространству получателя — как у выдач (create_advance).
        # Так выдача с категорией и авто-расход попадают в пространство участника.
        # В основном пространстве получатель не участник → None (поведение не меняется).
        workspace_id=member_active_workspace_id(db, target.id, admin.org_id),
    )
    db.add(t)
    db.flush()  # нужен t.id и связь категории до _sync_topup_expense
    # Если категория не «Подотчёт» (не is_system) — создаём Expense получателю автоматом.
    _sync_topup_expense(db, t)
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
    admin: User = Depends(require_director_or_auditor),
):
    """Изменить запись выдачи — auditor и выше (admin/superadmin/gen_director)."""
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
    if "department_id" in data and data["department_id"] is not None:
        dep = db.get(Department, data["department_id"])
        if not dep or dep.org_id != admin.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")
        t.department_id = data["department_id"]
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
    # Пере-привязываем к пространству получателя (и бэкфилл старых записей без него).
    t.workspace_id = member_active_workspace_id(db, t.user_id, admin.org_id)
    db.flush()  # зафиксировать изменения выдачи до синхронизации авто-расхода
    # Держим привязанный авто-расход в соответствии: создаём/обновляем/удаляем по
    # текущей категории и сумме. Закрывает баг «при правке из истории расход не пересчитывался».
    _sync_topup_expense(db, t)
    db.commit()
    db.refresh(t)
    return _topup_to_out(t)


@topup_router.delete("/topups/{topup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_topup(
    topup_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_director_or_auditor),
):
    """Удалить запись выдачи/прихода — auditor и выше. Сразу влияет на баланс получателя.

    Защита: нельзя удалить приход, если получатель уже передал/потратил эти деньги
    дальше — иначе его баланс уйдёт в минус и появится «фантомный долг». Удаление
    разрешено только если после него баланс получателя остаётся ≥ 0 (т.е. этот приход
    ещё не «израсходован» — его покрывают другие поступления)."""
    t = db.get(BalanceTopUp, topup_id)
    if not t or t.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Выдача не найдена")

    # KGS-эквивалент этого прихода по текущему курсу.
    rates = load_org_rates(db, t.org_id)
    rate = rates.get(t.currency, Decimal("1"))
    topup_kgs = Decimal(str(t.amount)) * rate
    # Привязанный авто-расход (выдача с реальной категорией) удалится вместе с выдачей.
    # Он уменьшал баланс получателя, поэтому при удалении баланс на ту же сумму вырастет —
    # учитываем в гарде, иначе выдача-с-категорией (баланс пары = 0) ложно блокировалась бы.
    linked = db.query(Expense).filter(Expense.source_topup_id == t.id).all()
    linked_kgs = sum(
        (Decimal(str(e.amount)) * rates.get(e.currency, Decimal("1")) for e in linked),
        Decimal("0"),
    )
    # Текущий баланс получателя уже включает этот приход как поступление и авто-расход как
    # списание. После удаления он уменьшится на topup_kgs и вырастет на linked_kgs.
    balance_after = compute_current_balance(db, t.org_id, t.user_id, rates=rates) - topup_kgs + linked_kgs
    if balance_after < Decimal("-0.01"):
        recipient = db.get(User, t.user_id)
        name = recipient.name if recipient else "получатель"
        shortfall = (-balance_after).quantize(Decimal("1"))
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Нельзя удалить этот приход: {name} уже передал или потратил эти деньги "
            f"дальше (после удаления баланс уйдёт в минус на {shortfall:,} с). "
            f"Сначала отмените связанные передачи/расходы.".replace(",", " "),
        )

    for e in linked:
        db.delete(e)
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
