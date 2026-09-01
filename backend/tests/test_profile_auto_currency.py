"""Профиль сотрудника: режим валюты «auto».
Если все операции сотрудника в одной валюте (Мос офис → RUB), итоги/остаток
показываются в ней; смешанные валюты или пусто → KGS; явная валюта уважается.
Курс RUB→KGS = 0.9: 10000 RUB = 9000 с.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

import database
from conftest import auth_headers, reset_all
from models import Category, Department, ExchangeRate, Organization, User

D = lambda x: Decimal(str(x))


@pytest.fixture()
def m():
    reset_all()
    db = database.SessionLocal()
    org = Organization(name="Org", plan="legacy"); db.add(org); db.flush()

    def U(name, phone, role="accountable"):
        u = User(org_id=org.id, name=name, phone=phone, password_hash="x", role=role)
        db.add(u); db.flush(); return u

    director = U("Дир", "+70000000201", role="superadmin")
    adik = U("Адик", "+70000000202")
    empty = U("Пустой", "+70000000203")
    dep = Department(org_id=org.id, name="Мос офис"); db.add(dep); db.flush()
    cat = Category(org_id=org.id, name="Cat"); db.add(cat)
    db.add_all([
        ExchangeRate(org_id=org.id, from_currency="USD", to_currency="KGS", rate=D("89")),
        ExchangeRate(org_id=org.id, from_currency="RUB", to_currency="KGS", rate=D("0.9")),
        ExchangeRate(org_id=org.id, from_currency="EUR", to_currency="KGS", rate=D("95")),
    ])
    db.commit()
    yield SimpleNamespace(org=org, director=director, adik=adik, empty=empty, dep=dep, cat=cat)
    db.close()


def _now():
    n = datetime.utcnow()
    return {"month": n.month, "year": n.year}


def profile(client, actor, uid, **params):
    r = client.get(f"/api/employees/{uid}/profile", params={**_now(), **params}, headers=auth_headers(actor))
    assert r.status_code == 200, r.text
    return r.json()


def topup(client, director, to_user, amount, currency):
    r = client.post(f"/api/users/{to_user.id}/topup",
                    json={"amount": str(amount), "currency": currency, "note": "t"},
                    headers=auth_headers(director))
    assert r.status_code in (200, 201), r.text


def expense(client, actor, dep, cat, amount, currency):
    r = client.post("/api/expenses", json={"amount": str(amount), "currency": currency,
                    "department_id": dep.id, "category_id": cat.id},
                    headers=auth_headers(actor))
    assert r.status_code == 201, r.text
    return r.json()


def test_auto_single_currency_rub(client, m):
    topup(client, m.director, m.adik, 10000, "RUB")
    e = expense(client, m.adik, m.dep, m.cat, 3000, "RUB")
    r = client.post(f"/api/expenses/{e['id']}/review", json={"status": "approved", "review_comment": None},
                    headers=auth_headers(m.director))
    assert r.status_code == 200, r.text

    p = profile(client, m.director, m.adik.id)  # default = auto
    assert p["currency"] == "RUB"
    s = p["summary"]
    assert s["received"]["total"] == 10000.0
    assert s["spent"]["total"] == 3000.0
    assert s["balance"] == 7000.0 and s["debt"] == 0.0
    # строки тоже в ₽
    assert p["received"][0]["amount_kgs"] == 10000.0
    assert p["expenses"][0]["amount_kgs"] == 3000.0

    # явная валюта уважается: те же данные в сомах по курсу 0.9
    k = profile(client, m.director, m.adik.id, currency="KGS")
    assert k["currency"] == "KGS"
    assert k["summary"]["received"]["total"] == 9000.0
    assert k["summary"]["spent"]["total"] == 2700.0
    assert k["summary"]["balance"] == 6300.0

    # экспорт в auto тоже работает
    x = client.get(f"/api/employees/{m.adik.id}/profile/export", params=_now(), headers=auth_headers(m.director))
    assert x.status_code == 200, x.text


def test_auto_mixed_currencies_falls_back_to_kgs(client, m):
    topup(client, m.director, m.adik, 10000, "RUB")
    expense(client, m.adik, m.dep, m.cat, 10, "USD")
    p = profile(client, m.director, m.adik.id)
    assert p["currency"] == "KGS"
    assert p["summary"]["received"]["total"] == 9000.0
    assert p["summary"]["spent"]["total"] == 890.0


def test_auto_no_operations_is_kgs(client, m):
    p = profile(client, m.director, m.empty.id)
    assert p["currency"] == "KGS"
    assert p["summary"]["balance"] == 0.0


def test_invalid_currency_rejected(client, m):
    r = client.get(f"/api/employees/{m.adik.id}/profile", params={**_now(), "currency": "GBP"},
                   headers=auth_headers(m.director))
    assert r.status_code == 422


# ---------- валюта подразделения (Department.currency) ----------

def set_dept_currency(client, director, dep_id, currency):
    r = client.patch(f"/api/departments/{dep_id}", json={"currency": currency}, headers=auth_headers(director))
    assert r.status_code == 200, r.text
    return r.json()


def attach(m, user, dep):
    from models import EmployeeDepartment
    db = database.SessionLocal()
    db.add(EmployeeDepartment(employee_id=user.id, department_id=dep.id)); db.commit(); db.close()


def test_department_currency_wins_over_mixed_history(client, m):
    """Мос офис = RUB: даже при смешанной истории (KGS+RUB) профиль в ₽."""
    attach(m, m.adik, m.dep)
    out = set_dept_currency(client, m.director, m.dep.id, "RUB")
    assert out["currency"] == "RUB"
    topup(client, m.director, m.adik, 10000, "RUB")
    expense(client, m.adik, m.dep, m.cat, 900, "KGS")  # 900 с = 1000 ₽ по курсу 0.9
    p = profile(client, m.director, m.adik.id)
    assert p["currency"] == "RUB"
    assert p["summary"]["received"]["total"] == 10000.0
    assert p["summary"]["spent"]["total"] == 1000.0
    assert p["expenses"][0]["currency"] == "KGS"  # исходная валюта строки сохранена

    # снять валюту → эвристика → смешанная история → KGS
    assert set_dept_currency(client, m.director, m.dep.id, None)["currency"] is None
    assert profile(client, m.director, m.adik.id)["currency"] == "KGS"


def test_department_currency_validation_and_rights(client, m):
    r = client.patch(f"/api/departments/{m.dep.id}", json={"currency": "GBP"}, headers=auth_headers(m.director))
    assert r.status_code == 422
    r = client.patch(f"/api/departments/{m.dep.id}", json={"currency": "RUB"}, headers=auth_headers(m.adik))
    assert r.status_code == 403  # подотчётный не управляет подразделениями
    r = client.post("/api/departments", json={"name": "Питер", "currency": "RUB"}, headers=auth_headers(m.director))
    assert r.status_code == 201 and r.json()["currency"] == "RUB"
    # CHECK в БД: обход API с невалидной валютой отклоняется Postgres'ом
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    db = database.SessionLocal()
    with pytest.raises(IntegrityError):
        db.execute(text("update departments set currency='XXX' where id=:i"), {"i": m.dep.id}); db.commit()
    db.rollback(); db.close()
