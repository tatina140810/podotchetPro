"""Freemium-планы организаций: лимиты и проверки.

Планы: legacy (старые компании — полный доступ навсегда), free, pro, business.
Тип plan в БД — String(16) (как role: в проекте нет нативных DB-enum), значения
ограничены PlanEnum + валидацией. Превышение лимита → HTTP 402 plan_limit_exceeded.
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from fastapi import HTTPException, status

from models import Organization


class PlanEnum(str, Enum):
    legacy = "legacy"
    free = "free"
    pro = "pro"
    business = "business"


PLAN_LIMITS: dict[str, dict] = {
    "free": {
        "max_employees": 1,
        "max_advances_per_month": 20,
        "can_export": False,
        "max_companies": 1,
        "history_months": 3,
    },
    "pro": {
        "max_employees": 10,
        "max_advances_per_month": None,  # безлимит
        "can_export": True,
        "max_companies": 2,
        "history_months": None,
    },
    "business": {
        "max_employees": None,
        "max_advances_per_month": None,
        "can_export": True,
        "max_companies": None,
        "history_months": None,
    },
    "legacy": {
        # полный доступ, никаких ограничений
        "max_employees": None,
        "max_advances_per_month": None,
        "can_export": True,
        "max_companies": None,
        "history_months": None,
    },
}


def _plan_key(org: Organization) -> str:
    return org.plan if org and org.plan in PLAN_LIMITS else "free"


def get_limit(org: Organization, key: str):
    """Значение лимита плана. None = безлимит."""
    return PLAN_LIMITS.get(_plan_key(org), PLAN_LIMITS["free"]).get(key)


def check_limit(org: Organization, key: str, current_value: int) -> bool:
    """True, если ещё можно (current_value < limit) или лимит безлимитный (None)."""
    limit = get_limit(org, key)
    if limit is None:
        return True
    return current_value < limit


def assert_limit(org: Organization, key: str, current_value: int) -> None:
    """Бросает 402, если лимит достигнут/превышен."""
    if not check_limit(org, key, current_value):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail="plan_limit_exceeded")


def assert_can_export(org: Organization) -> None:
    if not get_limit(org, "can_export"):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail="plan_limit_exceeded")


def ensure_can_export(db, user) -> None:
    """Удобный guard для роутов экспорта: грузит org пользователя и проверяет can_export."""
    org = db.get(Organization, user.org_id)
    assert_can_export(org)


def plan_info(org: Organization) -> dict:
    plan = _plan_key(org)
    return {
        "plan": plan,
        "limits": PLAN_LIMITS[plan],
        "plan_activated_at": org.plan_activated_at,
        "plan_expires_at": org.plan_expires_at,
    }


def history_cutoff(org: Organization) -> Optional[datetime]:
    """Самая ранняя дата, которую план разрешает показывать (None = без ограничения).
    history_months задаёт, на сколько месяцев назад доступна история."""
    months = get_limit(org, "history_months")
    if months is None:
        return None
    now = datetime.utcnow()
    total = now.month - months
    year = now.year + (total - 1) // 12 if total <= 0 else now.year
    month = (total - 1) % 12 + 1 if total <= 0 else total
    try:
        return now.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)
    except ValueError:
        return now.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)
