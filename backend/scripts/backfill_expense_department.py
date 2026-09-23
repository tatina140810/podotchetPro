"""Бэкфилл подразделения расходов сотрудника (жёсткая привязка задним числом).

Кейс 2026-09-23: все расходы Адика (id 39) должны быть в «Мос офис» (id 16);
6 старых записей висели на Локомотив/ИСААДАТ/САМАТ.

Идемпотентен: трогает только строки, где department_id != --to; повторный запуск
ничего не меняет. Суммы/валюты/amount_kgs НЕ пересчитываются — меняется только
принадлежность подразделению. Пишет RecordChangeLog(action=update, changed_by=--by,
_reason=backfill_expense_department).

Запуск (на сервере, из backend/):
  .venv/bin/python scripts/backfill_expense_department.py --employee 39 --to 16 --by 1
  ... --apply                                                        # применить
"""
import argparse
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func  # noqa: E402

import database  # noqa: E402
from models import BalanceTopUp, Department, Expense, RecordChangeLog, User  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--employee", type=int, required=True)
    ap.add_argument("--to", dest="dep_to", type=int, required=True, help="department_id назначения")
    ap.add_argument("--by", type=int, required=True, help="user id, от чьего имени запись в журнал")
    ap.add_argument("--date-from", default=None, help="YYYY-MM-DD включительно (по умолчанию — вся история)")
    ap.add_argument("--date-to", default=None, help="YYYY-MM-DD исключительно")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    db = database.SessionLocal()
    try:
        emp = db.get(User, a.employee)
        actor = db.get(User, a.by)
        dep = db.get(Department, a.dep_to)
        if not emp or not actor:
            print("employee/actor не найден"); return 2
        if not dep or dep.org_id != emp.org_id:
            print(f"подразделение {a.dep_to} не найдено в org {emp.org_id}"); return 2

        q = (
            db.query(Expense)
            .filter(
                Expense.org_id == emp.org_id,
                Expense.employee_id == emp.id,
                Expense.deleted_at.is_(None),
                func.coalesce(Expense.department_id, -1) != a.dep_to,
            )
        )
        if a.date_from:
            from datetime import datetime
            q = q.filter(Expense.spent_at >= datetime.fromisoformat(a.date_from))
        if a.date_to:
            from datetime import datetime
            q = q.filter(Expense.spent_at < datetime.fromisoformat(a.date_to))
        rows = q.order_by(Expense.spent_at, Expense.id).all()

        names = {d.id: d.name for d in db.query(Department).filter(Department.org_id == emp.org_id)}
        total = sum(Decimal(str(r.amount)) for r in rows)
        print(f"{'APPLY' if a.apply else 'DRY-RUN'}: {emp.name} (id {emp.id}) → "
              f"«{dep.name}» (id {dep.id}): строк {len(rows)}, сумма {total}")
        for r in rows:
            src = names.get(r.department_id, "Не указано")
            mark = "  ⚠ ПЕРЕДАЧА (есть парный BalanceTopUp)" if r.expense_type == "transfer" else ""
            print(f"  #{r.id} {r.spent_at.date()} {r.amount} {r.currency} [{src}] "
                  f"{r.status} {(r.description or '')[:50]!r}{mark}")
        if not a.apply or not rows:
            return 0

        moved_topups = 0
        for r in rows:
            db.add(RecordChangeLog(
                org_id=r.org_id, entity_type="expense", entity_id=r.id, action="update",
                changed_by=actor.id,
                diff={"department_id": {"old": r.department_id, "new": a.dep_to},
                      "_reason": "backfill_expense_department"},
            ))
            old_dep = r.department_id
            r.department_id = a.dep_to
            # Передача: парный BalanceTopUp получателя должен остаться в том же
            # подразделении, что и сама передача, иначе агрегаты разойдутся.
            if r.expense_type == "transfer" and r.to_user_id:
                for t in (
                    db.query(BalanceTopUp)
                    .filter(
                        BalanceTopUp.org_id == r.org_id,
                        BalanceTopUp.user_id == r.to_user_id,
                        BalanceTopUp.admin_id == r.employee_id,
                        BalanceTopUp.amount == r.amount,
                        BalanceTopUp.deleted_at.is_(None),
                        func.coalesce(BalanceTopUp.department_id, -1) == (old_dep if old_dep is not None else -1),
                    )
                    .all()
                ):
                    t.department_id = a.dep_to
                    moved_topups += 1
        db.commit()
        left = db.query(func.count(Expense.id)).filter(
            Expense.org_id == emp.org_id, Expense.employee_id == emp.id,
            Expense.deleted_at.is_(None),
            func.coalesce(Expense.department_id, -1) != a.dep_to).scalar()
        print(f"  применено: расходов {len(rows)}, парных пополнений {moved_topups}; "
              f"осталось вне «{dep.name}»: {left}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
