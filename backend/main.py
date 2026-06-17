import os
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import get_settings
from database import Base, engine
from routers import (
    admin as admin_router,
    auth,
    advances,
    categories,
    departments,
    employees,
    chat,
    dashboard,
    exchange_rates,
    expected_incomes,
    expenses,
    income,
    income_sources,
    notifications,
    organizations,
    push,
    recurring_obligations,
    reports,
    requests as requests_router,
    settings as settings_router,
    specs,
    transfers,
    users,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("podotchet")

settings = get_settings()
app = FastAPI(title="PodotchetPRO API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    os.makedirs(settings.upload_dir, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(bind=engine)
        log.info("SQLite: схема создана через create_all")
    log.info("PodotchetPRO запущен. CORS origins=%s", settings.cors_origins_list)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "podotchet-pro"}


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(specs.router)
app.include_router(categories.router)
app.include_router(departments.router)
app.include_router(employees.router)
app.include_router(advances.router)
app.include_router(expenses.router)
app.include_router(reports.router)
app.include_router(dashboard.router)
app.include_router(chat.router)
app.include_router(requests_router.router)
app.include_router(transfers.router)
app.include_router(transfers.topup_router)
app.include_router(notifications.router)
app.include_router(push.router)
app.include_router(exchange_rates.router)
app.include_router(income.router)
app.include_router(income_sources.router)
app.include_router(expected_incomes.router)
app.include_router(organizations.router)
app.include_router(recurring_obligations.router)
app.include_router(settings_router.router)
app.include_router(admin_router.router)

app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
