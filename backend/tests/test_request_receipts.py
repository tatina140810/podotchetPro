"""Чеки/документы к заявке (money_request_receipts).

Правила, которые проверяем:
- крепить можно ТОЛЬКО к approved (draft/pending/rejected — 400);
- крепить может заявитель, адресат и директор; посторонний — 403 (нет доступа);
- аудитор видит заявку (read-only), но прикрепить не может;
- несколько документов на одну заявку — все возвращаются в GET и в теле заявки;
- удалить может автор загрузки и директор; чужой документ — 403;
- чужая организация не видит заявку (404).
"""
from decimal import Decimal

import pytest

from conftest import auth_headers, reset_all
from models import MoneyRequest, MoneyRequestItem, Organization, User


@pytest.fixture()
def data(db):
    reset_all()
    org = Organization(name="ORG", plan="legacy")
    other_org = Organization(name="ORG2", plan="legacy")
    db.add_all([org, other_org])
    db.flush()

    def user(o, name, phone, role="accountable"):
        u = User(org_id=o.id, name=name, phone=phone, password_hash="x", role=role)
        db.add(u)
        db.flush()
        return u

    director = user(org, "Директор", "+7100", role="superadmin")
    requester = user(org, "Индира", "+7101")
    approver = user(org, "Ice", "+7102")
    stranger = user(org, "Посторонний", "+7103")
    auditor = user(org, "Аудитор", "+7104", role="auditor")
    alien = user(other_org, "Чужой", "+7105", role="superadmin")

    def make_req(status_: str) -> MoneyRequest:
        r = MoneyRequest(
            org_id=org.id,
            requester_id=requester.id,
            approver_id=approver.id,
            status=status_,
            title=f"Хозы {status_}",
            total_amount=Decimal("250"),
            currency="KGS",
        )
        db.add(r)
        db.flush()
        db.add(MoneyRequestItem(request_id=r.id, description="Мыло", amount=Decimal("250"), quantity=1))
        db.flush()
        return r

    approved = make_req("approved")
    pending = make_req("pending")
    db.commit()

    from types import SimpleNamespace
    return SimpleNamespace(
        org=org, director=director, requester=requester, approver=approver,
        stranger=stranger, auditor=auditor, alien=alien,
        approved=approved, pending=pending,
    )


def _attach(client, user, req_id, url, name="чек.jpg"):
    return client.post(
        f"/api/requests/{req_id}/receipts",
        json={"file_url": url, "file_name": name},
        headers=auth_headers(user),
    )


def test_attach_multiple_receipts_to_approved(client, data):
    """Несколько документов на одну заявку — все видны и в GET, и в теле заявки."""
    for i in range(3):
        r = _attach(client, data.requester, data.approved.id, f"/uploads/1/f{i}.jpg", f"чек{i}.jpg")
        assert r.status_code == 201, r.text

    lst = client.get(f"/api/requests/{data.approved.id}/receipts", headers=auth_headers(data.requester))
    assert lst.status_code == 200
    assert [x["file_name"] for x in lst.json()] == ["чек0.jpg", "чек1.jpg", "чек2.jpg"]
    assert lst.json()[0]["uploaded_by_name"] == "Индира"

    detail = client.get(f"/api/requests/{data.approved.id}", headers=auth_headers(data.requester))
    assert len(detail.json()["receipts"]) == 3


def test_attach_forbidden_for_not_approved(client, data):
    """К заявке на одобрении документы не крепятся."""
    r = _attach(client, data.requester, data.pending.id, "/uploads/1/x.jpg")
    assert r.status_code == 400
    assert "одобренной" in r.json()["detail"]


def test_approver_and_director_can_attach(client, data):
    assert _attach(client, data.approver, data.approved.id, "/uploads/1/a.jpg").status_code == 201
    assert _attach(client, data.director, data.approved.id, "/uploads/1/d.jpg").status_code == 201


def test_stranger_and_auditor_cannot_attach(client, data):
    """Посторонний не видит заявку (403). Аудитор видит, но read-only."""
    assert _attach(client, data.stranger, data.approved.id, "/uploads/1/s.jpg").status_code == 403
    r = _attach(client, data.auditor, data.approved.id, "/uploads/1/au.jpg")
    assert r.status_code == 403
    assert "заявитель" in r.json()["detail"]


def test_other_org_gets_404(client, data):
    assert _attach(client, data.alien, data.approved.id, "/uploads/9/x.jpg").status_code == 404
    lst = client.get(f"/api/requests/{data.approved.id}/receipts", headers=auth_headers(data.alien))
    assert lst.status_code == 404


def test_delete_own_and_director_any_foreign_forbidden(client, data):
    mine = _attach(client, data.requester, data.approved.id, "/uploads/1/mine.jpg").json()
    theirs = _attach(client, data.approver, data.approved.id, "/uploads/1/theirs.jpg").json()

    # чужой документ своим не удалить
    bad = client.delete(
        f"/api/requests/{data.approved.id}/receipts/{theirs['id']}",
        headers=auth_headers(data.requester),
    )
    assert bad.status_code == 403

    # свой — можно
    ok = client.delete(
        f"/api/requests/{data.approved.id}/receipts/{mine['id']}",
        headers=auth_headers(data.requester),
    )
    assert ok.status_code == 204

    # директор — любой
    ok2 = client.delete(
        f"/api/requests/{data.approved.id}/receipts/{theirs['id']}",
        headers=auth_headers(data.director),
    )
    assert ok2.status_code == 204

    lst = client.get(f"/api/requests/{data.approved.id}/receipts", headers=auth_headers(data.requester))
    assert lst.json() == []


def test_receipt_of_other_request_not_found(client, data):
    """id документа из другой заявки не удаляется через чужой маршрут."""
    rec = _attach(client, data.requester, data.approved.id, "/uploads/1/z.jpg").json()
    r = client.delete(
        f"/api/requests/{data.pending.id}/receipts/{rec['id']}",
        headers=auth_headers(data.requester),
    )
    assert r.status_code == 404
