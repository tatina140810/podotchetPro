"""Упрощённые заявки, шаг 1: подача → одобрение с разноской → «Выдал».

Главное — деньги:
- подача и одобрение деньги НЕ двигают (балансы обоих прежние);
- «Выдал» = ровно одна выдача: у принимающего минус, у заявителя плюс;
- повторное «Выдал» не удваивает деньги (409);
- старое «одобрить» к упрощённой заявке не применимо (иначе статус approved
  подвинул бы деньги второй раз через _approved_requests_in/out).
Плюс права: одобряет и выдаёт только принимающий.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

from conftest import auth_headers, reset_all
from models import BalanceTopUp, Category, Department, MoneyRequest, Organization, User
from services.balance import compute_current_balance


@pytest.fixture()
def data(db):
    reset_all()
    org = Organization(name="Исаадат", plan="legacy")
    db.add(org)
    db.flush()

    def user(name, phone, role="accountable"):
        u = User(org_id=org.id, name=name, phone=phone, password_hash="x", role=role)
        db.add(u)
        db.flush()
        return u

    choro = user("Чоро", "+7201")
    indira = user("Индира", "+7202", role="admin")
    ice = user("Ice", "+7203", role="admin")
    org.request_handler_id = indira.id
    org.request_reviewer_id = ice.id
    cat = Category(org_id=org.id, name="Хозтовары")
    dep = Department(org_id=org.id, name="Локомотив")
    db.add_all([cat, dep])
    db.commit()
    return SimpleNamespace(org=org, choro=choro, indira=indira, ice=ice, cat=cat, dep=dep)


def _bal(db, org_id, uid):
    db.expire_all()
    return compute_current_balance(db, org_id, uid)


def _submit(client, who, amount="150", qty=2):
    return client.post("/api/requests/simple", headers=auth_headers(who), json={
        "currency": "KGS",
        "items": [{"description": "Бумага А4", "customer": "Офис 8 этаж", "quantity": qty,
                   "amount": amount, "comment": "срочно"}],
    })


def _accept(client, who, rid, d, amount="300"):
    return client.post(f"/api/requests/{rid}/accept", headers=auth_headers(who), json={
        "category_id": d.cat.id, "department_id": d.dep.id, "payment_method": "cash",
        "amount": amount, "currency": "KGS", "spent_date": date.today().isoformat(), "comment": "ок",
    })


def test_config_simple_for_everyone_but_handler(client, data):
    r = client.get("/api/requests/config", headers=auth_headers(data.choro)).json()
    assert (r["handler_id"], r["handler_name"], r["simple_form"], r["is_reviewer"]) == (data.indira.id, "Индира", True, False)
    assert client.get("/api/requests/config", headers=auth_headers(data.ice)).json()["is_reviewer"] is True
    assert client.get("/api/requests/config", headers=auth_headers(data.ice)).json()["simple_form"] is True
    assert client.get("/api/requests/config", headers=auth_headers(data.indira)).json()["simple_form"] is False


def test_full_path_moves_money_only_on_issue(client, db, data):
    b_choro, b_ind = _bal(db, data.org.id, data.choro.id), _bal(db, data.org.id, data.indira.id)

    r = _submit(client, data.choro)
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["approver_id"] == data.indira.id and req["status"] == "pending" and req["flow"] == "simple"
    assert Decimal(req["total_amount"]) == Decimal("300")
    assert req["items"][0]["customer"] == "Офис 8 этаж"
    assert (_bal(db, data.org.id, data.choro.id), _bal(db, data.org.id, data.indira.id)) == (b_choro, b_ind)

    r = _accept(client, data.indira, req["id"], data, amount="280")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted" and r.json()["handler_category_name"] == "Хозтовары"
    # Одобрение денег не двигает.
    assert (_bal(db, data.org.id, data.choro.id), _bal(db, data.org.id, data.indira.id)) == (b_choro, b_ind)

    r = client.post(f"/api/requests/{req['id']}/issue", headers=auth_headers(data.indira))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "issued" and r.json()["issue_topup_id"]
    assert _bal(db, data.org.id, data.choro.id) == b_choro + Decimal("280")
    assert _bal(db, data.org.id, data.indira.id) == b_ind - Decimal("280")

    # Повторное «Выдал» — отказ, денег не прибавилось.
    r = client.post(f"/api/requests/{req['id']}/issue", headers=auth_headers(data.indira))
    assert r.status_code == 409
    assert _bal(db, data.org.id, data.choro.id) == b_choro + Decimal("280")
    assert db.query(BalanceTopUp).filter(BalanceTopUp.user_id == data.choro.id).count() == 1
    # Выданную заявку удалить нельзя.
    assert client.delete(f"/api/requests/{req['id']}", headers=auth_headers(data.ice)).status_code == 400


def test_only_handler_accepts_and_issues(client, data):
    rid = _submit(client, data.choro).json()["id"]
    assert _accept(client, data.ice, rid, data).status_code == 403
    assert _accept(client, data.choro, rid, data).status_code == 403
    assert client.post(f"/api/requests/{rid}/issue", headers=auth_headers(data.indira)).status_code == 400  # ещё не одобрена
    assert _accept(client, data.indira, rid, data).status_code == 200
    assert client.post(f"/api/requests/{rid}/issue", headers=auth_headers(data.ice)).status_code == 403


def test_old_approve_blocked_for_simple(client, db, data):
    rid = _submit(client, data.choro).json()["id"]
    r = client.post(f"/api/requests/{rid}/approve", headers=auth_headers(data.indira))
    assert r.status_code == 400
    db.expire_all()
    assert db.get(MoneyRequest, rid).status == "pending"


def test_handler_cannot_use_simple_form(client, data):
    assert _submit(client, data.indira).status_code == 400


def test_reject_simple_request(client, data):
    rid = _submit(client, data.choro).json()["id"]
    r = client.post(f"/api/requests/{rid}/reject", headers=auth_headers(data.indira), json={"comment": "не нужно"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"


# ===================== Шаг 2: чек и закрытие расходом =====================
from models import Expense  # noqa: E402


def _issued(client, d, amount="280"):
    rid = _submit(client, d.choro).json()["id"]
    assert _accept(client, d.indira, rid, d, amount=amount).status_code == 200
    assert client.post(f"/api/requests/{rid}/issue", headers=auth_headers(d.indira)).status_code == 200
    return rid


def _close(client, who, rid, **body):
    return client.post(f"/api/requests/{rid}/close", headers=auth_headers(who), json=body)


def test_close_needs_receipt_or_no_receipt_comment(client, data):
    rid = _issued(client, data)
    assert _close(client, data.indira, rid).status_code == 400                      # нет чека
    assert _close(client, data.indira, rid, no_receipt=True).status_code == 400     # без комментария
    assert _close(client, data.indira, rid, no_receipt=True, no_receipt_comment="ок").status_code == 400  # коротко
    r = _close(client, data.indira, rid, no_receipt=True, no_receipt_comment="таксист без чека")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed" and r.json()["no_receipt"] is True


def test_close_with_receipt_moves_expense_to_employee(client, db, data):
    b_choro, b_ind = _bal(db, data.org.id, data.choro.id), _bal(db, data.org.id, data.indira.id)
    rid = _issued(client, data)
    # Чек прикладывает сам сотрудник — после выдачи это разрешено.
    r = client.post(f"/api/requests/{rid}/receipts", headers=auth_headers(data.choro),
                    json={"file_url": "/uploads/1/chek.jpg", "file_name": "чек.jpg"})
    assert r.status_code == 201, r.text
    assert _close(client, data.choro, rid).status_code == 403   # проводит только принимающий
    r = _close(client, data.indira, rid)
    assert r.status_code == 200, r.text
    exp = db.get(Expense, r.json()["expense_id"])
    assert exp.employee_id == data.choro.id and exp.recorded_by_id == data.indira.id
    assert exp.status == "pending" and exp.category_id == data.cat.id and exp.payment_method == "cash"
    assert Decimal(str(exp.amount)) == Decimal("280")
    # Сотрудник потратил всё выданное — у него снова прежний остаток; у Индиры — минус выдачи.
    assert _bal(db, data.org.id, data.choro.id) == b_choro
    assert _bal(db, data.org.id, data.indira.id) == b_ind - Decimal("280")
    # Повтор — отказ, второго расхода нет.
    assert _close(client, data.indira, rid).status_code == 409
    assert db.query(Expense).filter(Expense.source_request_id == rid).count() == 1
    # Проведённый за него расход сотрудник удалить не может.
    assert client.delete(f"/api/expenses/{exp.id}", headers=auth_headers(data.choro)).status_code == 403


def test_close_partial_amount_leaves_rest_on_balance(client, db, data):
    b_choro = _bal(db, data.org.id, data.choro.id)
    rid = _issued(client, data)
    assert _close(client, data.indira, rid, amount="300.00", no_receipt=True,
                  no_receipt_comment="без чека").status_code == 400   # больше выданного
    assert _close(client, data.indira, rid, amount="200.00", no_receipt=True,
                  no_receipt_comment="без чека").status_code == 200
    assert _bal(db, data.org.id, data.choro.id) == b_choro + Decimal("80")



# ===================== Шаг 3: отчёт Индиры у Ice =====================

def _closed(client, d, amount="280"):
    rid = _issued(client, d, amount=amount)
    r = _close(client, d.indira, rid, no_receipt=True, no_receipt_comment="без чека")
    assert r.status_code == 200, r.text
    return rid, r.json()["expense_id"]


def test_only_reviewer_sees_and_approves(client, db, data):
    rid, eid = _closed(client, data)
    assert client.get("/api/requests/handler-report", headers=auth_headers(data.indira)).status_code == 403
    rows = client.get("/api/requests/handler-report", headers=auth_headers(data.ice)).json()
    assert [r["expense_id"] for r in rows] == [eid] and rows[0]["requester_name"] == "Чоро"
    # Индира не может одобрить свой отчёт и через общую проверку расходов.
    r = client.post(f"/api/expenses/{eid}/review", headers=auth_headers(data.indira), json={"status": "approved"})
    assert r.status_code == 403
    r = client.post("/api/requests/handler-report/approve", headers=auth_headers(data.ice), json={"expense_ids": [eid, eid]})
    assert r.status_code == 200 and len(r.json()) == 1
    db.expire_all()
    assert db.get(Expense, eid).status == "approved" and db.get(Expense, eid).reviewed_by_id == data.ice.id
    # Одобренную строку править нельзя.
    assert client.patch(f"/api/requests/handler-report/{eid}", headers=auth_headers(data.ice),
                        json={"amount": "100"}).status_code == 400


def test_reviewer_edits_amount(client, db, data):
    b_choro = _bal(db, data.org.id, data.choro.id)
    rid, eid = _closed(client, data)
    assert client.patch(f"/api/requests/handler-report/{eid}", headers=auth_headers(data.ice),
                        json={"amount": "500"}).status_code == 400          # больше выданного
    r = client.patch(f"/api/requests/handler-report/{eid}", headers=auth_headers(data.ice),
                     json={"amount": "250.00", "payment_method": "bank"})
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["amount"]) == Decimal("250") and r.json()["payment_method"] == "bank"
    assert _bal(db, data.org.id, data.choro.id) == b_choro + Decimal("30")   # 280 выдано − 250 расход


def test_reject_cancels_expense_and_returns_request(client, db, data):
    b_choro = _bal(db, data.org.id, data.choro.id)
    rid, eid = _closed(client, data)
    assert _bal(db, data.org.id, data.choro.id) == b_choro
    r = client.post(f"/api/requests/handler-report/{eid}/reject", headers=auth_headers(data.ice),
                    json={"comment": "не та категория"})
    assert r.status_code == 200, r.text
    db.expire_all()
    req = db.get(MoneyRequest, rid)
    assert req.status == "issued" and req.expense_id is None and req.returned_comment == "не та категория"
    # Расход отменён — выданные деньги снова числятся на сотруднике.
    assert _bal(db, data.org.id, data.choro.id) == b_choro + Decimal("280")
    # Индира исправляет и проводит заново — появляется новый расход.
    r = _close(client, data.indira, rid, no_receipt=True, no_receipt_comment="без чека, исправлено")
    assert r.status_code == 200 and r.json()["expense_id"] != eid
