from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import create_access_token, hash_password, verify_password, get_current_user
from database import get_db
from models import ChatMember, ChatRoom, Organization, User, Category
from schemas import LoginRequest, OrgRegister, TokenResponse, UserOut, OrgOut


router = APIRouter(prefix="/api/auth", tags=["auth"])


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

    org = Organization(name=payload.org_name, inn=payload.inn, address=payload.address)
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
        user=UserOut.model_validate(user),
        org=OrgOut.model_validate(org),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)
