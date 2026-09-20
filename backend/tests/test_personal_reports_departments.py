"""Личные отчёты сотрудника + личные подразделения.

Сотрудник с флагом can_view_own_reports видит «Отчёт по категориям» и «Отчёт по
подразделениям», построенные ТОЛЬКО по его расходам (он плательщик или он внёс).
Сотрудник с флагом can_create_departments заводит свои подразделения
(departments.owner_id) — другим сотрудникам они не видны и недоступны для выбора.
Директор/админ/аудитор видят их как обычные (иначе суммы org не сойдутся).

Zero-diff: без флагов поведение прежнее (403 на отчёты, отчёт директора не меняется).

Сессию сида закрываем сразу и наружу отдаём только id — иначе открытая сессия
держит блокировку и TRUNCATE следующего теста виснет.
"""
from types import SimpleNamespace

import auth
import database
from conftest import reset_all
from models import Department, User
from tests.seed import seed_all


def _fresh_seed() -> SimpleNamespace:
    reset_all()
    db = database.SessionLocal()
    try:
        s = seed_all(db)
        ids = SimpleNamespace(
            org_id=s.org.id, director=s.director.id, auditor=s.auditor.id,
            acc1=s.acc1.id, acc2=s.acc2.id,
            depA=s.depA.id, depB=s.depB.id,
            e_appr=s.e_appr.id, e_usd=s.e_usd.id,
        )
    finally:
        db.close()
    return ids


def _set_flags(user_id: int, **flags) -> None:
    db = database.SessionLocal()
    try:
        u = db.get(User, user_id)
        for k, v in flags.items():
            setattr(u, k, v)
        db.commit()
    finally:
        db.close()


def _make_personal_dep(owner_id: int, org_id: int, name: str) -> int:
    db = database.SessionLocal()
    try:
        d = Department(org_id=org_id, name=name, owner_id=owner_id)
        db.add(d)
        db.commit()
        return d.id
    finally:
        db.close()


def _hdr(user_id: int, org_id: int, role: str) -> dict:
    return {"Authorization": f"Bearer {auth.create_access_token(user_id, org_id, role)}"}


def _acc(ids, uid=None) -> dict:
    return _hdr(uid or ids.acc1, ids.org_id, "accountable")


def _dir(ids) -> dict:
    return _hdr(ids.director, ids.org_id, "superadmin")


# Расходы acc1 за август, попадающие в отчёт (approved+pending, expense, не системная
# категория): e_appr 3000 + e_pend 2000 + e_pers 2000 + e_supp 4000 = 11000 сом.
# e_rej (rejected), e_transfer (передача) — не считаются. Расход acc2 (200 USD × 89 =
# 17800) в личный отчёт acc1 попадать не должен.
ACC1_TOTAL = 11000.0


# ----------------------------- ДОСТУП К ОТЧЁТАМ -----------------------------

def test_reports_forbidden_without_flag(client):
    """Zero-diff: обычный сотрудник по-прежнему не имеет доступа к отчётам."""
    ids = _fresh_seed()
    assert client.get("/api/reports/categories?year=2026&month=8", headers=_acc(ids)).status_code == 403
    assert client.get("/api/reports/by-department?year=2026&month=8", headers=_acc(ids)).status_code == 403


def test_category_report_only_own_expenses(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_view_own_reports=True)
    r = client.get("/api/reports/categories?year=2026&month=8", headers=_acc(ids))
    assert r.status_code == 200
    data = r.json()
    assert data["total_expenses"] == ACC1_TOTAL
    # Приходы организации сотруднику не показываем.
    assert data["total_income"] == 0
    # Ни одна строка детализации не содержит чужой расход.
    ids_in_report = {
        item["id"] for row in data["operational"] + data["other"] for item in row["items"]
    }
    assert ids.e_appr in ids_in_report
    assert ids.e_usd not in ids_in_report


def test_director_category_report_unchanged(client):
    """Zero-diff: у директора отчёт по-прежнему по всей организации."""
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_view_own_reports=True)
    r = client.get("/api/reports/categories?year=2026&month=8", headers=_dir(ids))
    assert r.status_code == 200
    data = r.json()
    assert data["total_expenses"] > ACC1_TOTAL  # включает расходы других сотрудников
    assert data["total_income"] > 0


def test_department_report_only_own_numbers(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_view_own_reports=True)
    r = client.get("/api/reports/by-department?year=2026&month=8", headers=_acc(ids))
    assert r.status_code == 200
    data = r.json()
    dep_ids = {d["id"] for d in data["departments"]}
    assert ids.depA in dep_ids   # там его расходы
    assert ids.depB not in dep_ids  # там расход acc2
    assert data["totals"]["spent"] == ACC1_TOTAL
    # В разрезе сотрудников — только он сам.
    for d in data["departments"]:
        assert {e["id"] for e in d["employees"]} <= {ids.acc1}


def test_personal_department_shown_in_own_report_even_empty(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_view_own_reports=True)
    dep_id = _make_personal_dep(ids.acc1, ids.org_id, "Мой участок")
    r = client.get("/api/reports/by-department?year=2026&month=8", headers=_acc(ids))
    assert r.status_code == 200
    assert dep_id in {d["id"] for d in r.json()["departments"]}


# ----------------------------- ЛИЧНЫЕ ПОДРАЗДЕЛЕНИЯ -----------------------------

def test_create_department_forbidden_without_flag(client):
    ids = _fresh_seed()
    r = client.post("/api/departments", json={"name": "Свой"}, headers=_acc(ids))
    assert r.status_code == 403


def test_employee_creates_personal_department(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_create_departments=True)
    r = client.post("/api/departments", json={"name": "Мой участок"}, headers=_acc(ids))
    assert r.status_code == 201
    assert r.json()["owner_id"] == ids.acc1


def test_personal_department_hidden_from_other_employee(client):
    ids = _fresh_seed()
    dep_id = _make_personal_dep(ids.acc1, ids.org_id, "Мой участок")
    # Владелец видит — и в своём списке, и в списке выбора (all=true)
    assert dep_id in {d["id"] for d in client.get("/api/departments", headers=_acc(ids)).json()}
    assert dep_id in {d["id"] for d in client.get("/api/departments?all=true", headers=_acc(ids)).json()}
    # Другой сотрудник — не видит нигде
    other = _acc(ids, ids.acc2)
    assert dep_id not in {d["id"] for d in client.get("/api/departments", headers=other).json()}
    assert dep_id not in {d["id"] for d in client.get("/api/departments?all=true", headers=other).json()}
    # Директор видит (оверсайт)
    assert dep_id in {d["id"] for d in client.get("/api/departments", headers=_dir(ids)).json()}


def test_other_employee_cannot_spend_into_personal_department(client):
    ids = _fresh_seed()
    dep_id = _make_personal_dep(ids.acc1, ids.org_id, "Мой участок")
    payload = {"amount": 100, "currency": "KGS", "department_id": dep_id, "description": "т"}
    r = client.post("/api/expenses", json=payload, headers=_acc(ids, ids.acc2))
    assert r.status_code == 400
    # Владельцу — можно
    r2 = client.post("/api/expenses", json=payload, headers=_acc(ids))
    assert r2.status_code in (200, 201), r2.text


def test_other_employee_cannot_edit_or_delete_personal_department(client):
    ids = _fresh_seed()
    dep_id = _make_personal_dep(ids.acc1, ids.org_id, "Мой участок")
    other = _acc(ids, ids.acc2)
    assert client.patch(f"/api/departments/{dep_id}", json={"currency": "USD"}, headers=other).status_code == 404
    assert client.delete(f"/api/departments/{dep_id}", headers=other).status_code == 404
    # Владелец — может (движений по нему нет)
    assert client.patch(f"/api/departments/{dep_id}", json={"currency": "USD"}, headers=_acc(ids)).status_code == 200
    assert client.delete(f"/api/departments/{dep_id}", headers=_acc(ids)).status_code == 204


def test_common_departments_unchanged_for_everyone(client):
    """Zero-diff: обычные (owner_id IS NULL) подразделения видны как раньше."""
    ids = _fresh_seed()
    _make_personal_dep(ids.acc1, ids.org_id, "Мой участок")
    for hdr in (_acc(ids, ids.acc2), _dir(ids), _hdr(ids.auditor, ids.org_id, "auditor")):
        listed = {d["id"] for d in client.get("/api/departments?all=true", headers=hdr).json()}
        assert {ids.depA, ids.depB} <= listed


# ----------------------------- ИМПОРТ ИСТОРИИ -----------------------------
# Сотрудник с флагом can_bulk_import вносит массово ТОЛЬКО свои расходы.
# Приходы/выдачи и чужие сотрудники ему запрещены (иначе можно нарисовать себе
# поступление денег). Статус импортированных расходов — approved, как у админа.

def _import(client, hdr, items):
    return client.post("/api/admin/bulk-import", json={"items": items}, headers=hdr)


def _expense_item(dep_id, amount=500, user_id=None):
    item = {"type": "expense", "amount": amount, "currency": "KGS",
            "department_id": dep_id, "description": "историческая покупка"}
    if user_id is not None:
        item["user_id"] = user_id
    return item


def test_bulk_import_forbidden_without_flag(client):
    """Zero-diff: обычный сотрудник по-прежнему не имеет доступа к импорту."""
    ids = _fresh_seed()
    r = _import(client, _acc(ids), [_expense_item(ids.depA)])
    assert r.status_code == 403


def test_bulk_import_own_expense_approved(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_bulk_import=True)
    r = _import(client, _acc(ids), [_expense_item(ids.depA, 700)])
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1 and r.json()["errors"] == []
    # Запись легла на него самого и сразу в статусе approved (перенос истории).
    rows = client.get("/api/expenses", headers=_acc(ids)).json()
    mine = [e for e in rows if float(e["amount"]) == 700]
    assert len(mine) == 1
    assert mine[0]["employee_id"] == ids.acc1 and mine[0]["status"] == "approved"


def test_bulk_import_rejects_other_employee(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_bulk_import=True)
    r = _import(client, _acc(ids), [_expense_item(ids.depA, 800, user_id=ids.acc2)])
    assert r.status_code == 200
    assert r.json()["created"] == 0
    assert "свои" in r.json()["errors"][0]["error"].lower()


def test_bulk_import_rejects_income_and_topup(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_bulk_import=True)
    r = _import(client, _acc(ids), [
        {"type": "income", "amount": 1000, "currency": "KGS", "source": "тест"},
        {"type": "topup", "amount": 1000, "currency": "KGS", "department_id": ids.depA},
    ])
    assert r.status_code == 200
    assert r.json()["created"] == 0
    assert len(r.json()["errors"]) == 2
    assert all("только расходы" in e["error"].lower() for e in r.json()["errors"])


def test_bulk_import_rejects_foreign_personal_department(client):
    ids = _fresh_seed()
    _set_flags(ids.acc1, can_bulk_import=True)
    dep_id = _make_personal_dep(ids.acc2, ids.org_id, "Участок Асана")
    r = _import(client, _acc(ids), [_expense_item(dep_id, 900)])
    assert r.status_code == 200
    assert r.json()["created"] == 0


def test_bulk_import_admin_unchanged(client):
    """Zero-diff: у admin/superadmin импорт по-прежнему полный — и приход, и за другого."""
    ids = _fresh_seed()
    r = _import(client, _dir(ids), [
        _expense_item(ids.depA, 1100, user_id=ids.acc2),
        {"type": "income", "amount": 1200, "currency": "KGS", "source": "тест",
         "received_by_id": ids.acc1},
    ])
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2 and r.json()["errors"] == []
