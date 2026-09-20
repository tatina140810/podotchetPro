"""receipts_count в истории движения денег (используется отчётом по сотрудникам).

- расход без чеков → 0, с двумя → 2, со старым legacy receipt_url → 1;
- одобренная заявка: 0 без документов, N с документами (и у заявителя, и у адресата);
- выдача/приход/перевод → None (чеки к ним не крепятся — в UI прочерк).
"""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from conftest import reset_all
from models import (
    BalanceTopUp,
    Expense,
    ExpenseReceipt,
    MoneyRequest,
    MoneyRequestReceipt,
    Organization,
    User,
)
from routers.users import build_user_history_entries


@pytest.fixture()
def data(db):
    reset_all()
    org = Organization(name="ORG", plan="legacy")
    db.add(org)
    db.flush()

    def user(name, phone, role="accountable"):
        u = User(org_id=org.id, name=name, phone=phone, password_hash="x", role=role)
        db.add(u)
        db.flush()
        return u

    emp = user("Индира", "+7201")
    boss = user("Ice", "+7202", role="superadmin")

    def expense(desc, amount, receipt_url=None):
        e = Expense(
            org_id=org.id, employee_id=emp.id, amount=Decimal(str(amount)),
            currency="KGS", amount_kgs=Decimal(str(amount)), description=desc,
            status="approved", spent_at=datetime(2026, 9, 10, 12, 0),
            receipt_url=receipt_url,
        )
        db.add(e)
        db.flush()
        return e

    e_none = expense("без чеков", 100)
    e_two = expense("с чеками", 200)
    e_legacy = expense("старый чек", 300, receipt_url="/uploads/1/old.jpg")
    for i in range(2):
        db.add(ExpenseReceipt(org_id=org.id, expense_id=e_two.id,
                              file_url=f"/uploads/1/{i}.jpg", uploaded_by_id=emp.id))

    def request(title, amount):
        r = MoneyRequest(
            org_id=org.id, requester_id=emp.id, approver_id=boss.id, status="approved",
            title=title, total_amount=Decimal(str(amount)), currency="KGS",
            approved_at=datetime(2026, 9, 12, 12, 0),
        )
        db.add(r)
        db.flush()
        return r

    r_empty = request("Хозы без док", 250)
    r_docs = request("Хозы с док", 400)
    for i in range(3):
        db.add(MoneyRequestReceipt(org_id=org.id, request_id=r_docs.id,
                                   file_url=f"/uploads/1/r{i}.jpg", uploaded_by_id=emp.id))

    db.add(BalanceTopUp(org_id=org.id, user_id=emp.id, admin_id=boss.id,
                        amount=Decimal("1000"), currency="KGS", date=datetime(2026, 9, 1, 9, 0)))
    db.commit()
    return SimpleNamespace(org=org, emp=emp, boss=boss)


def _by_note(entries):
    return {e.note: e for e in entries}


def test_expense_receipts_count(db, data):
    ent = _by_note(build_user_history_entries(db, data.org.id, data.emp.id))
    assert ent["без чеков"].receipts_count == 0
    assert ent["с чеками"].receipts_count == 2
    assert ent["старый чек"].receipts_count == 1  # legacy receipt_url считается


def test_request_receipts_count_both_sides(db, data):
    mine = _by_note(build_user_history_entries(db, data.org.id, data.emp.id))
    assert mine["Хозы без док"].receipts_count == 0
    assert mine["Хозы с док"].receipts_count == 3

    theirs = _by_note(build_user_history_entries(db, data.org.id, data.boss.id))
    assert theirs["Хозы с док"].kind == "request_approved_out"
    assert theirs["Хозы с док"].receipts_count == 3


def test_topup_has_no_receipts_marker(db, data):
    topups = [e for e in build_user_history_entries(db, data.org.id, data.emp.id) if e.kind == "topup"]
    assert len(topups) == 1
    assert topups[0].receipts_count is None


def test_profile_requests_have_receipts_count(client, data, db):
    """Карточка сотрудника: у одобренной заявки — число документов,
    у неодобренной — None (в UI прочерк, т.к. чеки к ней не крепятся)."""
    from conftest import auth_headers
    from models import MoneyRequest, MoneyRequestReceipt

    pending = MoneyRequest(
        org_id=data.org.id, requester_id=data.emp.id, approver_id=data.boss.id,
        status="pending", title="Ещё не одобрена", total_amount=Decimal("50"),
        currency="KGS", created_at=datetime(2026, 9, 14, 10, 0),
    )
    db.add(pending)
    db.commit()

    r = client.get(
        f"/api/employees/{data.emp.id}/profile?year=2026&month=9",
        headers=auth_headers(data.boss),
    )
    assert r.status_code == 200, r.text
    by_title = {x["comment"]: x for x in r.json()["requests_own"]}
    assert by_title["Хозы с док"]["receipts_count"] == 3
    assert by_title["Хозы без док"]["receipts_count"] == 0
    assert by_title["Ещё не одобрена"]["receipts_count"] is None
