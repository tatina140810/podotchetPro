from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
import sqlalchemy as sa  # для server_default=sa.text(...)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    inn: Mapped[Optional[str]] = mapped_column(String(20))
    address: Mapped[Optional[str]] = mapped_column(String(500))
    logo_url: Mapped[Optional[str]] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Тумблеры фич организации (страница настроек суперадмина). NULL/{} = всё по
    # дефолтам из services/feature_flags.py. Хранится как {"income_sources": true, ...}.
    feature_flags: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="organization", cascade="all,delete-orphan")
    categories: Mapped[list["Category"]] = relationship(back_populates="organization", cascade="all,delete-orphan")
    departments: Mapped[list["Department"]] = relationship(back_populates="organization", cascade="all,delete-orphan")


class Department(Base):
    """Подразделение — уровень иерархии над сотрудниками и категориями
    (Холдинг → Подразделения → Сотрудники/Категории → Расходы).
    Примеры: «AVA Pay», «Gold Фонд», «8 этаж». Уникально по (org_id, name)."""
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="departments")
    employees: Mapped[list["User"]] = relationship(
        "User", secondary="employee_departments", back_populates="departments"
    )

    __table_args__ = (
        UniqueConstraint("org_id", "name", name="uq_departments_org_name"),
    )


class IncomeSource(Base):
    """Справочник источников дохода (как подразделение, но для приходов).
    Примеры: «Обменка», «Кредит», «Оплата клиента». Уникально по (org_id, name).
    is_active=False — скрыт из выпадающих списков, но старые приходы на него ссылаются."""
    __tablename__ = "income_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=sa.text("true"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("org_id", "name", name="uq_income_sources_org_name"),
    )


class EmployeeDepartment(Base):
    """M2M: сотрудник может состоять в нескольких подразделениях (необязательно)."""
    __tablename__ = "employee_departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True
    )

    __table_args__ = (
        UniqueConstraint("employee_id", "department_id", name="uq_employee_departments_pair"),
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # gen_director | auditor | accountable | admin
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="accountable")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Конфиденциальный сотрудник: его расходы/баланс/выдачи скрыты от всех,
    # кроме superadmin, gen_director и его самого. Ставит только superadmin.
    is_confidential: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.text("false"), nullable=False
    )
    # Непосредственный руководитель: кому accountable отправляет заявки и от кого получает переводы.
    # Раньше называлось created_by_id; миграция rename сохраняет данные.
    supervisor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="users")
    spec: Mapped[Optional["EmployeeSpec"]] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all,delete-orphan",
        foreign_keys="EmployeeSpec.user_id",
    )
    supervisor: Mapped[Optional["User"]] = relationship(
        "User", remote_side="User.id", foreign_keys=[supervisor_id], back_populates="subordinates"
    )
    subordinates: Mapped[list["User"]] = relationship(
        "User", back_populates="supervisor", foreign_keys=[supervisor_id]
    )
    # Подразделения сотрудника (M2M, необязательно). accountable видит/выбирает только свои.
    departments: Mapped[list["Department"]] = relationship(
        "Department", secondary="employee_departments", back_populates="employees"
    )


class EmployeeSpec(Base):
    __tablename__ = "employee_specs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    monthly_limit: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    single_limit: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    allowed_categories: Mapped[Optional[list]] = mapped_column(JSON)  # list[int] | None
    requires_receipt: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    user: Mapped[User] = relationship(back_populates="spec", foreign_keys=[user_id])


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[Optional[str]] = mapped_column(String(50))
    color: Mapped[Optional[str]] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Операционная категория — попадает в блок «ОПЕРАЦИОННЫЕ РАСХОДЫ» отчёта /reports/categories
    # (Налоги, Аренда, ЗП, Связь, Хоз. расход и т.п.). Остальные — «ПРОЧИЕ РАСХОДЫ».
    is_operational: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.text("false"), nullable=False
    )
    # Системная категория (например «Подотчёт») — нельзя удалить, не считается как расход.
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.text("false"), nullable=False
    )
    # Родительская категория для иерархии (2 уровня: корневая → подкатегория).
    # Подкатегория не может иметь своих подкатегорий — проверяется в роутере.
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Подразделение категории. NULL = общая категория (видна во всех подразделениях).
    # У старых категорий до миграции — NULL.
    department_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    organization: Mapped[Organization] = relationship(back_populates="categories")
    parent: Mapped[Optional["Category"]] = relationship(
        remote_side="Category.id", foreign_keys=[parent_id]
    )
    department: Mapped[Optional["Department"]] = relationship(foreign_keys=[department_id])


class Advance(Base):
    __tablename__ = "advances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    issued_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, default="KGS", server_default="KGS"
    )  # KGS / USD / EUR / RUB
    payment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="cash")  # cash/card/transfer
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="org_funds", server_default="org_funds"
    )  # org_funds (admin → employee) / transfer (employee → его подотчётный)
    purpose: Mapped[Optional[str]] = mapped_column(String(500))
    comment: Mapped[Optional[str]] = mapped_column(Text)
    issued_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    issued_by: Mapped[User] = relationship(foreign_keys=[issued_by_id])
    employee: Mapped[User] = relationship(foreign_keys=[employee_id])


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    advance_id: Mapped[Optional[int]] = mapped_column(ForeignKey("advances.id", ondelete="SET NULL"))
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, default="KGS", server_default="KGS"
    )  # KGS / USD / EUR / RUB
    # КГС-эквивалент на момент создания. Для KGS = amount; для USD/RUB = amount × курс.
    # NULL — только у старых записей до миграции. Используется в balance.py для current_balance.
    amount_kgs: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    reviewed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    review_comment: Mapped[Optional[str]] = mapped_column(Text)
    # Аудиторская верификация: отдельно от бухгалтерского status. Auditor выставляет True.
    is_verified: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    verified_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    # «Кто фактически внёс запись». Отличается от employee_id когда admin вносит
    # расход от лица другого пользователя (режим администратора). NULL = сам employee.
    recorded_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    # Передача внутри org: если to_user_id указан — это «transfer» (не конечный расход).
    # В отчёте по категориям такие записи НЕ попадают (деньги ещё внутри org).
    to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    # 'expense' (конечный расход компании) | 'transfer' (передача другому подотчётному).
    # При to_user_id IS NOT NULL автоматически = 'transfer'.
    expense_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="expense", server_default="expense"
    )
    # «Из чьих денег оплачено» — для request-based Expense (approver финансировал).
    funded_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    # Если расход создан из MoneyRequest при одобрении — ссылка на исходную заявку.
    source_request_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("money_requests.id", ondelete="SET NULL")
    )
    # Подразделение расхода. Обязательно для новых записей (форсится в API);
    # NULL только у старых записей до миграции ("Не указано").
    department_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    spent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    reviewed_by: Mapped[Optional[User]] = relationship(foreign_keys=[reviewed_by_id])
    verified_by: Mapped[Optional[User]] = relationship(foreign_keys=[verified_by_id])
    recorded_by: Mapped[Optional[User]] = relationship(foreign_keys=[recorded_by_id])
    to_user: Mapped[Optional[User]] = relationship(foreign_keys=[to_user_id])
    funded_by: Mapped[Optional[User]] = relationship(foreign_keys=[funded_by_id])
    category: Mapped[Optional[Category]] = relationship()
    advance: Mapped[Optional[Advance]] = relationship()
    department: Mapped[Optional["Department"]] = relationship(foreign_keys=[department_id])
    # Прикреплённые чеки/документы. Может быть несколько; докладываются даже после
    # проверки расхода (см. routers/expenses.py). cascade — чтобы удалялись с расходом.
    receipts: Mapped[list["ExpenseReceipt"]] = relationship(
        "ExpenseReceipt",
        cascade="all, delete-orphan",
        order_by="ExpenseReceipt.created_at",
    )


class ExpenseReceipt(Base):
    """Прикреплённый к расходу документ (чек, накладная и т.п.). У одного расхода
    может быть несколько. Чеки можно докладывать даже после проверки расхода
    (status approved/rejected); удалять — только пока pending (или директор)."""
    __tablename__ = "expense_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expense_id: Mapped[int] = mapped_column(
        ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[Optional[str]] = mapped_column(String(255))
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    uploaded_by: Mapped[User] = relationship(foreign_keys=[uploaded_by_id])


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    room_type: Mapped[str] = mapped_column(String(10), nullable=False)  # group / direct
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    members: Mapped[list["ChatMember"]] = relationship(
        back_populates="room", cascade="all,delete-orphan"
    )
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="room", cascade="all,delete-orphan"
    )


class ChatMember(Base):
    __tablename__ = "chat_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    last_read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    room: Mapped[ChatRoom] = relationship(back_populates="members")
    user: Mapped[User] = relationship()

    __table_args__ = (
        UniqueConstraint("room_id", "user_id", name="uq_chat_members_room_user"),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reply_to_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )

    room: Mapped[ChatRoom] = relationship(back_populates="messages")
    sender: Mapped[User] = relationship()
    reply_to: Mapped[Optional["ChatMessage"]] = relationship(remote_side="ChatMessage.id")


# ===================== Финансовая логика подотчётных =====================
# Заявка на деньги (workflow: draft → pending → approved/rejected).

class MoneyRequest(Base):
    __tablename__ = "money_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requester_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    approver_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft", server_default="draft", index=True
    )  # draft | pending | approved | rejected
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    total_amount: Mapped[float] = mapped_column(
        Numeric(12, 2), nullable=False, default=0, server_default="0"
    )
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, default="KGS", server_default="KGS"
    )
    comment: Mapped[Optional[str]] = mapped_column(Text)  # обычно — причина отклонения
    # Если True — при approve автоматически создаётся Expense (конечный расход),
    # а не TopUp под отчёт. Деньги списываются сразу как расход.
    is_expense_on_approve: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.text("false"), nullable=False
    )
    # Категория для расхода (используется когда is_expense_on_approve=True).
    expense_category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    # Подразделение заявки. Обязательно для новых; NULL у старых ("Не указано").
    department_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id])
    approver: Mapped[User] = relationship(foreign_keys=[approver_id])
    expense_category: Mapped[Optional[Category]] = relationship(foreign_keys=[expense_category_id])
    department: Mapped[Optional["Department"]] = relationship(foreign_keys=[department_id])
    items: Mapped[list["MoneyRequestItem"]] = relationship(
        back_populates="request", cascade="all,delete-orphan"
    )


class MoneyRequestItem(Base):
    __tablename__ = "money_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("money_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    request: Mapped[MoneyRequest] = relationship(back_populates="items")
    category: Mapped[Optional[Category]] = relationship()


class MoneyTransfer(Base):
    __tablename__ = "money_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    to_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    from_user: Mapped[User] = relationship(foreign_keys=[from_user_id])
    to_user: Mapped[User] = relationship(foreign_keys=[to_user_id])


class BalanceTopUp(Base):
    """Пополнение баланса юзера 'из казны' (вносит admin или сам gen_director)."""
    __tablename__ = "balance_topups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    admin_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )  # кто внёс
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )  # кому пополнили
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, default="KGS", server_default="KGS"
    )
    # КГС-эквивалент, зафиксированный на момент создания (как у Expense/Income).
    # NULL у старых записей до миграции — в баланс не входят.
    amount_kgs: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(500))
    # Бизнес-дата операции (может быть в прошлом для bulk-import).
    # Отличается от created_at — created_at это когда запись внесли в систему.
    date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    # Опциональная категория — для отчётности «выдача на канцелярию», и т.п.
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    # Подразделение пополнения. Обязательно для новых; NULL у старых ("Не указано").
    department_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    admin: Mapped[User] = relationship(foreign_keys=[admin_id])
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    category: Mapped[Optional[Category]] = relationship()
    department: Mapped[Optional["Department"]] = relationship(foreign_keys=[department_id])


class PushSubscription(Base):
    """Web Push подписка браузера юзера. Один юзер может иметь несколько подписок
    (разные устройства/браузеры). endpoint уникален в рамках браузера."""
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    endpoint: Mapped[str] = mapped_column(String(2048), nullable=False)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )


class Income(Base):
    """Поступление денег в организацию извне (кредит, оплата клиента, partner и т.п.).
    В отличие от BalanceTopUp — это новые деньги в системе, не перераспределение.
    Влияет на current_balance получателя только если currency=KGS (см. balance.py)."""
    __tablename__ = "incomes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, default="KGS", server_default="KGS"
    )
    # КГС-эквивалент, зафиксированный на момент записи. Для KGS = amount; для USD/RUB
    # = amount × курс_на_момент_создания. NULL — только у старых записей до миграции
    # (если курса не было) — такие в баланс не входят.
    amount_kgs: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    # Текстовый источник (legacy / свободный ввод). При выборе из справочника сюда
    # дублируется имя источника — чтобы старые отчёты и записи без source_id работали.
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    # Ссылка на справочник источников (если выбран из списка). NULL = свободный текст.
    source_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("income_sources.id", ondelete="SET NULL"), nullable=True, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text)
    received_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    received_by: Mapped[User] = relationship(foreign_keys=[received_by_id])
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    source_ref: Mapped[Optional["IncomeSource"]] = relationship(foreign_keys=[source_id])


class RecurringObligation(Base):
    """Личный справочник регулярных расходов сотрудника — подсказка при создании
    заявок (НЕ создаёт заявку автоматически). Данные на уровне пользователя.
    «Итого к резерву» = сумма строк с periodicity='monthly' (считается на фронте)."""
    __tablename__ = "recurring_obligations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    # monthly | weekly | one_time
    periodicity: Mapped[str] = mapped_column(
        String(16), nullable=False, default="monthly", server_default="monthly"
    )
    comment: Mapped[Optional[str]] = mapped_column(Text)
    # Ручная сортировка (кнопки ↑/↓). По возрастанию, затем по id.
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class ExchangeRate(Base):
    """Курс конвертации валют в рамках org. Берём последний по `date` как текущий.
    Сейчас используется только пара USD/KGS; модель универсальна на будущее."""
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_currency: Mapped[str] = mapped_column(String(8), nullable=False)  # USD
    to_currency: Mapped[str] = mapped_column(String(8), nullable=False)    # KGS
    # Сколько единиц to_currency за 1 единицу from_currency.
    rate: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    created_by: Mapped[Optional[User]] = relationship(foreign_keys=[created_by_id])


class Notification(Base):
    """Простое уведомление в БД (без push/email). UI читает GET /api/notifications."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # request_submitted | request_approved | ...
    payload: Mapped[Optional[dict]] = mapped_column(JSON)
    is_read: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )
