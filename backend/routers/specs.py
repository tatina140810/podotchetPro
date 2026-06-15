from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import EmployeeSpec, User
from schemas import SpecOut, SpecUpsert


router = APIRouter(prefix="/api/specs", tags=["specs"])


@router.get("/{user_id}", response_model=SpecOut)
def get_spec(user_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    target = db.get(User, user_id)
    if not target or target.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
    if me.role not in ("admin", "superadmin") and me.id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")

    spec = db.query(EmployeeSpec).filter(EmployeeSpec.user_id == user_id).first()
    if not spec:
        # Возвращаем дефолт без сохранения
        spec = EmployeeSpec(
            org_id=me.org_id,
            user_id=user_id,
            monthly_limit=0,
            single_limit=0,
            allowed_categories=None,
            requires_receipt=False,
            requires_approval=True,
            notes=None,
        )
        db.add(spec)
        db.commit()
        db.refresh(spec)
    return SpecOut.model_validate(spec)


@router.put("/{user_id}", response_model=SpecOut)
def upsert_spec(
    user_id: int,
    payload: SpecUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.get(User, user_id)
    if not target or target.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")

    spec = db.query(EmployeeSpec).filter(EmployeeSpec.user_id == user_id).first()
    if not spec:
        spec = EmployeeSpec(org_id=admin.org_id, user_id=user_id)
        db.add(spec)

    for field, value in payload.model_dump().items():
        setattr(spec, field, value)
    db.commit()
    db.refresh(spec)
    return SpecOut.model_validate(spec)
