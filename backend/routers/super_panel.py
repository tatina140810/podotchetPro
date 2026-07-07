"""Супер-админ-панель платформы (владелец = is_platform_owner).

Все организации, создание новой (с генерацией доступа владельцу), смена плана,
удаление. Доступ ТОЛЬКО владельцу платформы — НЕ org-уровневому superadmin.
"""
import random
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_platform_owner, hash_password
from database import get_db
from models import Category, ChatMember, ChatRoom, Organization, User
from schemas import PlanUpdate, SuperOrgCreate, SuperOrgCreateOut, SuperOrgItem
from services.plan_limits import PlanEnum
from routers.auth import DEFAULT_CATEGORIES

router = APIRouter(
    prefix="/api/super",
    tags=["super"],
    dependencies=[Depends(require_platform_owner)],
)

_PLANS = [p.value for p in PlanEnum]


def _owner(db: Session, org_id: int) -> Optional[User]:
    return (
        db.query(User)
        .filter(User.org_id == org_id, User.role.in_(("admin", "superadmin", "gen_director")))
        .order_by(User.id)
        .first()
    )


def _item(db: Session, org: Organization, count: Optional[int] = None) -> SuperOrgItem:
    if count is None:
        count = db.query(func.count(User.id)).filter(User.org_id == org.id).scalar() or 0
    adm = _owner(db, org.id)
    return SuperOrgItem(
        id=org.id, name=org.name, plan=org.plan, is_active=org.is_active,
        employees_count=count,
        admin_name=adm.name if adm else None,
        admin_phone=adm.phone if adm else None,
        plan_expires_at=org.plan_expires_at,
    )


@router.get("/orgs", response_model=list[SuperOrgItem])
def list_orgs(db: Session = Depends(get_db)):
    orgs = db.query(Organization).order_by(Organization.id).all()
    counts = dict(db.query(User.org_id, func.count(User.id)).group_by(User.org_id).all())
    return [_item(db, o, counts.get(o.id, 0)) for o in orgs]


@router.post("/orgs", response_model=SuperOrgCreateOut, status_code=status.HTTP_201_CREATED)
def create_org(payload: SuperOrgCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.phone == payload.admin_phone).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Телефон уже зарегистрирован")
    plan = payload.plan or "free"
    if plan not in _PLANS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный план")
    # Пароль: задан вручную или генерим 6 цифр.
    password = payload.admin_password or f"{random.randint(100000, 999999)}"

    org = Organization(name=payload.org_name, plan=plan, plan_activated_at=datetime.utcnow())
    db.add(org)
    db.flush()

    admin = User(
        org_id=org.id,
        name=payload.admin_name or payload.org_name,
        phone=payload.admin_phone,
        password_hash=hash_password(password),
        role="admin",
    )
    db.add(admin)
    for c in DEFAULT_CATEGORIES:
        db.add(Category(org_id=org.id, name=c["name"], icon=c["icon"], color=c["color"]))
    db.flush()
    room = ChatRoom(org_id=org.id, name="Общий чат", room_type="group", created_by_id=admin.id)
    db.add(room)
    db.flush()
    db.add(ChatMember(room_id=room.id, user_id=admin.id))
    db.commit()

    return SuperOrgCreateOut(
        org_id=org.id, org_name=org.name,
        admin_phone=admin.phone, admin_password=password, plan=org.plan,
    )


@router.patch("/orgs/{org_id}/plan", response_model=SuperOrgItem)
def set_plan(org_id: int, payload: PlanUpdate, db: Session = Depends(get_db)):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Организация не найдена")
    if payload.plan not in _PLANS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный план")
    org.plan = payload.plan
    org.plan_activated_at = datetime.utcnow()
    db.commit()
    db.refresh(org)
    return _item(db, org)


@router.delete("/orgs/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_org(org_id: int, db: Session = Depends(get_db), me: User = Depends(require_platform_owner)):
    if org_id == me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить свою организацию")
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Организация не найдена")
    db.delete(org)
    db.commit()
    return None
