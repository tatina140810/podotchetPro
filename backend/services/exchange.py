"""Получение текущего курса валют из таблицы exchange_rates.
Берётся последняя запись по date для пары (from, to)."""
import logging
from decimal import Decimal, InvalidOperation
from typing import Optional
from xml.etree import ElementTree as ET

import requests
from sqlalchemy.orm import Session

from models import ExchangeRate


logger = logging.getLogger("podotchet.exchange")


def get_current_rate(
    db: Session, org_id: int, from_currency: str, to_currency: str
) -> Optional[Decimal]:
    """Возвращает rate или None если не установлен.
    Случай from == to возвращает 1 (без обращения к БД)."""
    if from_currency == to_currency:
        return Decimal("1")
    row = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.org_id == org_id,
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
        )
        .order_by(ExchangeRate.date.desc())
        .first()
    )
    if row is None:
        return None
    return Decimal(str(row.rate))


# ===================== Парсинг курса НБКР =====================
# Источник: https://www.nbkr.kg/XML/daily.xml — открытый XML с курсами на сегодня.
# Структура (примерно):
#   <CurrencyRates Date="dd.mm.yyyy">
#     <Currency ISOCode="USD"><Value>86.5</Value><Nominal>1</Nominal></Currency>
#     ...
#   </CurrencyRates>
# Value = сколько KGS за Nominal единиц валюты. Для USD nominal=1, значит value = курс напрямую.

NBKR_XML_URL = "https://www.nbkr.kg/XML/daily.xml"


def _parse_nbkr_currency(cur_el) -> Optional[Decimal]:
    """Достаёт rate из элемента <Currency>. Делит Value на Nominal (для RUB nominal=10 обычно)."""
    value_el = cur_el.find("Value")
    nominal_el = cur_el.find("Nominal")
    if value_el is None or value_el.text is None:
        return None
    try:
        value = Decimal(value_el.text.replace(",", ".").strip())
        nominal = Decimal(
            (nominal_el.text or "1").replace(",", ".").strip()
        ) if nominal_el is not None else Decimal("1")
        if nominal <= 0:
            return None
        return value / nominal
    except (InvalidOperation, AttributeError):
        return None


def _fetch_nbkr_xml() -> Optional[ET.Element]:
    try:
        resp = requests.get(NBKR_XML_URL, timeout=10)
        resp.raise_for_status()
        return ET.fromstring(resp.content)
    except (requests.RequestException, ET.ParseError) as e:
        logger.warning("NBKR fetch/parse failed: %s", e)
        return None


def fetch_nbkr_rate(iso_code: str = "USD") -> Optional[Decimal]:
    """Возвращает курс iso_code/KGS с сайта НБКР или None при ошибке."""
    root = _fetch_nbkr_xml()
    if root is None:
        return None
    for cur in root.findall("Currency"):
        if cur.attrib.get("ISOCode") == iso_code:
            r = _parse_nbkr_currency(cur)
            if r is None:
                logger.warning("NBKR rate parse failed for %s", iso_code)
            return r
    logger.warning("NBKR XML: currency %s not found", iso_code)
    return None


def fetch_nbkr_rates(iso_codes: list[str]) -> dict[str, Decimal]:
    """Одним запросом — несколько пар iso/KGS. Возвращает {ISO: Decimal} только для удачных."""
    root = _fetch_nbkr_xml()
    if root is None:
        return {}
    wanted = set(iso_codes)
    out: dict[str, Decimal] = {}
    for cur in root.findall("Currency"):
        iso = cur.attrib.get("ISOCode")
        if iso in wanted:
            r = _parse_nbkr_currency(cur)
            if r is not None:
                out[iso] = r
    return out
