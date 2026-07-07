# PodotchetPRO — учёт подотчётных средств

Веб-приложение для учёта выдачи денег сотрудникам под отчёт, расходов, чеков,
заявок и переводов внутри организации. Multi-currency (KGS / USD / EUR / RUB), все
балансы сводятся к KGS-эквиваленту по курсу на момент операции.

- **Прод:** https://podotchetpro.com (сервер `hetzner-bot`)
- **Деплой:** `./deploy.sh` (rsync + alembic + restart + smoke-test `/health`)

## Стек

- **Backend:** FastAPI + SQLAlchemy 2.0 + Alembic, PostgreSQL (psycopg2).
  JWT-аутентификация (python-jose), пароли bcrypt 4.0.1 (закреплён!).
  Excel — openpyxl. Web Push — pywebpush (VAPID).
- **Frontend:** Vite + React 18 + TypeScript (только `.ts`/`.tsx`). PWA
  (service worker). Роутинг — react-router-dom 6. Графики — recharts.
  **UI без библиотек** — собственный CSS (`src/styles/global.css`, тёмная тема,
  `--accent: #6c5ce7`), иконки — эмодзи. API — собственный `fetch`-клиент
  (`src/api/client.ts`), **без React Query**, токен в `localStorage` (`pp_token`).

## Структура

```
backend/
  main.py            # сборка app, CORS, mount /uploads (StaticFiles), регистрация роутеров
  config.py          # Settings (env: DATABASE_URL, JWT_SECRET, UPLOAD_DIR, CORS_ORIGINS, VAPID_*)
  database.py        # engine, SessionLocal, Base, get_db
  models.py          # ВСЕ модели в одном файле
  schemas.py         # ВСЕ Pydantic-схемы в одном файле
  auth.py            # JWT, get_current_user, require_* зависимости, is_director_level/_or_auditor
  routers/           # по доменам: expenses, advances, income, requests, transfers,
                     #   topup, users, reports, dashboard, categories, specs, chat,
                     #   notifications, push, exchange_rates, admin, auth
  services/          # balance.py (расчёт баланса), exchange.py (курсы + НБКР),
                     #   permissions.py (visible_user_ids), excel_export, push_service
  alembic/versions/  # миграции (имена: ГГГГ_ММ_ДД_описание.py)
  uploads/           # ЛОКАЛЬНОЕ хранилище чеков ({org_id}/{uuid}.ext) — не в git, не на R2
frontend/src/
  pages/             # страницы по ролям (см. App.tsx)
  components/        # переиспользуемые: модалки, формы, StatusBadge, ReceiptPreview, BurgerMenu
  context/           # AuthContext (роль/пользователь), CurrencyContext (тумблер с/$ отчётов)
  api/               # client.ts (api/uploadReceipt/downloadFile) + доменные модули
deploy/              # podotchetpro.nginx, podotchetpro.service (systemd)
deploy.sh            # деплой
```

## Роли (`User.role`)

- `superadmin` — суперроль над всем (Татина). По правам ≥ `admin`: входит во все
  списки ролей (`ADMIN_ROLES`/`DIRECTOR_LEVEL_ROLES`/`DIRECTOR_OR_AUDITOR_ROLES` в
  `auth.py`). Единственный, кто видит конфиденциальных сотрудников наравне с
  `gen_director` и может менять флаг `is_confidential` / назначать роль `superadmin`.
- `admin` — техническая супер-роль; вносит расход «от лица» другого
  (`recorded_by_id`), правит чужие записи, курсы валют. **НЕ** видит конфиденциальных.
- `gen_director` — владелец бизнеса, полный финансовый контроль (director-level).
  Видит конфиденциальных.
- `auditor` — только чтение + верификация расходов (`is_verified`), без правок.
  **НЕ** видит конфиденциальных.
- `accountable` (**подотчётный**) — рядовой сотрудник. Видит себя + своих прямых
  подчинённых (`supervisor_id`, рекурсивно через `services/permissions.visible_user_ids`).
  Создаёт расходы/переводы/заявки, заводит своих подотчётных.

`is_director_level` = superadmin | admin | gen_director. `role` — свободный
`String(20)` (без ENUM/CHECK), поэтому добавление роли НЕ требует миграции. Иерархия
подотчётных — через `User.supervisor_id`. Лимиты и требования — в `EmployeeSpec`.

### Конфиденциальные сотрудники (`User.is_confidential`)

Флаг `is_confidential` скрывает сотрудника от всех, КРОМЕ `superadmin`, `gen_director`
и его самого. Скрываются его расходы, баланс, выдачи, присутствие в списках/dropdown,
прямой доступ к карточке/чекам/xlsx. Центральная логика:

- `auth.can_see_confidential(user)` = роль in (`superadmin`, `gen_director`).
- `services/permissions.hidden_user_ids(db, me)` — set id для скрытия; **всегда**
  исключает `me.id` (конфиденциальный видит себя). Применён в `routers/expenses`,
  `users`, `reports` (+ xlsx), `admin/recent-operations`.
- Менять `is_confidential` может только `superadmin` (иначе `PATCH /users` → 403);
  чекбокс в карточке сотрудника виден только `superadmin`.
- **Атрибуция получателю работает сама:** выдача конфиденциального → `_auto_expense_for_topup`
  создаёт `Expense` с `employee_id`=получатель, поэтому в отчётах расход показывается
  от лица получателя, не конфиденциального.

## Ключевые сущности (models.py)

- **Expense** — расход. `expense_type`: `expense` | `transfer` (передача другому
  подотчётному → создаётся парный `BalanceTopUp` у получателя). `amount_kgs` —
  KGS-эквивалент на момент создания (для баланса). `receipt_url` — legacy одиночный
  чек; теперь чеки в **ExpenseReceipt** (несколько на расход).
- **ExpenseReceipt** — прикреплённые чеки/документы (много на расход). Докладываются
  даже после проверки; удаляются только пока расход `pending` (или директором).
- **Advance** — выдача денег (org → сотрудник). **Income** — приход новых денег извне.
  **BalanceTopUp** — перераспределение между юзерами. **MoneyRequest** — заявка на деньги.
  **MoneyTransfer** — перевод между юзерами. **Category** — статья расходов (2 уровня,
  `parent_id`; `is_system`/`is_operational`). **ExchangeRate** — курсы (последний по дате).

### Статусы расхода (важно!)

`Expense.status`: `pending` → `approved` | `rejected` (проверка директором,
`POST /expenses/{id}/review`). Правило блокировки:

- **`pending`** — владелец может **править и удалять** свой расход и его чеки.
- **`approved` / `rejected`** — расход **заблокирован** (`PATCH`/`DELETE` запрещены
  не-директору). Можно **только доклеить чек** (`POST /expenses/{id}/receipts`), без
  изменения суммы/описания.

`is_verified` — отдельная аудиторская верификация, не зависит от `status`.

## Баланс

Остаток **вычисляется**, не хранится: `compute_current_balance` =
выдано − потрачено − передано (всё в KGS). Полная история движения денег —
`build_user_history_entries` (users.py), отдаётся в `GET /users/{id}/balance` и
в Excel `GET /reports/employees/{id}/history.xlsx` (доступно самому сотруднику).

## Файлы / чеки

Загрузка: `POST /api/expenses/upload-receipt` (multipart, image/pdf, ≤10 МБ) →
сохраняет в `uploads/{org_id}/{uuid}.ext`, возвращает `{url}`. Затем url
привязывается к расходу через `POST /api/expenses/{id}/receipts`.
Хранение **локальное** (`UPLOAD_DIR`), `app.mount("/uploads", StaticFiles)`.
R2 пока не используется.

## Конвенции

- **Каждый роут self-contained** где возможно; модели и схемы — централизованно
  (models.py / schemas.py), это исторически сложившийся стиль проекта.
- **Индексы** на org_id, employee_id, status, даты — обязательно для новых полей.
- **Миграции — только аддитивные** на проде (CREATE TABLE / ADD COLUMN nullable),
  чтобы не уронить работающий сервис. Прод на Postgres; на SQLite вся цепочка не
  прогоняется (ранние миграции используют ALTER constraint) — для локального теста
  миграции проверять изолированно.
- **Файлы фронта ≤300 строк** — разбивать на компоненты.
- **Тумблер валют (с/$) в шапке** влияет только на отчёты директора/аудитора
  (`useDisplayCurrency` → `currency=` в запрос). У роли `accountable` он скрыт
  (суммы всегда в сомах).
- Все суммы в UI: `formatAmountWithEquivalent` / `formatMoney` (KGS-эквивалент).

## Деплой

```bash
./deploy.sh                 # фронт + бэкенд + миграции + рестарт + smoke-test
./deploy.sh --backend-only  # только бэкенд + миграции
./deploy.sh --no-build      # без пересборки фронта
```

Порядок на сервере: `pip install` → `alembic upgrade head` → `systemctl restart
podotchetpro.service` → проверка `https://podotchetpro.com/health` (`{"status":"ok"}`).
rsync backend идёт с `--exclude .venv/uploads/.env/*.db` (venv на сервере локальный).
**Перед миграцией на проде — бэкап БД.**
