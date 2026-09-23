"""Выгрузка операций в Google-таблицу «Локомотив».

Две половины:
1. `enqueue_*` — ставит операцию в очередь `sheets_outbox` В ТОЙ ЖЕ транзакции, что
   и сама запись (никаких сетевых вызовов внутри транзакции БД);
2. `SheetsClient` + `flush_outbox` — воркер: добавляет строки в листы «Банк» (безнал),
   «Нал» (наличные), «Зарплата сотрудников» и обновляет формулу ИТОГО.

Правила, заданные Тати:
- существующие строки таблицы не переписываются — только добавляются новые, в той же
  форме (Дата | Описание | Сумма);
- новая строка вставляется ПЕРЕД строкой «ИТОГО», чтобы итог оставался внизу;
- итог должен быть точным: диапазон формулы ИТОГО расширяется на добавленную строку.

Авторизация — сервисный аккаунт (JWT → OAuth token) без новых зависимостей:
подпись через python-jose, запросы через requests.
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from decimal import Decimal
from typing import Optional

import requests
from jose import jwt
from sqlalchemy.orm import Session

from config import get_settings
from models import SheetsOutbox

# Листы таблицы. Ключ — значение sheets_outbox.sheet.
SHEET_TITLES = {
    "bank": "Банк",
    "cash": "Нал",
    "salary": "Зарплата сотрудников",
}

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
_API = "https://sheets.googleapis.com/v4/spreadsheets"


# ===================== Постановка в очередь =====================

def _sheet_for(payment_method: Optional[str]) -> Optional[str]:
    """Лист по форме расчёта. None — операция не выгружается (форма не указана)."""
    if payment_method == "bank":
        return "bank"
    if payment_method == "cash":
        return "cash"
    return None


def enqueue_operation(
    db: Session,
    *,
    org_id: int,
    entity_type: str,
    entity_id: int,
    department_id: Optional[int],
    payment_method: Optional[str],
    op_date: datetime,
    title: str,
    amount: Decimal,
    currency: str,
) -> Optional[SheetsOutbox]:
    """Ставит операцию в очередь выгрузки, если она подпадает под настройки.

    Возвращает созданную запись или None (выгрузка выключена / другое подразделение /
    форма расчёта не указана). Валюту НЕ фильтруем здесь: запись с чужой валютой
    попадает в очередь со статусом skipped, чтобы расхождение было видно, а не молча
    исчезало."""
    s = get_settings()
    if not s.sheets_sync_enabled or not s.sheets_spreadsheet_id:
        return None
    dep_ids = s.sheets_department_id_list
    if not dep_ids or department_id not in dep_ids:
        return None
    sheet = _sheet_for(payment_method)
    if sheet is None:
        return None
    status = "pending" if (currency or "").upper() == s.sheets_currency.upper() else "skipped"
    row = SheetsOutbox(
        org_id=org_id,
        entity_type=entity_type,
        entity_id=entity_id,
        sheet=sheet,
        op_date=op_date,
        title=(title or "").strip() or "—",
        amount=amount,
        currency=currency,
        status=status,
        last_error=None if status == "pending"
        else f"валюта {currency} ≠ {s.sheets_currency} — в таблицу не выгружается",
    )
    db.add(row)
    return row


# ===================== Клиент Google Sheets =====================

class SheetsError(RuntimeError):
    pass


class SheetsClient:
    """Минимальный клиент Sheets API на сервисном аккаунте (без google-api-client)."""

    def __init__(self, credentials_file: str, spreadsheet_id: str, timeout: int = 30):
        with open(credentials_file, "r", encoding="utf-8") as f:
            self._sa = json.load(f)
        self.spreadsheet_id = spreadsheet_id
        self.timeout = timeout
        self._token: Optional[str] = None
        self._token_exp = 0.0

    # ---- авторизация ----
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": self._sa["client_email"],
                "scope": _SCOPE,
                "aud": _TOKEN_URL,
                "iat": now,
                "exp": now + 3600,
            },
            self._sa["private_key"],
            algorithm="RS256",
        )
        r = requests.post(
            _TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
            timeout=self.timeout,
        )
        if r.status_code != 200:
            raise SheetsError(f"не получен токен Google: {r.status_code} {r.text[:200]}")
        payload = r.json()
        self._token = payload["access_token"]
        self._token_exp = time.time() + int(payload.get("expires_in", 3600))
        return self._token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._access_token()}"}

    # ---- чтение/запись ----
    def sheet_id(self, title: str) -> int:
        r = requests.get(
            f"{_API}/{self.spreadsheet_id}?fields=sheets.properties",
            headers=self._headers(), timeout=self.timeout,
        )
        if r.status_code != 200:
            raise SheetsError(f"не читается структура таблицы: {r.status_code} {r.text[:200]}")
        for sh in r.json().get("sheets", []):
            props = sh["properties"]
            if props["title"] == title:
                return props["sheetId"]
        raise SheetsError(f"лист «{title}» не найден")

    def get_values(self, rng: str, render: str = "FORMATTED_VALUE") -> list[list]:
        r = requests.get(
            f"{_API}/{self.spreadsheet_id}/values/{requests.utils.quote(rng)}",
            params={"valueRenderOption": render},
            headers=self._headers(), timeout=self.timeout,
        )
        if r.status_code != 200:
            raise SheetsError(f"не читается диапазон {rng}: {r.status_code} {r.text[:200]}")
        return r.json().get("values", [])

    def insert_row(self, sheet_title: str, at_row: int) -> None:
        """Вставляет ПУСТУЮ строку перед строкой at_row (1-based). Существующие
        строки не переписываются — они просто сдвигаются вниз."""
        body = {"requests": [{"insertDimension": {
            "range": {
                "sheetId": self.sheet_id(sheet_title),
                "dimension": "ROWS",
                "startIndex": at_row - 1,
                "endIndex": at_row,
            },
            "inheritFromBefore": True,
        }}]}
        r = requests.post(
            f"{_API}/{self.spreadsheet_id}:batchUpdate",
            headers={**self._headers(), "Content-Type": "application/json"},
            data=json.dumps(body), timeout=self.timeout,
        )
        if r.status_code != 200:
            raise SheetsError(f"не вставлена строка: {r.status_code} {r.text[:200]}")

    def update_values(self, rng: str, values: list[list]) -> None:
        r = requests.put(
            f"{_API}/{self.spreadsheet_id}/values/{requests.utils.quote(rng)}",
            params={"valueInputOption": "USER_ENTERED"},
            headers={**self._headers(), "Content-Type": "application/json"},
            data=json.dumps({"values": values}), timeout=self.timeout,
        )
        if r.status_code != 200:
            raise SheetsError(f"не записан диапазон {rng}: {r.status_code} {r.text[:200]}")


# ===================== Разбор листа и сборка строки =====================

import re  # noqa: E402  (рядом с использованием — файл читается сверху вниз как история)

_RANGE_RE = re.compile(r"(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)")

# В какие колонки пишем строку операции на каждом листе.
# «Банк»/«Нал»: Дата | Описание | Сумма. «Зарплата сотрудников»: ФИО | Описание | Дата | Сумма.
SHEET_COLUMNS = {"bank": "A:C", "cash": "A:C", "salary": "A:D"}


def find_total_row(rows: list[list]) -> Optional[int]:
    """Номер (1-based) строки «ИТОГО» — по колонке A или B. None — не найдена."""
    for idx, row in enumerate(rows, start=1):
        for cell in row[:2]:
            if isinstance(cell, str) and cell.strip().upper().startswith("ИТОГО"):
                return idx
    return None


def bump_formula_range(formula: str, new_last_row: int) -> str:
    """Расширяет диапазоны формулы ИТОГО до new_last_row (C2:C61 → C2:C62).

    Мы не переписываем формулу своей — только сдвигаем её нижнюю границу, чтобы
    добавленная строка попала в итог. Формула без диапазонов возвращается как есть."""
    def repl(m: re.Match) -> str:
        start_col, start_row, end_col, _end_row = m.groups()
        return f"{start_col}{start_row}:{end_col}{new_last_row}"
    return _RANGE_RE.sub(repl, formula)


def format_date(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y")


def build_row_values(entry: SheetsOutbox, *, person: Optional[str] = None) -> list:
    """Значения строки в том же виде, как уже записаны в листе.

    Сумма пишется числом (не текстом) — формат ячейки наследуется от строки выше
    (insertDimension с inheritFromBefore), а формула ИТОГО одинаково считает и то и то."""
    amount = float(Decimal(str(entry.amount)))
    if entry.sheet == "salary":
        return [person or entry.title, entry.title, format_date(entry.op_date), amount]
    return [format_date(entry.op_date), entry.title, amount]


def append_entry(client: SheetsClient, entry: SheetsOutbox, *, person: Optional[str] = None) -> int:
    """Добавляет строку операции на нужный лист ПЕРЕД строкой ИТОГО и расширяет
    диапазон формулы итога. Возвращает номер строки, куда записали."""
    title = SHEET_TITLES[entry.sheet]
    cols = SHEET_COLUMNS[entry.sheet]
    first_col, last_col = cols.split(":")

    rows = client.get_values(f"{title}!{first_col}1:{last_col}1000")
    total_row = find_total_row(rows)
    if total_row is None:
        raise SheetsError(f"на листе «{title}» не найдена строка ИТОГО — вставлять некуда")

    # Формулу итога читаем ДО вставки (после неё строка сдвинется вниз).
    total_formulas = client.get_values(
        f"{title}!{first_col}{total_row}:{last_col}{total_row}", render="FORMULA"
    )
    formula_row = total_formulas[0] if total_formulas else []

    client.insert_row(title, total_row)
    client.update_values(
        f"{title}!{first_col}{total_row}:{last_col}{total_row}",
        [build_row_values(entry, person=person)],
    )

    # Итог уехал на строку ниже; расширяем его диапазон на только что добавленную строку.
    new_total_row = total_row + 1
    updated = []
    for cell in formula_row:
        if isinstance(cell, str) and cell.startswith("="):
            updated.append(bump_formula_range(cell, total_row))
        else:
            updated.append(cell)
    if updated and any(isinstance(c, str) and c.startswith("=") for c in updated):
        client.update_values(
            f"{title}!{first_col}{new_total_row}:{last_col}{new_total_row}", [updated]
        )
    return total_row


# ===================== Удобные обёртки под конкретные модели =====================

def enqueue_expense(db: Session, e) -> Optional[SheetsOutbox]:
    """Расход → лист «Банк»/«Нал». Заголовок строки — описание, иначе категория."""
    title = (e.description or "").strip() or (e.category.name if e.category else "Расход")
    return enqueue_operation(
        db, org_id=e.org_id, entity_type="expense", entity_id=e.id,
        department_id=e.department_id, payment_method=e.payment_method,
        op_date=e.spent_at, title=title, amount=e.amount, currency=e.currency,
    )


def enqueue_income(db: Session, inc) -> Optional[SheetsOutbox]:
    title = (inc.description or "").strip() or f"Приход: {inc.source}"
    return enqueue_operation(
        db, org_id=inc.org_id, entity_type="income", entity_id=inc.id,
        department_id=inc.department_id, payment_method=inc.payment_method,
        op_date=inc.date, title=title, amount=inc.amount, currency=inc.currency,
    )


def enqueue_topup(db: Session, t) -> Optional[SheetsOutbox]:
    title = (t.note or "").strip() or "Выдача"
    return enqueue_operation(
        db, org_id=t.org_id, entity_type="topup", entity_id=t.id,
        department_id=t.department_id, payment_method=t.payment_method,
        op_date=t.date, title=title, amount=t.amount, currency=t.currency,
    )
