"""Перевод расхода в выдачу (POST /api/expenses/{id}/convert-to-topup), Тати 2026-10-28.

Проверяем деньги, а не только коды ответа: баланс получателя и выдающего до и после,
что расход ушёл в мягкое удаление со снимком в журнале, и что из одного расхода нельзя
получить две выдачи.
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

import database
from conftest import auth_headers, reset_all
from models import (
    BalanceTopUp, Category, Department, ExchangeRate, Expense, Organization,
    RecordChangeLog, SheetsOutbox, User,
)

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
    auditor = U("Аудитор", "+70000000202", role="auditor")
    acc = U("Адик", "+70000000203")
    other = U("Другой", "+70000000204")
    dep = Department(org_id=org.id, name="Мос офис"); db.add(dep); db.flush()
    other.supervisor_id = acc.id
    cat = Category(org_id=org.id, name="Обеды"); db.add(cat)
    sys_cat = Category(org_id=org.id, name="Подотчёт", is_system=True); db.add(sys_cat)
    db.add(ExchangeRate(org_id=org.id, from_currency="USD", to_currency="KGS", rate=D("89")))
    db.commit()
    yield SimpleNamespace(org=org, director=director, auditor=auditor, acc=acc, other=other,
                          dep=dep, cat=cat, sys_cat=sys_cat)
    db.close()


def mk_income(client, actor, receiver, amount):
    r = client.post("/api/income", json={"amount": str(amount), "currency": "KGS", "source": "src",
                    "received_by_id": receiver.id}, headers=auth_headers(actor))
    assert r.status_code == 201, r.text


def mk_expense(client, actor, dep, amount, cat=None, to_user=None, description="Обеды на неделю"):
    body = {"amount": str(amount), "currency": "KGS", "department_id": dep.id,
            "description": description, "payment_method": "cash",
            "spent_at": "2026-10-26T10:00:00"}
    if cat is not None:
        body["category_id"] = cat.id
    if to_user is not None:
        body["to_user_id"] = to_user.id
    r = client.post("/api/expenses", json=body, headers=auth_headers(actor))
    assert r.status_code == 201, r.text
    return r.json()


def bal(client, actor, uid):
    r = client.get(f"/api/users/{uid}/balance", headers=auth_headers(actor))
    assert r.status_code == 200, r.text
    return D(r.json()["current_balance"])


def convert(client, actor, eid, **body):
    return client.post(f"/api/expenses/{eid}/convert-to-topup", json=body, headers=auth_headers(actor))


def test_convert_moves_money_and_keeps_history(client, m):
    mk_income(client, m.director, m.acc, 5000)
    mk_income(client, m.director, m.director, 10000)
    e = mk_expense(client, m.acc, m.dep, 1000, cat=m.sys_cat)
    assert bal(client, m.director, m.acc.id) == D(4000)
    dir_before = bal(client, m.director, m.director.id)

    r = convert(client, m.director, e["id"], issued_by_id=m.director.id)
    assert r.status_code == 200, r.text
    tid = r.json()["topup_id"]

    # Расход больше не списывает (+1000), выдача добавляет получателю (+1000).
    assert bal(client, m.director, m.acc.id) == D(6000)
    # Выдавший отдал 1000.
    assert bal(client, m.director, m.director.id) == dir_before - D(1000)

    db = database.SessionLocal()
    t = db.get(BalanceTopUp, tid)
    assert (t.admin_id, t.user_id, D(t.amount), t.currency) == (m.director.id, m.acc.id, D(1000), "KGS")
    assert t.note == "Обеды на неделю" and t.payment_method == "cash" and t.department_id == m.dep.id
    assert t.date == datetime(2026, 10, 26, 10, 0)
    assert t.category_id == m.sys_cat.id  # системная «Подотчёт» переносится
    # Расход не стёрт физически: помечен удалённым, снимок и ссылка на выдачу — в журнале.
    ex = db.query(Expense).execution_options(include_deleted=True).filter(Expense.id == e["id"]).one()
    assert ex.deleted_at is not None and ex.deleted_by == m.director.id
    actions = {r.action: r.diff for r in db.query(RecordChangeLog).filter(
        RecordChangeLog.entity_type == "expense", RecordChangeLog.entity_id == e["id"])}
    assert actions["delete"]["amount"] is not None
    assert actions["convert"] == {"converted_to_topup_id": tid}
    # Авто-расхода у выдачи нет — иначе расход вернулся бы.
    assert db.query(Expense).filter(Expense.source_topup_id == tid).count() == 0
    db.close()


def test_second_convert_is_404(client, m):
    e = mk_expense(client, m.acc, m.dep, 500)
    assert convert(client, m.director, e["id"], issued_by_id=m.director.id).status_code == 200
    assert convert(client, m.director, e["id"], issued_by_id=m.director.id).status_code == 404
    db = database.SessionLocal()
    assert db.query(BalanceTopUp).count() == 0 + 1  # только одна выдача
    db.close()


def test_real_category_not_carried(client, m):
    e = mk_expense(client, m.acc, m.dep, 700, cat=m.cat)
    tid = convert(client, m.director, e["id"], issued_by_id=m.director.id).json()["topup_id"]
    db = database.SessionLocal()
    assert db.get(BalanceTopUp, tid).category_id is None
    assert db.query(Expense).filter(Expense.source_topup_id == tid).count() == 0
    db.close()


def test_overrides_and_rate(client, m):
    e = mk_expense(client, m.acc, m.dep, 100)
    r = convert(client, m.director, e["id"], issued_by_id=m.other.id, user_id=m.acc.id,
                amount="10", currency="USD", note="Новая подпись", payment_method="bank")
    assert r.status_code == 200, r.text
    db = database.SessionLocal()
    t = db.get(BalanceTopUp, r.json()["topup_id"])
    assert (t.admin_id, t.currency, D(t.amount), D(t.amount_kgs)) == (m.other.id, "USD", D(10), D(890))
    assert t.note == "Новая подпись" and t.payment_method == "bank"
    db.close()


def test_refusals(client, m):
    e = mk_expense(client, m.acc, m.dep, 300)
    # Подотчётный не может.
    assert convert(client, m.acc, e["id"], issued_by_id=m.director.id).status_code == 403
    # Выдающий = получатель.
    assert convert(client, m.director, e["id"], issued_by_id=m.acc.id).status_code == 400
    # Передача другому сотруднику не переводится.
    mk_income(client, m.director, m.acc, 1000)
    tr = mk_expense(client, m.acc, m.dep, 200, to_user=m.other)
    r = convert(client, m.director, tr["id"], issued_by_id=m.director.id)
    assert r.status_code == 400 and "передача" in r.json()["detail"].lower()
    # Аудитор может (как и создавать выдачи).
    assert convert(client, m.auditor, e["id"], issued_by_id=m.director.id).status_code == 200


def test_sheets_queue(client, m):
    e1 = mk_expense(client, m.acc, m.dep, 100)
    e2 = mk_expense(client, m.acc, m.dep, 200)
    db = database.SessionLocal()
    for eid, st in ((e1["id"], "pending"), (e2["id"], "sent")):
        db.add(SheetsOutbox(org_id=m.org.id, entity_type="expense", entity_id=eid, sheet="cash",
                            op_date=datetime(2026, 10, 26), title="x", amount=D(1), currency="RUB", status=st))
    db.commit()
    r1 = convert(client, m.director, e1["id"], issued_by_id=m.director.id)
    r2 = convert(client, m.director, e2["id"], issued_by_id=m.director.id)
    assert r1.json()["sheets_note"] is None
    assert "вручную" in r2.json()["sheets_note"]
    db.expire_all()
    q1 = db.query(SheetsOutbox).filter(SheetsOutbox.entity_id == e1["id"], SheetsOutbox.entity_type == "expense").one()
    assert q1.status == "skipped"
    db.close()
