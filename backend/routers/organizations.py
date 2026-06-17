"""Организации — план (freemium). Создание организации — в /api/auth/register."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Organization, User
from schemas import PlanInfo
from services.plan_limits import plan_info


router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("/{org_id}/plan", response_model=PlanInfo)
def get_plan(
    org_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    # Видеть план может только член этой организации (или суперадмин — он всё равно в своей org).
    if org_id != me.org_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к организации")
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Организация не найдена")
    return PlanInfo(**plan_info(org))
