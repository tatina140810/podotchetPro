"""Отчёты в рублях (тумблер с / $ / ₽).

Раньше конвертация была только KGS→USD (_maybe_convert_usd), поэтому при выборе ₽
отчёт молча оставался в сомах. Проверяем, что любая валюта из тумблера считается
через свой курс, а при отсутствии курса цифры остаются в сомах (не исчезают).
"""
from decimal import Decimal
from types import SimpleNamespace

import auth
import database
from conftest import reset_all
from models import ExchangeRate
from tests.seed import seed_all

RUB_RATE = Decimal("1.1")


def _fresh_seed(with_rub_rate: bool = True) -> SimpleNamespace:
    reset_all()
    db = database.SessionLocal()
    try:
        s = seed_all(db)
        if with_rub_rate:
            db.add(ExchangeRate(org_id=s.org.id, from_currency="RUB", to_currency="KGS",
                                rate=RUB_RATE))
            db.commit()
        ids = SimpleNamespace(org_id=s.org.id, director=s.director.id)
    finally:
        db.close()
    return ids


def _hdr(ids) -> dict:
    return {"Authorization": f"Bearer {auth.create_access_token(ids.director, ids.org_id, 'superadmin')}"}


def _categories(client, ids, currency: str) -> dict:
    r = client.get(f"/api/reports/categories?year=2026&month=8&currency={currency}", headers=_hdr(ids))
    assert r.status_code == 200, r.text
    return r.json()


def test_categories_report_converts_to_rub(client):
    ids = _fresh_seed()
    kgs = _categories(client, ids, "KGS")
    rub = _categories(client, ids, "RUB")
    assert kgs["currency"] == "KGS" and rub["currency"] == "RUB"
    assert kgs["total_expenses"] > 0
    expected = round(kgs["total_expenses"] / float(RUB_RATE), 2)
    assert abs(rub["total_expenses"] - expected) < 0.02
    assert rub["rate"] == float(RUB_RATE)


def test_conversion_without_rate_falls_back_to_kgs():
    """Курса нет → сумма остаётся в сомах (цифры не должны пропадать).

    Через HTTP это не проверить: load_org_rates при отсутствии курса сам тянет его
    из НБКР и сохраняет, поэтому fallback проверяем на самой функции конвертации."""
    from routers.reports import _to_display

    assert _to_display(1000.0, "RUB", None) == 1000.0
    assert _to_display(1000.0, "RUB", Decimal("0")) == 1000.0
    assert _to_display(1000.0, "RUB", RUB_RATE) == round(1000 / float(RUB_RATE), 2)
    assert _to_display(1000.0, "KGS", RUB_RATE) == 1000.0


def test_balance_report_converts_to_rub(client):
    ids = _fresh_seed()
    hdr = _hdr(ids)
    kgs = client.get("/api/reports/balance?from=2026-08-01&to=2026-08-31&currency=KGS", headers=hdr).json()
    rub = client.get("/api/reports/balance?from=2026-08-01&to=2026-08-31&currency=RUB", headers=hdr).json()
    assert rub["currency"] == "RUB"
    assert abs(rub["closing_balance"] - round(kgs["closing_balance"] / float(RUB_RATE), 2)) < 0.02


def test_employees_report_converts_to_rub(client):
    ids = _fresh_seed()
    hdr = _hdr(ids)
    kgs = client.get("/api/reports/employees?year=2026&month=8&currency=KGS", headers=hdr).json()
    rub = client.get("/api/reports/employees?year=2026&month=8&currency=RUB", headers=hdr).json()
    assert rub["currency"] == "RUB"
    k_total = sum(r["spent"] for r in kgs["rows"])
    r_total = sum(r["spent"] for r in rub["rows"])
    assert k_total > 0 and abs(r_total - round(k_total / float(RUB_RATE), 2)) < 0.5
