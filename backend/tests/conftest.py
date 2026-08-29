"""Тестовая инфраструктура.

БД: локальный Postgres podotchet_test (env выставляется ДО импорта app-модулей,
поэтому database.SessionLocal уже привязан к тестовой БД). Схема — create_all.
Глобальный soft-delete хук активируется импортом services.soft_delete.

Переопределять get_db не нужно: он и так отдаёт сессии тестовой БД.
"""
import os

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg2://tatina@127.0.0.1:5432/podotchet_test",
)
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.orm import Session as _Session

import database
import models  # noqa: F401 — регистрирует модели в metadata
import services.soft_delete as soft_delete  # активирует хук do_orm_execute
import auth
from main import app
from fastapi.testclient import TestClient

_ALEMBIC_INI = os.path.join(os.path.dirname(__file__), "..", "alembic.ini")


@pytest.fixture(scope="session", autouse=True)
def _schema():
    # Схему поднимаем ЧЕРЕЗ МИГРАЦИИ (как на проде), а не create_all — иначе тесты
    # проверяли бы схему, которая с Alembic может не совпасть (условие Тати).
    with database.engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    command.upgrade(Config(_ALEMBIC_INI), "head")
    yield
    # оставляем схему для отладки


@pytest.fixture()
def db():
    s = database.SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def client():
    return TestClient(app)


def auth_headers(user) -> dict:
    tok = auth.create_access_token(user.id, user.org_id, user.role)
    return {"Authorization": f"Bearer {tok}"}


def reset_all():
    """Очистить все таблицы (для чистого seed на каждый тест)."""
    tables = ", ".join(f'"{t.name}"' for t in database.Base.metadata.sorted_tables)
    with database.engine.begin() as conn:
        conn.exec_driver_sql(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")


# ---- переключатель хука для baseline-проверки (прогон ДО/ПОСЛЕ) ----

def disable_hook():
    if event.contains(_Session, "do_orm_execute", soft_delete._apply_soft_delete_filter):
        event.remove(_Session, "do_orm_execute", soft_delete._apply_soft_delete_filter)


def enable_hook():
    if not event.contains(_Session, "do_orm_execute", soft_delete._apply_soft_delete_filter):
        event.listen(_Session, "do_orm_execute", soft_delete._apply_soft_delete_filter)
