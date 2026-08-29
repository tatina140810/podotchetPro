from decimal import Decimal
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import (
    get_current_user,
    hash_password,
    is_director_level,
    is_director_or_auditor,
    require_admin,
    require_director_or_auditor,
)
from database import get_db
from models import (
    BalanceTopUp,
    ChatMember,
    ChatRoom,
    Department,
    EmployeeDepartment,
    EmployeeSpec,
    Expense,
    MoneyRequest,
    MoneyTransfer,
    Organization,
    User,
)
from services.plan_limits import assert_limit
from schemas import (
    BalanceHistoryEntry,
    ChainExpense,
    ChainNode,
    ChainTransfer,
    SubordinateCreate,
    UserBalanceDetails,
    UserCreate,
    UserOut,
    UserUpdate,
    UserWithBalance,
)
from services.balance import (
    compute_balances_by_currency,
    compute_current_balance,
    compute_total_issued,
    compute_total_received,
    issued_total,
    load_org_rates,
    month_bounds,
    spent_total,
    transferred_out_total,
)
from services.permissions import (
    auditor_visible_user_ids,
    hidden_user_ids,
    owner_isolation_ws_id,
    visible_user_ids,
    workspace_member_ids,
)


router = APIRouter(prefix="/api/users", tags=["users"])


def _dept_ids(user: User) -> list[int]:
    """id подразделений сотрудника (через M2M)."""
    return [d.id for d in user.departments]


def _user_out(u: User) -> UserOut:
    out = UserOut.model_validate(u)
    out.department_ids = _dept_ids(u)
    return out


def _set_departments(db: Session, org_id: int, user: User, dept_ids: list[int]) -> None:
    """Заменяет набор подразделений сотрудника на dept_ids (валидирует принадлежность org).
    Пустой список — снимает все привязки."""
    # Валидация: все id существуют и в той же org.
    if dept_ids:
        valid = {
            i for (i,) in db.query(Department.id)
            .filter(Department.org_id == org_id, Department.id.in_(dept_ids))
            .all()
        }
        missing = set(dept_ids) - valid
        if missing:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Подразделение(я) не найдены: {sorted(missing)}",
            )
    # Удаляем старые привязки, ставим новые.
    db.query(EmployeeDepartment).filter(
        EmployeeDepartment.employee_id == user.id
    ).delete(synchronize_session=False)
    for did in dict.fromkeys(dept_ids):  # уникализируем, сохраняя порядок
        db.add(EmployeeDepartment(employee_id=user.id, department_id=did))


def _add_to_general_chat(db: Session, user: User) -> None:
    """Добавляет пользователя в групповую комнату 'Общий чат' своей org (если она есть)."""
    room = (
        db.query(ChatRoom)
        .filter(
            ChatRoom.org_id == user.org_id,
            ChatRoom.room_type == "group",
            ChatRoom.name == "Общий чат",
        )
        .first()
    )
    if room:
        already = db.query(ChatMember).filter_by(room_id=room.id, user_id=user.id).first()
        if not already:
            db.add(ChatMember(room_id=room.id, user_id=user.id))


def _with_balance(db: Session, user: User, rates: Optional[dict] = None) -> UserWithBalance:
    if rates is None:
        rates = load_org_rates(db, user.org_id)
    issued = issued_total(db, user.org_id, user.id)
    spent = spent_total(db, user.org_id, user.id, rates=rates)
    transferred = transferred_out_total(db, user.org_id, user.id)
    m_start, m_end = month_bounds()
    monthly_spent = spent_total(db, user.org_id, user.id, start=m_start, end=m_end, rates=rates)
    monthly_limit = Decimal(str(user.spec.monthly_limit)) if user.spec else Decimal(0)
    balances = compute_balances_by_currency(db, user.org_id, user.id)
    current = compute_current_balance(db, user.org_id, user.id, rates=rates)
    received = compute_total_received(db, user.org_id, user.id, rates=rates)
    total_issued_amt = compute_total_issued(db, user.org_id, user.id, rates=rates)
    base = UserOut.model_validate(user).model_dump()
    base["department_ids"] = _dept_ids(user)
    return UserWithBalance(
        **base,
        balance=issued - spent - transferred,
        issued_total=issued,
        spent_total=spent,
        transferred_out_total=transferred,
        monthly_spent=monthly_spent,
        monthly_limit=monthly_limit,
        balances_by_currency=balances,
        current_balance=current,
        total_received=received,
        total_issued=total_issued_amt,
    )


@router.get("", response_model=List[UserWithBalance])
def list_users(
    db: Session = Depends(get_db),
    me: User = Depends(require_director_or_auditor),
):
    """Список активных сотрудников org — видят admin, gen_director, auditor.
    Soft-deleted (is_active=False) не показываются."""
    q = db.query(User).filter(User.org_id == me.org_id, User.is_active.is_(True))
    hidden = hidden_user_ids(db, me)
    if hidden:  # Фича 2: конфиденциальные сотрудники не видны в общем списке
        q = q.filter(User.id.notin_(hidden))
    iso = owner_isolation_ws_id(db, me)
    if iso is not None:  # владелец пространства видит только участников своего пространства
        q = q.filter(User.id.in_(workspace_member_ids(db, iso)))
    aud_visible = auditor_visible_user_ids(db, me)  # ограниченный аудитор — только «свои»
    if aud_visible is not None:
        q = q.filter(User.id.in_(aud_visible or {-1}))
    users = q.order_by(User.created_at.desc()).all()
    rates = load_org_rates(db, me.org_id)  # один раз на весь list_users
    return [_with_balance(db, u, rates=rates) for u in users]


@router.get("/colleagues", response_model=List[UserOut])
def list_colleagues(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Лёгкий список коллег своей org — нужен accountable для выбора approver/получателя transfer.
    Без балансов, без admin-прав."""
    q = db.query(User).filter(
        User.org_id == me.org_id, User.id != me.id, User.is_active.is_(True)
    )
    hidden = hidden_user_ids(db, me)
    if hidden:  # Фича 2: конфиденциальные скрыты из dropdown «КТО/КОМУ» и пр.
        q = q.filter(User.id.notin_(hidden))
    iso = owner_isolation_ws_id(db, me)
    if iso is not None:  # владелец пространства — только участники пространства
        q = q.filter(User.id.in_(workspace_member_ids(db, iso)))
    users = q.order_by(User.name.asc()).all()
    return [UserOut.model_validate(u) for u in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.query(User).filter(User.phone == payload.phone).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Телефон уже занят")

    # Роль superadmin может назначать ТОЛЬКО superadmin (иначе обычный admin выдал бы
    # себе/другому superadmin и обошёл бы конфиденциальность — Фича 2).
    if payload.role == "superadmin" and admin.role != "superadmin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Роль superadmin может назначать только superadmin")

    # Лимит плана: число сотрудников (пользователей) организации.
    org = db.get(Organization, admin.org_id)
    current_employees = db.query(User).filter(User.org_id == admin.org_id).count()
    assert_limit(org, "max_employees", current_employees)

    # supervisor_id, если указан, должен быть в той же org
    if payload.supervisor_id is not None:
        sup = db.get(User, payload.supervisor_id)
        if not sup or sup.org_id != admin.org_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Supervisor должен быть из той же организации"
            )

    u = User(
        org_id=admin.org_id,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        role=payload.role,
        password_hash=hash_password(payload.password),
        supervisor_id=payload.supervisor_id,
    )
    db.add(u)
    db.flush()
    if payload.department_ids is not None:
        _set_departments(db, admin.org_id, u, payload.department_ids)
    _add_to_general_chat(db, u)
    db.commit()
    db.refresh(u)
    return _user_out(u)


@router.get("/me", response_model=UserWithBalance)
def get_me(db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    return _with_balance(db, me)


@router.get("/me/subordinates", response_model=List[UserWithBalance])
def list_my_subordinates(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Активные прямые подотчётные текущего пользователя (по supervisor_id)."""
    subs = (
        db.query(User)
        .filter(User.org_id == me.org_id, User.supervisor_id == me.id, User.is_active.is_(True))
        .order_by(User.created_at.desc())
        .all()
    )
    return [_with_balance(db, u) for u in subs]


@router.post(
    "/subordinates",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
def create_subordinate(
    payload: SubordinateCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Любой пользователь может создать своего подотчётного (role=accountable, supervisor=me)."""
    if db.query(User).filter(User.phone == payload.phone).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Телефон уже занят")

    u = User(
        org_id=me.org_id,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        role="accountable",
        password_hash=hash_password(payload.password),
        supervisor_id=me.id,
    )
    db.add(u)
    db.flush()
    _add_to_general_chat(db, u)
    db.commit()
    db.refresh(u)
    return UserOut.model_validate(u)


@router.get("/{user_id}", response_model=UserWithBalance)
def get_user(user_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    u = db.get(User, user_id)
    if not u or u.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if (
        not is_director_or_auditor(me)
        and me.id != u.id
        and not (u.supervisor_id and u.supervisor_id == me.id)
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    # Фича 2: карточка/баланс конфиденциального сотрудника — только авторизованным и ему самому.
    if user_id in hidden_user_ids(db, me):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    aud_visible = auditor_visible_user_ids(db, me)  # ограниченный аудитор — только «свои»
    if aud_visible is not None and user_id not in aud_visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    return _with_balance(db, u)


def build_user_history_entries(
    db: Session,
    org_id: int,
    user_id: int,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> list[BalanceHistoryEntry]:
    """Собирает entries истории движения денег пользователя за период.
    Используется и в /{user_id}/balance, и в Excel-экспорте /reports/employees/{user_id}/details.xlsx."""
    u = db.get(User, user_id)
    if not u or u.org_id != org_id:
        return []

    df = date_from.replace(tzinfo=None) if date_from and date_from.tzinfo else date_from
    dt_to = date_to.replace(tzinfo=None) if date_to and date_to.tzinfo else date_to

    def _in_period(dt: Optional[datetime]) -> bool:
        if dt is None:
            return True
        if df and dt < df:
            return False
        if dt_to and dt >= dt_to:
            return False
        return True

    entries: list[BalanceHistoryEntry] = []

    # Topups (входящие — user получил)
    for t in (
        db.query(BalanceTopUp)
        .filter(BalanceTopUp.org_id == org_id, BalanceTopUp.user_id == u.id)
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="topup",
                amount=Decimal(str(t.amount)),
                currency=t.currency,
                counterparty=t.admin.name if t.admin else None,
                note=t.note,
                created_at=t.date,
                ref_id=t.id,
            )
        )

    # Topups outgoing — user выдал кому-то из своего кошелька (admin_id=u)
    for t in (
        db.query(BalanceTopUp)
        .filter(BalanceTopUp.org_id == org_id, BalanceTopUp.admin_id == u.id)
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="topup_out",
                amount=-Decimal(str(t.amount)),
                currency=t.currency,
                counterparty=t.user.name if t.user else None,
                note=t.note,
                created_at=t.date,
                ref_id=t.id,
            )
        )

    # Incomes (для тех у кого received_by_id=u)
    from models import Income as _Inc
    for i in (
        db.query(_Inc)
        .filter(_Inc.org_id == org_id, _Inc.received_by_id == u.id)
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="income",
                amount=Decimal(str(i.amount)),
                currency=i.currency,
                counterparty=i.source,
                note=i.description,
                created_at=i.date,
                ref_id=i.id,
            )
        )

    # MoneyTransfers
    for t in (
        db.query(MoneyTransfer)
        .filter(MoneyTransfer.org_id == org_id, MoneyTransfer.to_user_id == u.id)
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="transfer_in",
                amount=Decimal(str(t.amount)),
                currency=t.currency or "KGS",
                counterparty=t.from_user.name if t.from_user else None,
                note=t.note,
                created_at=t.created_at,
                ref_id=t.id,
            )
        )
    for t in (
        db.query(MoneyTransfer)
        .filter(MoneyTransfer.org_id == org_id, MoneyTransfer.from_user_id == u.id)
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="transfer_out",
                amount=-Decimal(str(t.amount)),
                currency=t.currency or "KGS",
                counterparty=t.to_user.name if t.to_user else None,
                note=t.note,
                created_at=t.created_at,
                ref_id=t.id,
            )
        )

    # MoneyRequests approved (входящие — где u заявитель, исходящие — где u одобрил)
    for r in (
        db.query(MoneyRequest)
        .filter(
            MoneyRequest.org_id == org_id,
            MoneyRequest.requester_id == u.id,
            MoneyRequest.status == "approved",
        )
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="request_approved",
                amount=Decimal(str(r.total_amount)),
                currency=r.currency or "KGS",
                counterparty=r.approver.name if r.approver else None,
                note=r.title,
                created_at=r.approved_at or r.updated_at,
                ref_id=r.id,
            )
        )
    for r in (
        db.query(MoneyRequest)
        .filter(
            MoneyRequest.org_id == org_id,
            MoneyRequest.approver_id == u.id,
            MoneyRequest.status == "approved",
        )
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="request_approved_out",
                amount=-Decimal(str(r.total_amount)),
                currency=r.currency or "KGS",
                counterparty=r.requester.name if r.requester else None,
                note=r.title,
                created_at=r.approved_at or r.updated_at,
                ref_id=r.id,
            )
        )

    # Expenses (approved + pending — оба влияют на баланс)
    for e in (
        db.query(Expense)
        .filter(
            Expense.org_id == org_id,
            Expense.employee_id == u.id,
            Expense.status.in_(("approved", "pending")),
        )
        .all()
    ):
        entries.append(
            BalanceHistoryEntry(
                kind="expense",
                amount=-Decimal(str(e.amount)),
                currency=e.currency,
                counterparty=e.category.name if e.category else None,
                note=e.description,
                created_at=e.spent_at,
                ref_id=e.id,
            )
        )

    # Фильтр периода (если задан) — оставляем только операции в окне
    entries = [e for e in entries if _in_period(e.created_at)]
    entries.sort(key=lambda x: x.created_at, reverse=True)
    return entries


@router.get("/{user_id}/balance", response_model=UserBalanceDetails)
def get_user_balance(
    user_id: int,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Детальная история движения денег: пополнения, переводы, заявки, расходы.
    Опциональный фильтр периода (date_from / date_to) — для показа только операций
    выбранного месяца в отчётах."""
    u = db.get(User, user_id)
    if not u or u.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if me.id != u.id and not is_director_or_auditor(me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    # Фича 2: баланс/история конфиденциального сотрудника — только авторизованным и ему самому.
    if user_id in hidden_user_ids(db, me):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    aud_visible = auditor_visible_user_ids(db, me)  # ограниченный аудитор — только «свои»
    if aud_visible is not None and user_id not in aud_visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    entries = build_user_history_entries(db, me.org_id, u.id, date_from, date_to)
    current = compute_current_balance(db, me.org_id, u.id)
    received = compute_total_received(db, me.org_id, u.id)
    total_spent = received - current  # потрачено = получено − остаток

    return UserBalanceDetails(
        current_balance=current,
        total_received=received,
        total_spent=total_spent,
        entries=entries,
    )


@router.get("/{user_id}/expense-chain", response_model=ChainNode)
def get_expense_chain(
    user_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Дерево «передал → потратил → передал дальше». Глубина 5.

    Access:
    - admin/gen_director/auditor — любой user_id в своей org
    - accountable — только себя или своих рекурсивно подчинённых
    """
    root = db.get(User, user_id)
    if not root or root.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    visible = visible_user_ids(db, me)
    if visible is not None and user_id not in visible:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к этой цепочке")
    aud_visible = auditor_visible_user_ids(db, me)  # ограниченный аудитор — только «свои»
    if aud_visible is not None and user_id not in aud_visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    MAX_DEPTH = 5
    visited: set[int] = set()
    chain_rates = load_org_rates(db, me.org_id)

    def build(uid: int, depth: int) -> ChainNode | None:
        if depth >= MAX_DEPTH or uid in visited:
            return None
        visited.add(uid)
        u = db.get(User, uid)
        if not u or u.org_id != me.org_id:
            return None

        # Только approved+pending — rejected не отражают реальные траты
        expense_rows = (
            db.query(Expense)
            .filter(
                Expense.org_id == me.org_id,
                Expense.employee_id == uid,
                Expense.status.in_(("approved", "pending")),
            )
            .order_by(Expense.spent_at.desc())
            .all()
        )
        expenses = [
            ChainExpense(
                id=e.id,
                amount=Decimal(str(e.amount)),
                category_name=e.category.name if e.category else None,
                description=e.description,
                status=e.status,
                spent_at=e.spent_at,
            )
            for e in expense_rows
        ]

        transfer_rows = (
            db.query(MoneyTransfer)
            .filter(MoneyTransfer.org_id == me.org_id, MoneyTransfer.from_user_id == uid)
            .order_by(MoneyTransfer.created_at.desc())
            .all()
        )
        transfers_out: list[ChainTransfer] = []
        for t in transfer_rows:
            transfers_out.append(
                ChainTransfer(
                    id=t.id,
                    amount=Decimal(str(t.amount)),
                    to_user_id=t.to_user_id,
                    to_user_name=t.to_user.name if t.to_user else "—",
                    note=t.note,
                    created_at=t.created_at,
                    child=build(t.to_user_id, depth + 1),
                )
            )

        return ChainNode(
            user_id=u.id,
            user_name=u.name,
            current_balance=compute_current_balance(db, me.org_id, u.id, rates=chain_rates),
            expenses=expenses,
            transfers_out=transfers_out,
        )

    node = build(user_id, 0)
    if node is None:
        # depth=0 — этого не должно случиться, но на всякий случай
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не удалось построить цепочку")
    return node


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if not u or u.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        u.password_hash = hash_password(data.pop("password"))
    # department_ids — не колонка User, обрабатываем отдельно через M2M.
    dept_ids = data.pop("department_ids", None)
    # Фича 2: флаг конфиденциальности может менять ТОЛЬКО superadmin.
    if "is_confidential" in data and admin.role != "superadmin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Менять конфиденциальность может только superadmin",
        )
    # Назначать роль superadmin (или менять роль существующего superadmin) может
    # ТОЛЬКО superadmin — иначе обычный admin эскалировал бы права.
    if "role" in data and (data["role"] == "superadmin" or u.role == "superadmin") and admin.role != "superadmin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Менять роль superadmin может только superadmin",
        )
    if "supervisor_id" in data and data["supervisor_id"] is not None:
        sup = db.get(User, data["supervisor_id"])
        if not sup or sup.org_id != admin.org_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Supervisor должен быть из той же организации"
            )
        if sup.id == u.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Юзер не может быть сам своим supervisor")
    for field, value in data.items():
        setattr(u, field, value)
    if dept_ids is not None:
        _set_departments(db, admin.org_id, u, dept_ids)
    db.commit()
    db.refresh(u)
    return _user_out(u)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Soft-delete: помечаем юзера is_active=False. Не удаляем физически, чтобы
    сохранить историю расходов/заявок/переводов (FK без CASCADE, физический delete
    падает на IntegrityError если есть Expense).

    После soft-delete юзер:
    - не может войти (get_current_user возвращает 401 если is_active=False)
    - исчезает из /api/users, /api/users/colleagues, /api/users/me/subordinates
    - его исторические записи (Expense, Transfer, и т.д.) остаются для отчётов

    Удалить может: admin / gen_director / supervisor этого юзера.
    """
    u = db.get(User, user_id)
    if not u or u.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if u.id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить самого себя")

    can_delete = is_director_level(me) or u.supervisor_id == me.id
    if not can_delete:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Удалить может admin, gen_director или непосредственный руководитель",
        )

    if not u.is_active:
        # уже деактивирован — идемпотентно ок
        return None
    u.is_active = False
    db.commit()
    return None
