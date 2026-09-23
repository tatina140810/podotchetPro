"""Жёсткая привязка сотрудника к подразделению (users.forced_department_id).

Кейс Тати: все операции Адика должны уходить в «Мос офис», все операции Алтынай —
в «Локомотив», независимо от того, что выбрано в форме. Привязка ВЛАДЕЛЬЦА записи
(на кого оформлена операция) важнее привязки того, кто её вносит.

Zero-diff: сотрудник БЕЗ привязки ведёт себя ровно как раньше — подразделение берётся
из формы (это проверяется отдельными тестами, иначе фича тихо переехала бы на всех).

ВАЖНО (как в соседних тестах): сессию сида закрываем сразу, наружу отдаём только id —
иначе открытая сессия держит блокировку и TRUNCATE следующего теста виснет.
"""
from types import SimpleNamespace
from typing import Optional

import auth
import database
from conftest import reset_all
from models import User
from tests.seed import seed_all


def _fresh_seed() -> SimpleNamespace:
    reset_all()
    db = database.SessionLocal()
    try:
        s = seed_all(db)
        ids = SimpleNamespace(
            org_id=s.org.id, director=s.director.id,
            acc1=s.acc1.id, acc2=s.acc2.id,
            depA=s.depA.id, depB=s.depB.id,
            catNormal=s.catNormal.id,
            e_pend=s.e_pend.id,
        )
    finally:
        db.close()
    return ids


def _bind(user_id: int, dep_id: Optional[int]) -> None:
    """Поставить/снять жёсткую привязку напрямую в БД (как это сделает карточка сотрудника)."""
    db = database.SessionLocal()
    try:
        u = db.get(User, user_id)
        u.forced_department_id = dep_id
        db.commit()
    finally:
        db.close()


def _hdr(user_id: int, org_id: int, role: str) -> dict:
    return {"Authorization": f"Bearer {auth.create_access_token(user_id, org_id, role)}"}


def _acc(ids) -> dict:
    return _hdr(ids.acc1, ids.org_id, "accountable")


def _dir(ids) -> dict:
    return _hdr(ids.director, ids.org_id, "superadmin")


# ----------------------------- РАСХОД -----------------------------

def test_expense_create_forced_overrides_choice(client):
    """Сотрудник выбрал depA, но привязан к depB → расход уходит в depB."""
    ids = _fresh_seed()
    _bind(ids.acc1, ids.depB)
    r = client.post("/api/expenses", headers=_acc(ids), json={
        "amount": "100", "currency": "KGS", "category_id": ids.catNormal,
        "department_id": ids.depA, "description": "тест привязки",
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depB


def test_expense_create_without_binding_keeps_choice(client):
    """Zero-diff: без привязки подразделение берётся из формы."""
    ids = _fresh_seed()
    r = client.post("/api/expenses", headers=_acc(ids), json={
        "amount": "100", "currency": "KGS", "category_id": ids.catNormal,
        "department_id": ids.depA, "description": "без привязки",
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depA


def test_expense_on_behalf_uses_owner_binding(client):
    """Директор вносит от лица привязанного сотрудника → подразделение сотрудника,
    а не выбранное в форме и не привязка вносящего."""
    ids = _fresh_seed()
    _bind(ids.acc1, ids.depB)
    _bind(ids.director, ids.depA)
    r = client.post("/api/expenses", headers=_dir(ids), json={
        "amount": "250", "currency": "KGS", "category_id": ids.catNormal,
        "department_id": ids.depA, "on_behalf_of_user_id": ids.acc1,
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depB


def test_expense_recorder_binding_applies_when_owner_free(client):
    """У владельца привязки нет → работает привязка того, кто вносит."""
    ids = _fresh_seed()
    _bind(ids.director, ids.depB)
    r = client.post("/api/expenses", headers=_dir(ids), json={
        "amount": "300", "currency": "KGS", "category_id": ids.catNormal,
        "department_id": ids.depA, "on_behalf_of_user_id": ids.acc1,
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depB


def test_expense_patch_cannot_move_out_of_binding(client):
    """Правка расхода привязанного сотрудника не уводит его в другое подразделение."""
    ids = _fresh_seed()
    _bind(ids.acc1, ids.depB)
    r = client.patch(f"/api/expenses/{ids.e_pend}", headers=_dir(ids),
                     json={"department_id": ids.depA})
    assert r.status_code == 200, r.text
    assert r.json()["department_id"] == ids.depB


def test_expense_patch_without_binding_moves_normally(client):
    """Zero-diff: без привязки подразделение по-прежнему меняется вручную."""
    ids = _fresh_seed()
    r = client.patch(f"/api/expenses/{ids.e_pend}", headers=_dir(ids),
                     json={"department_id": ids.depB})
    assert r.status_code == 200, r.text
    assert r.json()["department_id"] == ids.depB


# ------------------- СМЕНА СОТРУДНИКА В РАСХОДЕ -------------------

def test_expense_patch_employee_requires_privileged_role(client):
    """Рядовой сотрудник не может переписать расход на другого (увести долг)."""
    ids = _fresh_seed()
    r = client.patch(f"/api/expenses/{ids.e_pend}", headers=_acc(ids),
                     json={"employee_id": ids.acc2})
    assert r.status_code == 403, r.text


def test_expense_patch_employee_by_director(client):
    """Директор переназначает расход на другого сотрудника; привязка нового владельца
    (depB) перетягивает и подразделение."""
    ids = _fresh_seed()
    _bind(ids.acc2, ids.depB)
    r = client.patch(f"/api/expenses/{ids.e_pend}", headers=_dir(ids),
                     json={"employee_id": ids.acc2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["employee_id"] == ids.acc2
    assert body["department_id"] == ids.depB


def test_expense_patch_employee_unknown_rejected(client):
    ids = _fresh_seed()
    r = client.patch(f"/api/expenses/{ids.e_pend}", headers=_dir(ids),
                     json={"employee_id": 999999})
    assert r.status_code == 400, r.text


# ----------------------------- ВЫДАЧА -----------------------------

def test_topup_uses_receiver_binding(client):
    """Выдача привязанному сотруднику уходит в его подразделение."""
    ids = _fresh_seed()
    _bind(ids.acc1, ids.depB)
    r = client.post(f"/api/users/{ids.acc1}/topup", headers=_dir(ids), json={
        "amount": "500", "currency": "KGS", "department_id": ids.depA, "note": "выдача",
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depB


def test_topup_without_binding_keeps_choice(client):
    ids = _fresh_seed()
    r = client.post(f"/api/users/{ids.acc1}/topup", headers=_dir(ids), json={
        "amount": "500", "currency": "KGS", "department_id": ids.depA, "note": "выдача",
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depA


# ----------------------------- ЗАЯВКА -----------------------------

def test_request_uses_requester_binding(client):
    ids = _fresh_seed()
    _bind(ids.acc1, ids.depB)
    r = client.post("/api/requests", headers=_acc(ids), json={
        "title": "Заявка", "approver_id": ids.director, "department_id": ids.depA,
        "items": [{"description": "такси", "amount": "100", "quantity": 1}],
    })
    assert r.status_code == 201, r.text
    assert r.json()["department_id"] == ids.depB


# ----------------------- список коллег: выбор себя -----------------------

def test_colleagues_include_self(client):
    """Правка расхода даёт выбрать и СЕБЯ: без этого свой же расход нельзя было
    оставить на себе, а селект подставлял первого в списке."""
    ids = _fresh_seed()
    hdr = _acc(ids)
    plain = client.get("/api/users/colleagues", headers=hdr)
    with_self = client.get("/api/users/colleagues?include_self=true", headers=hdr)
    assert plain.status_code == 200 and with_self.status_code == 200
    plain_ids = {u["id"] for u in plain.json()}
    self_ids = {u["id"] for u in with_self.json()}
    # Zero-diff: прежний вызов по-прежнему без себя (нельзя передать деньги себе).
    assert ids.acc1 not in plain_ids
    assert ids.acc1 in self_ids
    assert plain_ids < self_ids
