"""Ограничение аудитора по подразделению (opt-in).

Аудитор, которому назначено подразделение через employee_departments, видит ТОЛЬКО
данные своих подразделений. Аудитор без подразделения остаётся общесистемным (как
было) — это проверяется как zero-diff-регрессия. Плюс защита доступа по id (IDOR).

Seed (tests/seed.py): auditor изначально БЕЗ подразделения; depA-расходы у acc1,
depB-расход e_usd у acc2. Для «ограниченного» аудитора привязываем его к depA.

ВАЖНО (устойчивость к зависанию): сессию сида закрываем сразу и наружу отдаём только
числовые id — иначе оставшаяся open-сессия держит блокировку и TRUNCATE следующего
теста виснет навсегда.
"""
from types import SimpleNamespace

import auth
import database
from conftest import reset_all
from models import EmployeeDepartment
from tests.seed import seed_all


def _fresh_seed() -> SimpleNamespace:
    reset_all()
    db = database.SessionLocal()
    try:
        s = seed_all(db)
        ids = SimpleNamespace(
            org_id=s.org.id,
            auditor=s.auditor.id, director=s.director.id,
            acc1=s.acc1.id, acc2=s.acc2.id,
            depA=s.depA.id, depB=s.depB.id,
            catNormal=s.catNormal.id, catOp=s.catOp.id, catSys=s.catSys.id,
            e_appr=s.e_appr.id, e_pend=s.e_pend.id, e_usd=s.e_usd.id,
        )
    finally:
        db.close()
    return ids


def _assign(user_id: int, dep_id: int) -> None:
    db = database.SessionLocal()
    try:
        db.add(EmployeeDepartment(employee_id=user_id, department_id=dep_id))
        db.commit()
    finally:
        db.close()


def _hdr(user_id: int, org_id: int, role: str) -> dict:
    return {"Authorization": f"Bearer {auth.create_access_token(user_id, org_id, role)}"}


def _aud(ids) -> dict:
    return _hdr(ids.auditor, ids.org_id, "auditor")


# ----------------------------- РАСХОДЫ -----------------------------

def test_expenses_list_restricted_only_own_department(client):
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    r = client.get("/api/expenses", headers=_aud(ids))
    assert r.status_code == 200
    assert {e["department_id"] for e in r.json()} == {ids.depA}
    got = {e["id"] for e in r.json()}
    assert ids.e_appr in got and ids.e_usd not in got


def test_expenses_list_unrestricted_auditor_sees_all_departments(client):
    """Zero-diff: аудитор БЕЗ подразделения видит и depA, и depB — как раньше."""
    ids = _fresh_seed()
    r = client.get("/api/expenses", headers=_aud(ids))
    assert r.status_code == 200
    dep_ids = {e["department_id"] for e in r.json()}
    assert ids.depA in dep_ids and ids.depB in dep_ids
    assert ids.e_usd in {e["id"] for e in r.json()}


def test_get_expense_by_id_blocks_other_department(client):
    """IDOR: карточку чужого подразделения по id не открыть (404)."""
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    hdr = _aud(ids)
    assert client.get(f"/api/expenses/{ids.e_usd}", headers=hdr).status_code == 404
    assert client.get(f"/api/expenses/{ids.e_appr}", headers=hdr).status_code == 200


def test_verify_expense_blocks_other_department(client):
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    hdr = _aud(ids)
    assert client.post(f"/api/expenses/{ids.e_usd}/verify", headers=hdr).status_code == 404
    assert client.post(f"/api/expenses/{ids.e_appr}/verify", headers=hdr).status_code == 200


# ----------------------------- КАТЕГОРИИ -----------------------------

def test_categories_restricted_only_with_expenses_in_department(client):
    """Только категории с расходами его подразделения; пустые и чужие — скрыты."""
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    got = {c["id"] for c in client.get("/api/categories", headers=_aud(ids)).json()}
    assert ids.catNormal in got       # есть расходы в depA
    assert ids.catOp not in got       # только в depB (e_usd)
    assert ids.catSys not in got      # пустая (без расходов)


def test_categories_unrestricted_auditor_sees_all(client):
    ids = _fresh_seed()
    got = {c["id"] for c in client.get("/api/categories", headers=_aud(ids)).json()}
    assert {ids.catNormal, ids.catOp, ids.catSys} <= got


# ----------------------------- ПОДРАЗДЕЛЕНИЯ -----------------------------

def test_departments_restricted_only_own(client):
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    got = {d["id"] for d in client.get("/api/departments", headers=_aud(ids)).json()}
    assert got == {ids.depA}


def test_departments_unrestricted_sees_both(client):
    ids = _fresh_seed()
    got = {d["id"] for d in client.get("/api/departments", headers=_aud(ids)).json()}
    assert {ids.depA, ids.depB} <= got


# ----------------------------- ДАШБОРД -----------------------------

def test_dashboard_restricted_scoped(client):
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    data = client.get("/api/dashboard", headers=_aud(ids)).json()
    assert data["view"] == "director"
    assert data["totals"]["issued"] == 0          # выдачи не привязаны к подразделению
    assert ids.e_usd not in {e["id"] for e in data["recent_expenses"]}


def test_dashboard_unrestricted_wider_than_restricted(client):
    """Zero-diff-ish: у неограниченного аудитора расход в дашборде больше — включает
    depB (e_usd), которого ограниченный аудитор не видит."""
    ids = _fresh_seed()
    spent_all = client.get("/api/dashboard", headers=_aud(ids)).json()["totals"]["spent"]
    _assign(ids.auditor, ids.depA)
    spent_dep = client.get("/api/dashboard", headers=_aud(ids)).json()["totals"]["spent"]
    assert spent_dep < spent_all


# ----------------------------- СОТРУДНИКИ / IDOR -----------------------------

def test_users_list_restricted_excludes_other_department(client):
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    got = {u["id"] for u in client.get("/api/users", headers=_aud(ids)).json()}
    assert ids.acc1 in got            # сотрудник depA
    assert ids.acc2 not in got        # сотрудник depB


def test_user_balance_by_id_blocks_other_department(client):
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    hdr = _aud(ids)
    assert client.get(f"/api/users/{ids.acc2}/balance", headers=hdr).status_code == 404
    assert client.get(f"/api/users/{ids.acc1}/balance", headers=hdr).status_code == 200


# ----------------------------- ОТЧЁТ ПО СОТРУДНИКАМ -----------------------------

def test_report_employees_restricted_only_own_department(client):
    """/reports/employees: строки-сотрудники ограничены подразделением аудитора
    (acc1 из depA виден, acc2 из depB — нет)."""
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    r = client.get("/api/reports/employees?year=2026&month=8", headers=_aud(ids))
    assert r.status_code == 200
    user_ids = {row["user_id"] for row in r.json()["rows"]}
    assert ids.acc1 in user_ids
    assert ids.acc2 not in user_ids


def test_report_employees_unrestricted_sees_both(client):
    ids = _fresh_seed()
    r = client.get("/api/reports/employees?year=2026&month=8", headers=_aud(ids))
    assert r.status_code == 200
    user_ids = {row["user_id"] for row in r.json()["rows"]}
    assert ids.acc1 in user_ids and ids.acc2 in user_ids


# ----------------------------- ПРИХОДЫ -----------------------------

def test_income_restricted_excludes_null_and_other_department(client):
    """Приходы в seed без подразделения → ограниченному аудитору не видны."""
    ids = _fresh_seed()
    _assign(ids.auditor, ids.depA)
    assert len(client.get("/api/income", headers=_aud(ids)).json()) == 0


def test_income_unrestricted_sees_all(client):
    ids = _fresh_seed()
    assert len(client.get("/api/income", headers=_aud(ids)).json()) == 3


# ----------------------------- ADMIN не затронут -----------------------------

def test_admin_role_never_restricted(client):
    """superadmin/admin всегда общесистемны, даже если им назначить подразделение."""
    ids = _fresh_seed()
    _assign(ids.director, ids.depA)
    hdr = _hdr(ids.director, ids.org_id, "superadmin")
    dep_ids = {e["department_id"] for e in client.get("/api/expenses", headers=hdr).json()}
    assert ids.depB in dep_ids        # director видит и depB несмотря на привязку
