"""Настройки организации — фич-тумблеры (страница суперадмина).

  - GET  /api/settings — любой авторизованный (UI прячет/показывает фичи по флагам).
  - PUT  /api/settings — только superadmin (меняет тумблеры).

Значения хранятся в Organization.feature_flags (JSON). Реестр фич и дефолты —
в services/feature_flags.py (единый источник правды).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_user
from database import get_db
from models import Organization, User
from schemas import SettingsOut, SettingsUpdate
from services.feature_flags import FLAG_KEYS, definitions, merged_flags


router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    org = db.get(Organization, me.org_id)
    stored = org.feature_flags if org else None
    return SettingsOut(flags=merged_flags(stored), definitions=definitions())


@router.put("", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    if me.role != "superadmin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Настройки меняет только суперадмин")

    unknown = set(payload.flags) - FLAG_KEYS
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Неизвестные фичи: {', '.join(sorted(unknown))}",
        )

    org = db.get(Organization, me.org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Организация не найдена")

    # Сливаем поверх текущих значений (частичное обновление).
    current = dict(org.feature_flags or {})
    for k, v in payload.flags.items():
        current[k] = bool(v)
    org.feature_flags = current
    flag_modified(org, "feature_flags")  # JSON-поле меняется in-place — помечаем dirty
    db.commit()

    return SettingsOut(flags=merged_flags(org.feature_flags), definitions=definitions())
