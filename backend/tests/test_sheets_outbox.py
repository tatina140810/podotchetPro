"""Очередь выгрузки в Google-таблицу «Локомотив» (sheets_outbox).

Сеть не трогаем: проверяем постановку в очередь, идемпотентность и чистые функции
разбора листа (поиск строки ИТОГО, расширение диапазона формулы, формат строки).

Zero-diff: при выключенной выгрузке (значение по умолчанию) очередь не наполняется —
поведение приложения ровно прежнее.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

import auth
import database
from conftest import reset_all
from config import get_settings
from models import ExchangeRate, SheetsOutbox
from services.sheets_sync import (
    bump_formula_range,
    build_row_values,
    find_total_row,
)
from tests.seed import seed_all


# ----------------------------- чистые функции -----------------------------

def test_find_total_row():
    rows = [
        ["Дата", "Вид расхода", "Сумма"],
        ["18.09.2026", "Реклама", 25000],
        [],
        ["", "ИТОГО", "=SUM(...)"],
    ]
    assert find_total_row(rows) == 4
    assert find_total_row([["ИТОГО", "чеки учтены", 833418.36]]) == 1
    assert find_total_row([["Дата", "Описание"]]) is None


def test_bump_formula_range_extends_to_new_last_row():
    f = '=SUM(ARRAYFORMULA(IFERROR(VALUE(REGEXREPLACE(C2:C61;"[^0-9,.-]";""));0)))'
    assert bump_formula_range(f, 62) == f.replace("C2:C61", "C2:C62")
    # несколько диапазонов — сдвигаются все
    assert bump_formula_range("=SUM(C2:C39)+SUM(D2:D39)", 40) == "=SUM(C2:C40)+SUM(D2:D40)"
    # формула без диапазона не ломается
    assert bump_formula_range("=123", 40) == "=123"


def test_build_row_values_matches_sheet_format():
    entry = SheetsOutbox(
        org_id=1, entity_type="expense", entity_id=1, sheet="bank",
        op_date=datetime(2026, 9, 18), title="Реклама в телеграм СМБ сервис",
        amount=Decimal("25000.00"), currency="RUB",
    )
    assert build_row_values(entry) == ["18.09.2026", "Реклама в телеграм СМБ сервис", 25000.0]
    entry.sheet = "salary"
    assert build_row_values(entry, person="Артеменко Павел") == [
        "Артеменко Павел", "Реклама в телеграм СМБ сервис", "18.09.2026", 25000.0,
    ]


# ----------------------------- постановка в очередь -----------------------------

def _fresh_seed() -> SimpleNamespace:
    reset_all()
    db = database.SessionLocal()
    try:
        s = seed_all(db)
        # Курс RUB→KGS: без него расход в рублях не создать (сумма не легла бы в баланс).
        db.add(ExchangeRate(org_id=s.org.id, from_currency="RUB", to_currency="KGS",
                            rate=Decimal("1.1")))
        db.commit()
        ids = SimpleNamespace(
            org_id=s.org.id, director=s.director.id, acc1=s.acc1.id,
            depA=s.depA.id, depB=s.depB.id, catNormal=s.catNormal.id,
        )
    finally:
        db.close()
    return ids


def _hdr(ids) -> dict:
    return {"Authorization": f"Bearer {auth.create_access_token(ids.director, ids.org_id, 'superadmin')}"}


def _queue() -> list[SheetsOutbox]:
    db = database.SessionLocal()
    try:
        return db.query(SheetsOutbox).order_by(SheetsOutbox.id).all()
    finally:
        db.close()


@pytest.fixture()
def sync_on(request):
    """Включает выгрузку для подразделения depA (id передаётся параметром теста)."""
    s = get_settings()
    saved = (s.sheets_sync_enabled, s.sheets_spreadsheet_id, s.sheets_department_ids)
    def _enable(dep_id: int):
        s.sheets_sync_enabled = True
        s.sheets_spreadsheet_id = "test-spreadsheet"
        s.sheets_department_ids = str(dep_id)
    yield _enable
    (s.sheets_sync_enabled, s.sheets_spreadsheet_id, s.sheets_department_ids) = saved


def _post_expense(client, ids, **over) -> dict:
    body = {
        "amount": "1000", "currency": "RUB", "category_id": ids.catNormal,
        "department_id": ids.depA, "description": "Оплата воды в офис",
        "payment_method": "bank",
    }
    body.update(over)
    r = client.post("/api/expenses", headers=_hdr(ids), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_expense_queued_to_bank_sheet(client, sync_on):
    ids = _fresh_seed()
    sync_on(ids.depA)
    _post_expense(client, ids)
    q = _queue()
    assert len(q) == 1
    row = q[0]
    assert (row.sheet, row.status, row.entity_type) == ("bank", "pending", "expense")
    assert row.title == "Оплата воды в офис"
    assert Decimal(str(row.amount)) == Decimal("1000.00")


def test_cash_expense_goes_to_cash_sheet(client, sync_on):
    ids = _fresh_seed()
    sync_on(ids.depA)
    _post_expense(client, ids, payment_method="cash")
    assert _queue()[0].sheet == "cash"


def test_other_department_not_queued(client, sync_on):
    """Выгружается только подразделение из настройки — остальные не попадают в таблицу."""
    ids = _fresh_seed()
    sync_on(ids.depA)
    _post_expense(client, ids, department_id=ids.depB)
    assert _queue() == []


def test_without_payment_method_not_queued(client, sync_on):
    ids = _fresh_seed()
    sync_on(ids.depA)
    r = client.post("/api/expenses", headers=_hdr(ids), json={
        "amount": "500", "currency": "RUB", "category_id": ids.catNormal,
        "department_id": ids.depA, "description": "без формы расчёта",
    })
    assert r.status_code == 201, r.text
    assert _queue() == []


def test_foreign_currency_marked_skipped(client, sync_on):
    """Таблица рублёвая: сом в неё не пишем, но и не теряем — запись видна как skipped."""
    ids = _fresh_seed()
    sync_on(ids.depA)
    _post_expense(client, ids, currency="KGS")
    row = _queue()[0]
    assert row.status == "skipped"
    assert "KGS" in (row.last_error or "")


def test_sync_disabled_keeps_queue_empty(client):
    """Zero-diff: выгрузка выключена — очередь пуста, расход создаётся как раньше."""
    ids = _fresh_seed()
    _post_expense(client, ids)
    assert _queue() == []
