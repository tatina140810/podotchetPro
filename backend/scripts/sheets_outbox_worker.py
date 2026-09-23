"""Воркер очереди выгрузки в Google-таблицу «Локомотив».

Берёт pending-записи из sheets_outbox и добавляет строки на листы «Банк» (безнал),
«Нал» (наличные), «Зарплата сотрудников». Существующие строки не переписываются:
новая вставляется ПЕРЕД строкой ИТОГО, а у итога расширяется диапазон — чтобы
сумма оставалась точной.

Запуск (systemd timer раз в минуту или вручную):
  .venv/bin/python scripts/sheets_outbox_worker.py            # отправить очередь
  .venv/bin/python scripts/sheets_outbox_worker.py --dry-run  # показать, что уйдёт
  .venv/bin/python scripts/sheets_outbox_worker.py --limit 50

Повторный запуск безопасен: отправленная запись получает status='sent', а UNIQUE
(entity_type, entity_id) не даёт поставить одну операцию в очередь дважды.
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import database  # noqa: E402
from config import get_settings  # noqa: E402
from models import SheetsOutbox, User  # noqa: E402
from services.sheets_sync import (  # noqa: E402
    SHEET_TITLES,
    SheetsClient,
    SheetsError,
    append_entry,
)

MAX_ATTEMPTS = 5


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    s = get_settings()
    if not s.sheets_sync_enabled:
        print("выгрузка выключена (SHEETS_SYNC_ENABLED=false)")
        return 0
    if not s.sheets_spreadsheet_id or not s.sheets_credentials_file:
        print("не задан SHEETS_SPREADSHEET_ID или SHEETS_CREDENTIALS_FILE")
        return 2

    db = database.SessionLocal()
    try:
        rows = (
            db.query(SheetsOutbox)
            .filter(SheetsOutbox.status == "pending", SheetsOutbox.attempts < MAX_ATTEMPTS)
            .order_by(SheetsOutbox.op_date, SheetsOutbox.id)
            .limit(a.limit)
            .all()
        )
        if not rows:
            print("очередь пуста")
            return 0
        print(f"{'DRY-RUN' if a.dry_run else 'ОТПРАВКА'}: записей {len(rows)}")
        for r in rows:
            print(f"  #{r.id} {r.op_date.date()} [{SHEET_TITLES[r.sheet]}] "
                  f"{r.amount} {r.currency} — {r.title[:60]}")
        if a.dry_run:
            return 0

        client = SheetsClient(s.sheets_credentials_file, s.sheets_spreadsheet_id)
        sent = failed = 0
        for r in rows:
            person = None
            if r.sheet == "salary":
                u = db.get(User, r.entity_id)
                person = u.name if u else None
            try:
                line = append_entry(client, r, person=person)
                r.status = "sent"
                r.sent_at = datetime.utcnow()
                r.last_error = None
                sent += 1
                print(f"  #{r.id} → строка {line}")
            except (SheetsError, Exception) as e:  # noqa: B014 — любая ошибка = повтор позже
                r.attempts += 1
                r.last_error = str(e)[:500]
                if r.attempts >= MAX_ATTEMPTS:
                    r.status = "failed"
                failed += 1
                print(f"  #{r.id} ОШИБКА ({r.attempts}/{MAX_ATTEMPTS}): {e}")
            db.commit()
        print(f"отправлено {sent}, ошибок {failed}")
        return 0 if failed == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
