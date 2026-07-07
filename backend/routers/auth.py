from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import create_access_token, hash_password, verify_password, get_current_user, require_director_level
from database import get_db
from models import ChatMember, ChatRoom, Organization, User, Category
from schemas import LoginRequest, OrgRegister, TokenResponse, UserOut, OrgOut
from services.permissions import owned_active_workspace


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out_with_workspace(db: Session, user: User) -> UserOut:
    """UserOut + поля проектного пространства (для режима изоляции владельца)."""
    out = UserOut.model_validate(user)
    ws = owned_active_workspace(db, user.id, user.org_id)
    if ws:
        out.workspace_owner = True
        out.workspace_id = ws.id
        out.workspace_name = ws.name
    return out


DEFAULT_CATEGORIES = [
    {"name": "Транспорт", "icon": "car", "color": "#6c5ce7"},
    {"name": "Питание", "icon": "utensils", "color": "#00b894"},
    {"name": "Проживание", "icon": "bed", "color": "#fdcb6e"},
    {"name": "Закупки", "icon": "cart", "color": "#0984e3"},
    {"name": "Хоз.расходы", "icon": "tools", "color": "#e17055"},
    {"name": "Связь", "icon": "phone", "color": "#a29bfe"},
    {"name": "Канцелярия", "icon": "pen", "color": "#74b9ff"},
    {"name": "Другое", "icon": "dots", "color": "#636e72"},
]


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_org(payload: OrgRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.phone == payload.admin_phone).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Телефон уже зарегистрирован")

    # Новые компании всегда стартуют на free (plan из тела запроса НЕ принимаем).
    org = Organization(
        name=payload.org_name,
        inn=payload.inn,
        address=payload.address,
        plan="free",
        plan_activated_at=datetime.utcnow(),
    )
    db.add(org)
    db.flush()

    admin = User(
        org_id=org.id,
        name=payload.admin_name,
        phone=payload.admin_phone,
        email=payload.admin_email,
        password_hash=hash_password(payload.admin_password),
        role="admin",
    )
    db.add(admin)

    for c in DEFAULT_CATEGORIES:
        db.add(Category(org_id=org.id, name=c["name"], icon=c["icon"], color=c["color"]))

    # Дефолтная комната "Общий чат" с админом внутри.
    db.flush()  # нужен admin.id
    general_room = ChatRoom(
        org_id=org.id,
        name="Общий чат",
        room_type="group",
        created_by_id=admin.id,
    )
    db.add(general_room)
    db.flush()
    db.add(ChatMember(room_id=general_room.id, user_id=admin.id))

    db.commit()
    db.refresh(admin)
    db.refresh(org)

    token = create_access_token(admin.id, org.id, admin.role)
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(admin),
        org=OrgOut.model_validate(org),
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == payload.phone).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный телефон или пароль")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Пользователь отключен")

    org = db.get(Organization, user.org_id)
    token = create_access_token(user.id, user.org_id, user.role)
    return TokenResponse(
        access_token=token,
        user=_user_out_with_workspace(db, user),
        org=OrgOut.model_validate(org),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_out_with_workspace(db, user)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(user: User = Depends(require_director_level), db: Session = Depends(get_db)):
    """Удаление организации (App Store Guideline 5.1.1(v) / право на удаление данных).

    ТОЛЬКО владелец-уровень (admin/gen_director/superadmin): удаляет организацию СО
    ВСЕМИ данными (каскад по org_id). Рядовой сотрудник (accountable/auditor) сделать
    это НЕ может — иначе любой работник стёр бы данные всей компании. Действие
    необратимо. Все FK с org_id — ondelete=CASCADE, поэтому удаление чистое."""
    org = db.get(Organization, user.org_id)
    if org:
        db.delete(org)
        db.commit()
    return None
