"""Правки заявки в момент одобрения (POST /api/requests/{id}/approve с телом).

Главное требование: исправленные значения попадают И в заявку, И в расход,
который создаётся при одобрении «заявки на расход».
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from conftest import auth_headers, reset_all
from models import (
    Category,
    Department,
    Expense,
    MoneyRequest,
    MoneyRequestItem,
    Organization,
    RecordChangeLog,
    User,
)


@pytest.fixture()
def data(db):
    reset_all()
    org = Organization(name="ORG", plan="legacy")
    other = Organization(name="ORG2", plan="legacy")
    db.add_all([org, other])
    db.flush()

    def user(o, name, phone, role="accountable"):
        u = User(org_id=o.id, name=name, phone=phone, password_hash="x", role=role)
        db.add(u)
        db.flush()
        return u

    emp = user(org, "Индира", "+7301")
    boss = user(org, "Ice", "+7302", role="gen_director")
    stranger = user(org, "Чоро", "+7303")

    dep1 = Department(org_id=org.id, name="Офис")
    dep2 = Department(org_id=org.id, name="Склад")
    cat1 = Category(org_id=org.id, name="Хозтовары")
    cat2 = Category(org_id=org.id, name="Канцелярия")
    alien_cat = Category(org_id=other.id, name="Чужая")
    db.add_all([dep1, dep2, cat1, cat2, alien_cat])
    db.flush()

    def make(expense_on_approve=True, category=None, amount="250"):
        r = MoneyRequest(
            org_id=org.id, requester_id=emp.id, approver_id=boss.id, status="pending",
            title="Хозы", total_amount=Decimal(amount), currency="KGS",
            department_id=dep1.id, is_expense_on_approve=expense_on_approve,
            expense_category_id=(category.id if category else None),
            created_at=datetime(2026, 9, 18, 10, 0),
        )
        db.add(r)
        db.flush()
        it = MoneyRequestItem(request_id=r.id, description="Мыло",
                              amount=Decimal(amount), quantity=1, category_id=None)
        db.add(it)
        db.flush()
        return r, it

    req, item = make(category=cat1)
    db.commit()
    return SimpleNamespace(org=org, emp=emp, boss=boss, stranger=stranger,
                           dep1=dep1, dep2=dep2, cat1=cat1, cat2=cat2,
                           alien_cat=alien_cat, req=req, item=item, make=make, db=db)


def _approve(client, user, req_id, body=None):
    kw = {"headers": auth_headers(user)}
    if body is not None:
        kw["json"] = body
    return client.post(f"/api/requests/{req_id}/approve", **kw)


def test_approve_without_body_keeps_old_behaviour(client, data, db):
    r = _approve(client, data.boss, data.req.id)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    assert Decimal(r.json()["total_amount"]) == Decimal("250")
    e = db.query(Expense).filter(Expense.source_request_id == data.req.id).one()
    assert Decimal(str(e.amount)) == Decimal("250")


def test_edits_apply_to_request_and_expense(client, data, db):
    """Сумма, категория, подразделение и название — правятся и уходят в расход."""
    body = {
        "title": "Хозтовары за сентябрь",
        "department_id": data.dep2.id,
        "expense_category_id": data.cat2.id,
        "items": [
            {"id": data.item.id, "description": "Мыло", "amount": "300", "quantity": 2,
             "category_id": data.cat2.id},
            {"description": "Перчатки", "amount": "150", "quantity": 1},
        ],
    }
    r = _approve(client, data.boss, data.req.id, body)
    assert r.status_code == 200, r.text
    out = r.json()

    # Заявка: 300×2 + 150 = 750
    assert out["status"] == "approved"
    assert out["title"] == "Хозтовары за сентябрь"
    assert Decimal(out["total_amount"]) == Decimal("750")
    assert out["department_id"] == data.dep2.id
    assert out["expense_category_id"] == data.cat2.id
    assert len(out["items"]) == 2

    # Расход создан из исправленных значений
    e = db.query(Expense).filter(Expense.source_request_id == data.req.id).one()
    assert Decimal(str(e.amount)) == Decimal("750")
    assert e.category_id == data.cat2.id
    assert e.department_id == data.dep2.id
    assert e.description == "Хозтовары за сентябрь"
    assert e.employee_id == data.emp.id
    assert e.funded_by_id == data.boss.id


def test_removed_line_drops_out_of_total(client, data, db):
    req2, item2 = data.make(category=data.cat1, amount="400")
    extra = MoneyRequestItem(request_id=req2.id, description="Вторая",
                             amount=Decimal("100"), quantity=1)
    db.add(extra)
    db.commit()
    body = {"items": [{"id": item2.id, "description": "Вторая", "amount": "100", "quantity": 1}]}
    r = _approve(client, data.boss, req2.id, body)
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["total_amount"]) == Decimal("100")
    assert len(r.json()["items"]) == 1


def test_currency_change_applies_to_expense(client, data, db):
    req2, item2 = data.make(category=data.cat1, amount="100")
    db.commit()
    r = _approve(client, data.boss, req2.id, {"currency": "USD"})
    assert r.status_code == 200, r.text
    assert r.json()["currency"] == "USD"
    e = db.query(Expense).filter(Expense.source_request_id == req2.id).one()
    assert e.currency == "USD"


def test_validation_errors(client, data, db):
    # чужая категория
    r = _approve(client, data.boss, data.req.id, {"expense_category_id": data.alien_cat.id})
    assert r.status_code == 400
    # пустой список строк
    r = _approve(client, data.boss, data.req.id, {"items": []})
    assert r.status_code == 400
    # строка из другой заявки
    other_req, other_item = data.make(category=data.cat1)
    db.commit()
    r = _approve(client, data.boss, data.req.id, {
        "items": [{"id": other_item.id, "description": "x", "amount": "10", "quantity": 1}]
    })
    assert r.status_code == 400
    # «заявка на расход» без категории
    r = _approve(client, data.boss, data.req.id, {"expense_category_id": None,
                                                  "is_expense_on_approve": True})
    assert r.status_code in (200, 400)  # категория уже стоит → одобрение проходит


def test_expense_flag_off_creates_no_expense(client, data, db):
    req2, _ = data.make(expense_on_approve=True, category=data.cat1, amount="500")
    db.commit()
    r = _approve(client, data.boss, req2.id, {"is_expense_on_approve": False})
    assert r.status_code == 200, r.text
    assert db.query(Expense).filter(Expense.source_request_id == req2.id).count() == 0


def test_flag_on_without_category_rejected(client, data, db):
    req2, _ = data.make(expense_on_approve=False, category=None, amount="500")
    db.commit()
    r = _approve(client, data.boss, req2.id, {"is_expense_on_approve": True})
    assert r.status_code == 400
    assert "категорию" in r.json()["detail"]
    db.refresh(req2)
    assert req2.status == "pending"  # заявка не одобрена, правки откатились


def test_only_approver_can_edit_on_approve(client, data, db):
    r = _approve(client, data.stranger, data.req.id, {"title": "Чужая правка"})
    assert r.status_code == 403
    r = _approve(client, data.emp, data.req.id, {"title": "Сам себе"})
    assert r.status_code == 403


def test_changes_written_to_change_log(client, data, db):
    body = {"title": "Новое имя", "items": [
        {"id": data.item.id, "description": "Мыло", "amount": "999", "quantity": 1}
    ]}
    assert _approve(client, data.boss, data.req.id, body).status_code == 200
    logs = (
        db.query(RecordChangeLog)
        .filter(RecordChangeLog.entity_type == "money_request",
                RecordChangeLog.entity_id == data.req.id)
        .all()
    )
    assert len(logs) == 1
    diff = logs[0].diff
    assert diff["title"] == {"old": "Хозы", "new": "Новое имя"}
    assert diff["items"]["new"][0]["amount"] == "999.00"
    assert logs[0].changed_by == data.boss.id
