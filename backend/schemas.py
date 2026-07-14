from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, EmailStr, Field


CURRENCY_PATTERN = "^(KGS|USD|EUR|RUB)$"
ROLE_PATTERN = "^(superadmin|admin|gen_director|auditor|accountable)$"


# ===================== AUTH =====================

class OrgRegister(BaseModel):
    org_name: str = Field(..., min_length=2, max_length=200)
    inn: Optional[str] = None
    address: Optional[str] = None
    admin_name: str = Field(..., min_length=2)
    admin_phone: str = Field(..., min_length=5)
    admin_password: str = Field(..., min_length=6)
    admin_email: Optional[EmailStr] = None


class LoginRequest(BaseModel):
    phone: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"
    org: "OrgOut"


# ===================== ORG =====================

class OrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    inn: Optional[str] = None
    address: Optional[str] = None
    logo_url: Optional[str] = None
    is_active: bool
    plan: str = "free"
    plan_activated_at: Optional[datetime] = None
    plan_expires_at: Optional[datetime] = None


class PlanInfo(BaseModel):
    """Ответ GET /api/organizations/{id}/plan."""
    plan: str
    limits: dict
    plan_activated_at: Optional[datetime] = None
    plan_expires_at: Optional[datetime] = None


# ===================== USERS =====================

class UserBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    phone: str = Field(..., min_length=5, max_length=20)
    email: Optional[EmailStr] = None
    role: str = Field(default="accountable", pattern=ROLE_PATTERN)
    supervisor_id: Optional[int] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=6)
    # Подразделения сотрудника (мультиселект, необязательно).
    department_ids: Optional[List[int]] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = Field(default=None, pattern=ROLE_PATTERN)
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6)
    supervisor_id: Optional[int] = None
    # None = не менять; [] = очистить все привязки; [..] = заменить набор.
    department_ids: Optional[List[int]] = None
    # Конфиденциальность (Фича 2) — менять может только superadmin (проверка в роутере).
    is_confidential: Optional[bool] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    name: str
    phone: str
    email: Optional[str] = None
    role: str
    is_active: bool
    is_confidential: bool = False
    is_platform_owner: bool = False
    supervisor_id: Optional[int] = None
    created_at: datetime
    # Подразделения сотрудника (id) — заполняется в роутере из M2M.
    department_ids: List[int] = Field(default_factory=list)
    # Владелец проектного пространства — для режима изоляции интерфейса.
    # Заполняется в /api/auth/me и login (по активному пространству пользователя).
    workspace_owner: bool = False
    workspace_id: Optional[int] = None
    workspace_name: Optional[str] = None


# ===================== SUPER (платформенная админка) =====================
class SuperOrgItem(BaseModel):
    id: int
    name: str
    plan: str
    is_active: bool
    employees_count: int
    admin_name: Optional[str] = None
    admin_phone: Optional[str] = None
    plan_expires_at: Optional[datetime] = None


class SuperOrgCreate(BaseModel):
    org_name: str = Field(..., min_length=2, max_length=200)
    admin_name: Optional[str] = Field(default=None, max_length=200)
    admin_phone: str = Field(..., min_length=5, max_length=20)
    admin_password: Optional[str] = Field(default=None, min_length=6)  # None → сгенерим 6 цифр
    plan: Optional[str] = "free"


class SuperOrgCreateOut(BaseModel):
    org_id: int
    org_name: str
    admin_phone: str
    admin_password: str  # plaintext — показывается ОДИН раз при создании
    plan: str


class PlanUpdate(BaseModel):
    plan: str


class UserWithBalance(UserOut):
    balance: Decimal = Decimal(0)  # KGS, для обратной совместимости со старым UI
    issued_total: Decimal = Decimal(0)
    spent_total: Decimal = Decimal(0)
    transferred_out_total: Decimal = Decimal(0)
    monthly_spent: Decimal = Decimal(0)
    monthly_limit: Decimal = Decimal(0)
    balances_by_currency: dict[str, Decimal] = Field(default_factory=dict)
    # Новая финансовая логика (производные поля, KGS).
    current_balance: Decimal = Decimal(0)  # подотчётные деньги
    total_received: Decimal = Decimal(0)   # сумма всех approved заявок + входящих transfers + topups
    total_issued: Decimal = Decimal(0)     # сумма BalanceTopUp где этот юзер — admin_id (выдал другим)


class SubordinateCreate(BaseModel):
    """Создание подотчётного лица (сотрудником). Всегда role=employee."""
    name: str = Field(..., min_length=2, max_length=200)
    phone: str = Field(..., min_length=5, max_length=20)
    password: str = Field(..., min_length=6)
    email: Optional[EmailStr] = None


class TransferCreate(BaseModel):
    """Перевод денег моему подотчётному."""
    subordinate_id: int
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern=CURRENCY_PATTERN)
    purpose: Optional[str] = None
    comment: Optional[str] = None


# ===================== SPEC =====================

class SpecBase(BaseModel):
    monthly_limit: Decimal = Decimal(0)
    single_limit: Decimal = Decimal(0)
    allowed_categories: Optional[List[int]] = None
    requires_receipt: bool = False
    requires_approval: bool = True
    notes: Optional[str] = None


class SpecUpsert(SpecBase):
    pass


class SpecOut(SpecBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    org_id: int
    updated_at: datetime


# ===================== CATEGORIES =====================

class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: bool = True
    is_operational: bool = False
    is_system: bool = False
    parent_id: Optional[int] = None
    # Подразделение категории. None = общая категория (видна во всех подразделениях).
    department_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None
    is_operational: Optional[bool] = None
    parent_id: Optional[int] = None
    department_id: Optional[int] = None


class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    workspace_id: Optional[int] = None  # NOT NULL = приватная категория пространства
    parent_name: Optional[str] = None
    # Для селектов: «Транспорт / Такси» для подкатегорий, просто «Транспорт» для корневых.
    display_name: Optional[str] = None
    # Название подразделения для бейджа в списке категорий (None у общих).
    department_name: Optional[str] = None


# ===================== DEPARTMENTS =====================

class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    name: str
    created_at: datetime
    # Счётчики для страницы управления (заполняются в роутере).
    employee_count: int = 0
    category_count: int = 0


# ===================== INCOME SOURCES (справочник источников дохода) =====================


class IncomeSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class IncomeSourceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    is_active: Optional[bool] = None


class IncomeSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    name: str
    is_active: bool
    created_at: datetime
    # Сколько приходов ссылается на источник (для страницы управления).
    income_count: int = 0


# ===================== SETTINGS (фич-тумблеры организации) =====================


class FlagDefinition(BaseModel):
    key: str
    label: str
    description: str
    default: bool
    group: str


class SettingsOut(BaseModel):
    # Текущие значения (дефолты, перекрытые сохранёнными в org).
    flags: dict[str, bool]
    # Описания тумблеров для отрисовки страницы настроек.
    definitions: list[FlagDefinition]


class SettingsUpdate(BaseModel):
    # Частичное обновление: присылаем только меняемые ключи.
    flags: dict[str, bool]


# ===================== ADVANCES =====================


class AdvanceCreate(BaseModel):
    employee_id: int
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern=CURRENCY_PATTERN)
    payment_type: str = Field(default="cash", pattern="^(cash|card|transfer)$")
    purpose: Optional[str] = None
    comment: Optional[str] = None
    issued_at: Optional[datetime] = None
    force: bool = False  # игнорировать предупреждения о лимитах


class AdvanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    issued_by_id: int
    employee_id: int
    amount: Decimal
    currency: str = "KGS"
    payment_type: str
    source: str = "org_funds"
    purpose: Optional[str] = None
    comment: Optional[str] = None
    issued_at: datetime
    created_at: datetime
    employee_name: Optional[str] = None
    issued_by_name: Optional[str] = None


class AdvanceWarning(BaseModel):
    """Возвращается если amount превышает лимиты и force=False."""
    warnings: List[str]
    single_limit: Decimal
    monthly_limit: Decimal
    monthly_used: Decimal


# ===================== EXPENSES =====================

class ExpenseCreate(BaseModel):
    category_id: Optional[int] = None
    advance_id: Optional[int] = None
    # Подразделение — обязательно для новых расходов (проверяется в роутере).
    department_id: Optional[int] = None
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern="^(KGS|USD|EUR|RUB)$")
    description: Optional[str] = None
    receipt_url: Optional[str] = None
    spent_at: Optional[datetime] = None
    # Опционально: «деньги переданы сотруднику» — параллельно создастся BalanceTopUp
    # на эту же сумму для указанного юзера (только если currency=KGS, чтобы не
    # смешивать валюты в кошельке подотчётных).
    to_user_id: Optional[int] = None
    # Режим администратора: admin вносит расход от лица другого пользователя.
    # employee_id = on_behalf_of_user_id; recorded_by_id = admin. Только при role==admin.
    on_behalf_of_user_id: Optional[int] = None
    # «Расход из личных средств в счёт подразделения»: оплата из личных средств без
    # подотчёта. НЕ создаёт приход — учитывается в агрегате подразделения как приход+расход.
    is_personal_contribution: bool = False
    # Источник оплаты: 'balance' (баланс сотрудника) | 'supplier_advance' (депозит).
    payment_source: str = Field(default="balance", pattern="^(balance|supplier_advance)$")
    # Обязателен при payment_source='supplier_advance' — с какого депозита списать.
    supplier_advance_id: Optional[int] = None


class ExpenseUpdate(BaseModel):
    category_id: Optional[int] = None
    department_id: Optional[int] = None
    amount: Optional[Decimal] = Field(default=None, gt=0)
    currency: Optional[str] = Field(default=None, max_length=8)
    description: Optional[str] = None
    receipt_url: Optional[str] = None
    spent_at: Optional[datetime] = None


class ExpenseReview(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    review_comment: Optional[str] = None


class ExpensePersonalContributionToggle(BaseModel):
    enabled: bool


class ExpenseReceiptCreate(BaseModel):
    file_url: str = Field(..., max_length=500)
    file_name: Optional[str] = Field(default=None, max_length=255)


class ExpenseReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    expense_id: int
    file_url: str
    file_name: Optional[str] = None
    uploaded_by_id: int
    created_at: datetime


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    employee_id: int
    advance_id: Optional[int] = None
    category_id: Optional[int] = None
    amount: Decimal
    currency: str = "KGS"
    amount_kgs: Optional[Decimal] = None  # КГС-эквивалент на момент создания
    description: Optional[str] = None
    receipt_url: Optional[str] = None
    status: str
    reviewed_by_id: Optional[int] = None
    review_comment: Optional[str] = None
    is_verified: bool = False
    verified_by_id: Optional[int] = None
    recorded_by_id: Optional[int] = None
    to_user_id: Optional[int] = None
    expense_type: str = "expense"
    funded_by_id: Optional[int] = None
    source_request_id: Optional[int] = None
    spent_at: datetime
    created_at: datetime
    updated_at: datetime
    department_id: Optional[int] = None
    workspace_id: Optional[int] = None  # NOT NULL = расход внутри проектного пространства
    is_personal_contribution: bool = False  # расход из личных средств в счёт подразделения
    payment_source: str = "balance"  # 'balance' | 'supplier_advance'
    supplier_advance_id: Optional[int] = None
    supplier_name: Optional[str] = None  # имя поставщика (если оплачено с депозита)
    employee_name: Optional[str] = None
    category_name: Optional[str] = None
    department_name: Optional[str] = None
    recorded_by_name: Optional[str] = None
    to_user_name: Optional[str] = None
    funded_by_name: Optional[str] = None
    # Все прикреплённые чеки/документы (заполняется из e.receipts через from_attributes).
    receipts: List[ExpenseReceiptOut] = []


# ===================== REPORTS =====================

class EmployeeSummaryRow(BaseModel):
    employee_id: int
    employee_name: str
    issued: Decimal
    spent: Decimal
    balance: Decimal


class ReportSummary(BaseModel):
    rows: List[EmployeeSummaryRow]
    total_issued: Decimal
    total_spent: Decimal
    total_balance: Decimal


class DayPoint(BaseModel):
    date: str  # YYYY-MM-DD
    issued: Decimal
    spent: Decimal


class ReportSummaryV2(BaseModel):
    """Расширенная сводка: 4 карточки + график по дням (для одной валюты)."""
    currency: str = "KGS"
    issued_total: Decimal
    spent_total: Decimal
    balance: Decimal
    pending_total: Decimal
    by_day: List[DayPoint]


class ByEmployeeRow(BaseModel):
    employee_id: int
    employee_name: str
    issued: Decimal
    spent: Decimal
    balance: Decimal
    pending: Decimal


class ExpenseDetailRow(BaseModel):
    id: int
    spent_at: datetime
    category_name: Optional[str] = None
    amount: Decimal
    description: Optional[str] = None
    status: str
    receipt_url: Optional[str] = None


class ByEmployeeResponse(BaseModel):
    rows: List[ByEmployeeRow]
    details: Optional[List[ExpenseDetailRow]] = None  # заполняется когда задан employee_id


class ByCategoryRow(BaseModel):
    category_id: Optional[int] = None
    category_name: str
    operations: int
    amount: Decimal
    percent: float


class ByCategoryResponse(BaseModel):
    rows: List[ByCategoryRow]
    total_amount: Decimal


class BalanceRow(BaseModel):
    employee_id: int
    employee_name: str
    issued_total: Decimal
    spent_total: Decimal
    balance: Decimal
    monthly_limit: Decimal = Decimal(0)


class BalanceResponse(BaseModel):
    rows: List[BalanceRow]


# ===================== CHAT =====================

class ChatRoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    member_ids: List[int] = Field(default_factory=list)  # пользователи добавятся в комнату вместе с создателем


class ChatDirectCreate(BaseModel):
    user_id: int


class ChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    reply_to_id: Optional[int] = None


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    room_id: int
    sender_id: int
    sender_name: str
    content: str
    reply_to_id: Optional[int] = None
    reply_preview: Optional[str] = None  # короткий текст цитируемого сообщения
    reply_sender_name: Optional[str] = None
    created_at: datetime


class ChatRoomMemberOut(BaseModel):
    user_id: int
    name: str
    role: str


class ChatRoomOut(BaseModel):
    id: int
    name: str
    room_type: str  # group | direct
    members: List[ChatRoomMemberOut]
    last_message: Optional[ChatMessageOut] = None
    unread_count: int = 0


# ===================== MONEY REQUESTS =====================

REQUEST_STATUS_PATTERN = "^(draft|pending|approved|rejected)$"


class MoneyRequestItemIn(BaseModel):
    category_id: Optional[int] = None
    description: str = Field(..., min_length=1, max_length=500)
    amount: Decimal = Field(..., gt=0)
    quantity: int = Field(default=1, ge=1)


class MoneyRequestItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    description: str
    amount: Decimal
    quantity: int


class MoneyRequestCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    approver_id: int
    # Подразделение — обязательно для новых заявок (проверяется в роутере).
    department_id: Optional[int] = None
    currency: str = Field(default="KGS", max_length=8)
    items: List[MoneyRequestItemIn] = Field(default_factory=list)
    # Если True — при одобрении автоматически создаётся Expense у requester'а,
    # деньги списываются сразу. expense_category_id обязателен в этом случае.
    is_expense_on_approve: bool = False
    expense_category_id: Optional[int] = None


class MoneyRequestUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    approver_id: Optional[int] = None
    currency: Optional[str] = Field(default=None, max_length=8)
    is_expense_on_approve: Optional[bool] = None
    expense_category_id: Optional[int] = None
    # Комментарий — править может auditor+ на любой заявке (inline-edit в профиле).
    comment: Optional[str] = Field(default=None, max_length=2000)


class MoneyRequestReject(BaseModel):
    comment: str = Field(..., min_length=1, max_length=2000)


class MoneyRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    requester_id: int
    requester_name: Optional[str] = None
    approver_id: int
    approver_name: Optional[str] = None
    status: str
    title: str
    total_amount: Decimal
    currency: str = "KGS"
    comment: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    is_expense_on_approve: bool = False
    expense_category_id: Optional[int] = None
    expense_category_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    approved_at: Optional[datetime] = None
    items: List[MoneyRequestItemOut] = Field(default_factory=list)


# ===================== MONEY TRANSFERS =====================

class MoneyTransferCreate(BaseModel):
    to_user_id: int
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern=CURRENCY_PATTERN)
    note: Optional[str] = Field(default=None, max_length=500)


class MoneyTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    from_user_id: int
    from_user_name: Optional[str] = None
    to_user_id: int
    to_user_name: Optional[str] = None
    amount: Decimal
    currency: str = "KGS"
    amount_kgs: Optional[Decimal] = None
    note: Optional[str] = None
    created_at: datetime


# ===================== BALANCE TOPUP =====================

class BalanceTopUpCreate(BaseModel):
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern="^(KGS|USD|EUR|RUB)$")
    note: Optional[str] = Field(default=None, max_length=500)
    # Опциональная бизнес-дата (для исторических записей через UI или bulk-import).
    # Если не указана — ставится сейчас.
    date: Optional[datetime] = None
    category_id: Optional[int] = None
    # Подразделение — обязательно для новых пополнений (проверяется в роутере).
    department_id: Optional[int] = None
    # «Кто выдал» — для добавления «передал дальше» от лица сотрудника (admin_id=issued_by).
    # Если не указан — текущий пользователь. Только auditor+ (проверка в роутере).
    issued_by_id: Optional[int] = None


class BalanceTopUpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    admin_id: int
    admin_name: Optional[str] = None
    user_id: int
    user_name: Optional[str] = None
    amount: Decimal
    currency: str = "KGS"
    amount_kgs: Optional[Decimal] = None  # КГС-эквивалент на момент создания
    note: Optional[str] = None
    date: datetime
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    created_at: datetime


# ===================== NOTIFICATIONS =====================

class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    payload: Optional[dict] = None
    is_read: bool
    created_at: datetime


# ===================== USER BALANCE DETAILS =====================

class BalanceHistoryEntry(BaseModel):
    """Унифицированная строка в истории движения денег пользователя."""
    kind: str  # request_approved | transfer_in | transfer_out | topup | topup_out | income | expense
    amount: Decimal  # положительная для пополнений, отрицательная для трат — в РОДНОЙ валюте
    currency: str = "KGS"  # валюта исходной операции
    counterparty: Optional[str] = None  # имя второго участника / админа
    note: Optional[str] = None
    created_at: datetime
    ref_id: Optional[int] = None  # id связанной записи (заявки/перевода/расхода)


class UserBalanceDetails(BaseModel):
    current_balance: Decimal
    total_received: Decimal
    total_spent: Decimal
    entries: List[BalanceHistoryEntry]


# ===================== EXPENSE CHAIN =====================

class ChainExpense(BaseModel):
    id: int
    amount: Decimal
    category_name: Optional[str] = None
    description: Optional[str] = None
    status: str  # pending/approved/rejected — rejected всё равно фильтруем на бэке
    spent_at: datetime


class ChainTransfer(BaseModel):
    id: int
    amount: Decimal
    to_user_id: int
    to_user_name: str
    note: Optional[str] = None
    created_at: datetime
    child: Optional["ChainNode"] = None  # рекурсия; None если глубина исчерпана или цикл


class ChainNode(BaseModel):
    user_id: int
    user_name: str
    current_balance: Decimal  # остаток на дату запроса
    expenses: List[ChainExpense]
    transfers_out: List[ChainTransfer]


# ===================== PUSH SUBSCRIPTIONS =====================

class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribePayload(BaseModel):
    endpoint: str = Field(..., max_length=2048)
    keys: PushKeys
    user_agent: Optional[str] = Field(default=None, max_length=512)


class PushUnsubscribePayload(BaseModel):
    endpoint: str


# ===================== ADMIN BULK IMPORT =====================

class BulkImportItem(BaseModel):
    """Одна операция для массового импорта. Поля разные в зависимости от type."""
    type: str = Field(..., pattern="^(expense|income|topup)$")
    user_id: Optional[int] = None             # employee для expense / получатель для topup
    received_by_id: Optional[int] = None      # получатель для income
    issued_by_id: Optional[int] = None        # «кто выдал» для topup (=admin_id). По умолчанию — текущий admin.
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern="^(KGS|USD|EUR|RUB)$")
    category_id: Optional[int] = None         # для expense и topup
    # Подразделение — обязательно для expense/topup (для income игнорируется).
    department_id: Optional[int] = None
    source: Optional[str] = None              # для income (свободный текст)
    source_id: Optional[int] = None           # для income (выбор из справочника источников)
    description: Optional[str] = None
    note: Optional[str] = None                # для topup
    date: Optional[datetime] = None
    # «Расход из личных средств в счёт подразделения» (только для expense).
    is_personal_contribution: bool = False
    # Чек/документ (только для expense): url из POST /api/expenses/upload-receipt.
    receipt_url: Optional[str] = None


class BulkImportPayload(BaseModel):
    items: List[BulkImportItem]


class BulkImportError(BaseModel):
    index: int
    error: str


class BulkImportResult(BaseModel):
    created: int
    errors: List[BulkImportError]


# ===================== EXCHANGE RATES =====================

class ExchangeRateCreate(BaseModel):
    from_currency: str = Field(..., pattern="^(KGS|USD|EUR|RUB)$")
    to_currency: str = Field(..., pattern="^(KGS|USD|EUR|RUB)$")
    rate: Decimal = Field(..., gt=0)


class ExchangeRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    from_currency: str
    to_currency: str
    rate: Decimal
    date: datetime
    created_by_id: Optional[int] = None


class CurrentRateOut(BaseModel):
    """Если курс ещё не задан — rate=None."""
    from_currency: str
    to_currency: str
    rate: Optional[Decimal] = None
    date: Optional[datetime] = None


# ===================== INCOMES =====================

class IncomeCreate(BaseModel):
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern="^(KGS|USD|EUR|RUB)$")
    # source — свободный текст; source_id — выбор из справочника. Нужно хотя бы одно
    # (валидируется в роутере). Если задан source_id, имя источника подставится в source.
    source: Optional[str] = Field(default=None, max_length=200)
    source_id: Optional[int] = None
    description: Optional[str] = None
    received_by_id: int
    date: Optional[datetime] = None
    # on_behalf_of не вводим отдельно — для Income переопределение получателя уже
    # делается через received_by_id. created_by_id (=кто внёс) ставит роутер.


class IncomeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    amount: Decimal
    currency: str
    amount_kgs: Optional[Decimal] = None  # КГС-эквивалент, зафиксированный при создании
    source: str
    source_id: Optional[int] = None
    description: Optional[str] = None
    received_by_id: int
    received_by_name: Optional[str] = None
    created_by_id: int
    created_by_name: Optional[str] = None
    date: datetime
    created_at: datetime


class IncomeUpdate(BaseModel):
    """Все поля опциональны — patch обновляет только присланные."""
    amount: Optional[Decimal] = Field(default=None, gt=0)
    currency: Optional[str] = Field(default=None, pattern="^(KGS|USD|EUR|RUB)$")
    source: Optional[str] = Field(default=None, min_length=1, max_length=200)
    source_id: Optional[int] = None
    description: Optional[str] = None
    received_by_id: Optional[int] = None
    date: Optional[datetime] = None


class BalanceTopUpUpdate(BaseModel):
    amount: Optional[Decimal] = Field(default=None, gt=0)
    currency: Optional[str] = Field(default=None, pattern="^(KGS|USD|EUR|RUB)$")
    note: Optional[str] = Field(default=None, max_length=500)
    date: Optional[datetime] = None
    user_id: Optional[int] = None  # на случай если ошибочно зачислили не тому
    admin_id: Optional[int] = None  # кто выдал
    category_id: Optional[int] = None
    department_id: Optional[int] = None


# ===================== RECURRING OBLIGATIONS (регулярные обязательства) =====================

_PERIODICITY = "^(monthly|weekly|yearly|one_time)$"


class RecurringObligationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    amount: Decimal = Field(..., gt=0)
    periodicity: str = Field(default="monthly", pattern=_PERIODICITY)
    comment: Optional[str] = Field(default=None, max_length=1000)
    category_id: Optional[int] = None


class RecurringObligationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[Decimal] = Field(default=None, gt=0)
    periodicity: Optional[str] = Field(default=None, pattern=_PERIODICITY)
    comment: Optional[str] = Field(default=None, max_length=1000)
    category_id: Optional[int] = None


class RecurringObligationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    amount: Decimal
    periodicity: str
    comment: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    sort_order: int
    created_at: datetime


class ReorderPayload(BaseModel):
    ids: list[int]


# ===================== EXPECTED INCOMES (ожидаемые пополнения) =====================

_EXP_PERIODICITY = "^(one_time|monthly|weekly)$"


class ExpectedIncomeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern="^(KGS|USD|EUR)$")
    expected_date: Optional[datetime] = None
    periodicity: str = Field(default="one_time", pattern=_EXP_PERIODICITY)
    comment: Optional[str] = Field(default=None, max_length=1000)


class ExpectedIncomeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[Decimal] = Field(default=None, gt=0)
    currency: Optional[str] = Field(default=None, pattern="^(KGS|USD|EUR)$")
    expected_date: Optional[datetime] = None
    periodicity: Optional[str] = Field(default=None, pattern=_EXP_PERIODICITY)
    comment: Optional[str] = Field(default=None, max_length=1000)


class ExpectedIncomeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    amount: Decimal
    currency: str
    amount_kgs: Optional[Decimal] = None  # КГС-эквивалент по текущему курсу (для отображения)
    expected_date: Optional[datetime] = None
    periodicity: str
    comment: Optional[str] = None
    status: str
    received_at: Optional[datetime] = None
    created_income_id: Optional[int] = None
    created_at: datetime


# ===================== PROJECT WORKSPACES (проектные пространства) =====================

class WorkspaceUserShort(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: Optional[str] = None


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    owner_id: int


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    name: str
    description: Optional[str] = None
    owner: WorkspaceUserShort
    is_active: bool
    created_at: datetime
    members_count: int = 0
    # Финансовый агрегат по владельцу пространства (KGS).
    total_received: Decimal = Decimal(0)
    total_spent: Decimal = Decimal(0)
    balance: Decimal = Decimal(0)


class WorkspaceSummary(BaseModel):
    """Агрегат для admin/auditor — только финансовый итог по владельцу, без детализации."""
    owner: WorkspaceUserShort
    total_received: Decimal = Decimal(0)
    total_spent: Decimal = Decimal(0)
    balance: Decimal = Decimal(0)


class WorkspaceMemberCreate(BaseModel):
    user_id: int


class WorkspaceMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    user_id: int
    user: WorkspaceUserShort
    added_at: datetime


class WorkspaceMemberBalance(BaseModel):
    user_id: int
    name: str
    received_external: Decimal = Decimal(0)   # пришло извне пространства (компания → участник)
    received_internal: Decimal = Decimal(0)   # пришло от других участников (Мээрим → Дилан)
    spent: Decimal = Decimal(0)               # утверждённые расходы
    transferred_out: Decimal = Decimal(0)     # выдал другим участникам
    balance: Decimal = Decimal(0)


class WorkspaceCategoryReportRow(BaseModel):
    category_id: Optional[int] = None
    category: str
    amount: Decimal = Decimal(0)
    count: int = 0
    percent: float = 0.0


class WorkspaceCategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: Optional[str] = None
    color: Optional[str] = None
    is_operational: bool = False
    parent_id: Optional[int] = None


# ===================== SUPPLIER ADVANCES (депозиты у поставщиков) =====================

class SupplierAdvanceCreate(BaseModel):
    """Первое внесение аванса поставщику: баланс сотрудника уменьшается."""
    employee_id: Optional[int] = None  # чей баланс (по умолчанию — текущий пользователь)
    supplier_name: str = Field(..., min_length=1, max_length=200)
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="KGS", pattern="^(KGS|USD|EUR|RUB)$")
    date: Optional[datetime] = None
    comment: Optional[str] = None


class SupplierAdvanceUpdate(BaseModel):
    """Редактирование депозита (поставщик/комментарий). Суммы правятся через
    deposit/refund, не здесь."""
    supplier_name: Optional[str] = Field(None, min_length=1, max_length=200)
    comment: Optional[str] = None


class SupplierAdvanceDeposit(BaseModel):
    """Довнесение на существующий депозит."""
    amount: Decimal = Field(..., gt=0)
    date: Optional[datetime] = None
    comment: Optional[str] = None


class SupplierAdvanceRefund(BaseModel):
    """Возврат остатка депозита сотруднику (баланс сотрудника увеличивается)."""
    amount: Decimal = Field(..., gt=0)
    date: Optional[datetime] = None
    comment: Optional[str] = None


class SupplierAdvanceTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    advance_id: int
    type: str  # deposit | purchase | refund
    amount: Decimal
    expense_id: Optional[int] = None
    date: datetime
    created_by_id: Optional[int] = None
    # Обогащение для покупок (из связанного Expense):
    category_name: Optional[str] = None
    department_name: Optional[str] = None
    description: Optional[str] = None
    receipt_url: Optional[str] = None


class SupplierAdvanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    workspace_id: Optional[int] = None
    employee_id: int
    supplier_name: str
    initial_amount: Decimal
    currency: str = "KGS"
    status: str  # active | depleted | closed
    comment: Optional[str] = None
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    # Агрегаты (считаются в роутере, не хранятся):
    deposited: Decimal = Decimal(0)   # Σ deposit
    spent: Decimal = Decimal(0)       # Σ purchase
    refunded: Decimal = Decimal(0)    # Σ refund
    remaining: Decimal = Decimal(0)   # deposited − spent − refunded
    employee_name: Optional[str] = None
    transactions: List[SupplierAdvanceTransactionOut] = []


# Forward refs
TokenResponse.model_rebuild()
