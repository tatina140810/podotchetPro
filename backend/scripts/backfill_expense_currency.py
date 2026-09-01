"""Бэкфилл валюты расходов сотрудника за период (исправление ошибочно внесённой валюты).

Кейс 2026-09-01: июль 2026 Адика (Мос офис, id 39) внесён как KGS, фактически — RUB.

Идемпотентен: трогает только строки с currency == --from в диапазоне дат; повторный
запуск ничего не меняет. Пересчитывает amount_kgs = amount × курс(--to) (текущий курс
org, как делает PATCH /expenses), пишет RecordChangeLog(action=update, changed_by=--by).

Запуск (на сервере, из backend/ с .env в окружении):
  .venv/bin/python scripts/backfill_expense_currency.py --employee 39 --from KGS --to RUB \
      --date-from 2026-07-01 --date-to 2026-08-01 --by 1            # dry-run
  ... --apply                                                        # применить
"""
import argparse
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func  # noqa: E402

import database  # noqa: E402
from models import Expense, RecordChangeLog, User  # noqa: E402
from services.balance import load_org_rates  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--employee", type=int, required=True)
    ap.add_argument("--from", dest="cur_from", required=True)
    ap.add_argument("--to", dest="cur_to", required=True)
    ap.add_argument("--date-from", required=True, help="YYYY-MM-DD включительно")
    ap.add_argument("--date-to", required=True, help="YYYY-MM-DD исключительно")
    ap.add_argument("--by", type=int, required=True, help="user id, от чьего имени запись в журнал")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    d_from = datetime.fromisoformat(a.date_from)
    d_to = datetime.fromisoformat(a.date_to)

    db = database.SessionLocal()
    try:
        emp = db.get(User, a.employee)
        actor = db.get(User, a.by)
        if not emp or not actor:
            print("employee/actor not found"); return 2
        rates = load_org_rates(db, emp.org_id)
        rate = rates.get(a.cur_to)
        if not rate or rate <= 0:
            print(f"нет курса {a.cur_to}→KGS для org {emp.org_id}"); return 2

        rows = (
            db.query(Expense)
            .filter(Expense.org_id == emp.org_id, Expense.employee_id == emp.id,
                    Expense.currency == a.cur_from, Expense.deleted_at.is_(None),
                    Expense.spent_at >= d_from, Expense.spent_at < d_to)
            .order_by(Expense.spent_at, Expense.id)
            .all()
        )
        total = sum(Decimal(str(r.amount)) for r in rows)
        print(f"{'APPLY' if a.apply else 'DRY-RUN'}: {emp.name} (id {emp.id}), "
              f"{a.cur_from}→{a.cur_to}, курс {a.cur_to}→KGS = {rate}, "
              f"период [{a.date_from}, {a.date_to}): строк {len(rows)}, сумма {total}")
        print(f"  amount_kgs: было {total} → станет {(total * rate).quantize(Decimal('0.01'))}")
        for r in rows[:5]:
            print(f"  #{r.id} {r.spent_at.date()} {r.amount} {r.currency} {r.status} {r.description!r}")
        if len(rows) > 5:
            print(f"  ... ещё {len(rows) - 5}")
        if not a.apply or not rows:
            return 0

        for r in rows:
            old_kgs = r.amount_kgs
            new_kgs = (Decimal(str(r.amount)) * rate).quantize(Decimal("0.01"))
            db.add(RecordChangeLog(
                org_id=r.org_id, entity_type="expense", entity_id=r.id, action="update",
                changed_by=actor.id,
                diff={"currency": {"old": r.currency, "new": a.cur_to},
                      "amount_kgs": {"old": str(old_kgs), "new": str(new_kgs)},
                      "_reason": "backfill_expense_currency"},
            ))
            r.currency = a.cur_to
            r.amount_kgs = new_kgs
        db.commit()
        left = db.query(func.count(Expense.id)).filter(
            Expense.org_id == emp.org_id, Expense.employee_id == emp.id,
            Expense.currency == a.cur_from, Expense.deleted_at.is_(None),
            Expense.spent_at >= d_from, Expense.spent_at < d_to).scalar()
        print(f"  применено: {len(rows)} строк; осталось {a.cur_from} в периоде: {left}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
