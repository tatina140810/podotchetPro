"""Богатый детерминированный seed для baseline-проверки хука и функциональных тестов.
Все даты — август 2026 (текущий месяц), чтобы месячные отчёты year=2026/month=8 их видели.
Возвращает объект с ссылками на созданные записи (по .id и сами объекты)."""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from models import (
    BalanceTopUp,
    Category,
    Department,
    EmployeeDepartment,
    ExchangeRate,
    Expense,
    Income,
    MoneyTransfer,
    Organization,
    ProjectWorkspace,
    ProjectWorkspaceMember,
    SupplierAdvance,
    SupplierAdvanceTransaction,
    User,
)

D = lambda x: Decimal(str(x))
USD_RATE = D("89")

# Уникальный таймстамп на каждую запись (микросекунды-счётчик) — иначе LIMIT-выборки
# (dashboard recent_expenses) при равных временах недетерминированы по тай-брейку.
_SEQ = [0]


def AUG(d=3, h=10):
    _SEQ[0] += 1
    return datetime(2026, 8, d, h, 0, _SEQ[0] % 60, _SEQ[0])


def seed_all(db) -> SimpleNamespace:
    org = Organization(name="АВА ГРУПП", plan="legacy")
    db.add(org)
    db.flush()

    def user(name, phone, role="accountable", supervisor_id=None, confidential=False):
        u = User(org_id=org.id, name=name, phone=phone, password_hash="x",
                 role=role, supervisor_id=supervisor_id, is_confidential=confidential)
        db.add(u)
        db.flush()
        return u

    director = user("Директор", "+70000000001", role="superadmin")
    acc1 = user("Чинара Эже", "+70000000002")
    acc2 = user("Асан", "+70000000003", supervisor_id=acc1.id)
    conf = user("Билим", "+70000000004", confidential=True)
    wsowner = user("Мээрим", "+70000000005")
    auditor = user("Аудитор", "+70000000006", role="auditor")

    depA = Department(org_id=org.id, name="Департ A")
    depB = Department(org_id=org.id, name="Департ B")
    db.add_all([depA, depB])
    db.flush()
    db.add_all([
        EmployeeDepartment(employee_id=acc1.id, department_id=depA.id),
        EmployeeDepartment(employee_id=acc2.id, department_id=depB.id),
    ])

    catNormal = Category(org_id=org.id, name="Прочие расходы")
    catOp = Category(org_id=org.id, name="Аренда", is_operational=True)
    catSys = Category(org_id=org.id, name="Подотчёт", is_system=True)
    db.add_all([catNormal, catOp, catSys])
    db.flush()

    db.add(ExchangeRate(org_id=org.id, from_currency="USD", to_currency="KGS",
                        rate=USD_RATE, date=AUG(1)))

    def topup(admin, u, amount, cur, dep, cat=None, d=2):
        akgs = D(amount) if cur == "KGS" else D(amount) * USD_RATE
        t = BalanceTopUp(org_id=org.id, admin_id=admin.id, user_id=u.id, amount=D(amount),
                         currency=cur, amount_kgs=akgs, date=AUG(d), department_id=dep.id,
                         category_id=cat.id if cat else None)
        db.add(t); db.flush(); return t

    t1 = topup(director, acc1, 100000, "KGS", depA)
    t2 = topup(director, acc2, 1000, "USD", depB)
    t3 = topup(director, acc1, 8000, "KGS", depA, cat=catNormal)

    def income(received, created, amount, cur, d=3, dep=None):
        akgs = D(amount) if cur == "KGS" else D(amount) * USD_RATE
        inc = Income(org_id=org.id, amount=D(amount), currency=cur, amount_kgs=akgs,
                     source="Оплата клиента", received_by_id=received.id,
                     created_by_id=created.id, date=AUG(d),
                     department_id=dep.id if dep else None)
        db.add(inc); db.flush(); return inc

    inc_own = income(acc1, acc1, 20000, "KGS")          # своя запись → сотрудник правит
    inc_admin = income(acc2, director, 30000, "KGS")    # внёс директор → сотрудник 403
    inc_usd = income(acc1, acc1, 500, "USD")

    def expense(emp, amount, cur, dep, cat, status="approved", personal=False,
                etype="expense", to_user=None, d=4):
        akgs = D(amount) if cur == "KGS" else D(amount) * USD_RATE
        e = Expense(org_id=org.id, employee_id=emp.id, amount=D(amount), currency=cur,
                    amount_kgs=akgs, category_id=cat.id if cat else None,
                    department_id=dep.id if dep else None, status=status,
                    is_personal_contribution=personal, expense_type=etype,
                    to_user_id=to_user.id if to_user else None, spent_at=AUG(d))
        db.add(e); db.flush(); return e

    e_appr = expense(acc1, 3000, "KGS", depA, catNormal, status="approved")
    e_pend = expense(acc1, 2000, "KGS", depA, catNormal, status="pending")
    e_pers = expense(acc1, 2000, "KGS", depA, catNormal, status="approved", personal=True)
    e_usd = expense(acc2, 200, "USD", depB, catOp, status="approved")
    e_rej = expense(acc1, 1500, "KGS", depA, catNormal, status="rejected")
    e_conf = expense(conf, 5000, "KGS", depA, catNormal, status="approved")
    e_transfer = expense(acc1, 1000, "KGS", depA, None, status="approved",
                         etype="transfer", to_user=acc2)

    # Депозит поставщика + покупка с него
    adv = SupplierAdvance(org_id=org.id, employee_id=acc1.id, supplier_name="Строймаг",
                          initial_amount=D(10000), currency="KGS", status="active")
    db.add(adv); db.flush()
    db.add(SupplierAdvanceTransaction(advance_id=adv.id, type="deposit", amount=D(10000), date=AUG(2)))
    e_supp = Expense(org_id=org.id, employee_id=acc1.id, amount=D(4000), currency="KGS",
                     amount_kgs=D(4000), category_id=catNormal.id, department_id=depA.id,
                     status="approved", payment_source="supplier_advance",
                     supplier_advance_id=adv.id, spent_at=AUG(5))
    db.add(e_supp); db.flush()
    db.add(SupplierAdvanceTransaction(advance_id=adv.id, type="purchase", amount=D(4000),
                                      expense_id=e_supp.id, date=AUG(5)))

    # Проектное пространство
    ws = ProjectWorkspace(org_id=org.id, name="Проект X", owner_id=wsowner.id)
    db.add(ws); db.flush()
    db.add(ProjectWorkspaceMember(workspace_id=ws.id, user_id=wsowner.id))
    topup_ws = BalanceTopUp(org_id=org.id, admin_id=director.id, user_id=wsowner.id,
                            amount=D(15000), currency="KGS", amount_kgs=D(15000), date=AUG(2),
                            department_id=depA.id, workspace_id=ws.id)
    db.add(topup_ws)
    e_ws = Expense(org_id=org.id, employee_id=wsowner.id, amount=D(3000), currency="KGS",
                   amount_kgs=D(3000), category_id=catNormal.id, department_id=depA.id,
                   status="approved", workspace_id=ws.id, spent_at=AUG(4))
    db.add(e_ws); db.flush()

    # Переводы
    mt1 = MoneyTransfer(org_id=org.id, from_user_id=acc1.id, to_user_id=acc2.id,
                        amount=D(5000), currency="KGS", amount_kgs=D(5000), created_at=AUG(6))
    mt2 = MoneyTransfer(org_id=org.id, from_user_id=acc2.id, to_user_id=acc1.id,
                        amount=D(200), currency="USD", amount_kgs=D(200) * USD_RATE, created_at=AUG(6))
    db.add_all([mt1, mt2])

    db.commit()
    return SimpleNamespace(**{k: v for k, v in locals().items()
                              if isinstance(v, (Organization, User, Department, Category,
                                                BalanceTopUp, Income, Expense, MoneyTransfer,
                                                ProjectWorkspace, SupplierAdvance))})
