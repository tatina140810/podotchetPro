from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models import User


settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int, org_id: int, role: str) -> str:
    expire = datetime.now(tz=timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "org_id": org_id,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Невалидный токен") from e


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен токен")
    payload = decode_token(token)
    user_id = int(payload.get("sub", 0))
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден или отключен")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для администратора")
    return user


def require_platform_owner(user: User = Depends(get_current_user)) -> User:
    """Владелец платформы (супер-админ-панель: все организации, создание/удаление,
    смена плана). Это флаг is_platform_owner, НЕ роль superadmin (та org-уровневая)."""
    if not user.is_platform_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для владельца платформы")
    return user


# ===================== Расширенные ролевые проверки =====================
# Иерархия прав:
#   superadmin (Татина) ⊇ admin ⊇ gen_director ⊇ auditor (для просмотра)
#   accountable — обычный подотчётный сотрудник
# superadmin — техническая суперроль над всем; добавлена во все списки наравне с admin.

ADMIN_ROLES = ("admin", "superadmin")
DIRECTOR_LEVEL_ROLES = ("admin", "gen_director", "superadmin")
DIRECTOR_OR_AUDITOR_ROLES = ("admin", "gen_director", "auditor", "superadmin")
# Кто видит конфиденциальных сотрудников (Фича 2): superadmin и gen_director.
# admin/auditor сюда НЕ входят (видят меньше, чем по обычным правам).
CONFIDENTIAL_VIEWER_ROLES = ("superadmin", "gen_director")


def is_director_level(user: User) -> bool:
    return user.role in DIRECTOR_LEVEL_ROLES


def is_director_or_auditor(user: User) -> bool:
    return user.role in DIRECTOR_OR_AUDITOR_ROLES


def can_see_confidential(user: User) -> bool:
    """Роль видит данные конфиденциальных сотрудников целиком (Фича 2).
    Сам конфиденциальный сотрудник видит себя — это проверяется в эндпоинтах
    отдельно (через me.id), здесь только роль."""
    return user.role in CONFIDENTIAL_VIEWER_ROLES


def require_director_level(user: User = Depends(get_current_user)) -> User:
    if not is_director_level(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только генеральный директор или admin")
    return user


def require_director_or_auditor(user: User = Depends(get_current_user)) -> User:
    if not is_director_or_auditor(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только директор, аудитор или admin")
    return user


# ===================== Личные подразделения и личные отчёты =====================
# Сотрудник с флагом can_create_departments заводит СВОИ подразделения
# (departments.owner_id = его id) — их видит только он и роли оверсайта ниже.
# Сотрудник с флагом can_view_own_reports открывает отчёты «по категориям» и
# «по подразделениям», построенные ТОЛЬКО по его расходам.
# Личные подразделения скрыты от других РЯДОВЫХ СОТРУДНИКОВ (accountable).
# Директор/админ/аудитор их видят: иначе расходы в этих подразделениях пришлось бы
# вырезать из общих отчётов, и суммы организации перестали бы сходиться.


def can_see_personal_departments(user: User) -> bool:
    """Роль видит ЛИЧНЫЕ подразделения всех сотрудников (директор/админ/аудитор)."""
    return is_director_or_auditor(user)


def can_view_reports(user: User) -> bool:
    """Есть ли доступ к отчётам «по категориям» / «по подразделениям».
    Директор/аудитор — по всей организации; сотрудник с флагом — только по своим
    расходам (срез накладывается в services.permissions.personal_report_user_id)."""
    return is_director_or_auditor(user) or bool(user.can_view_own_reports)


def require_reports_access(user: User = Depends(get_current_user)) -> User:
    if not can_view_reports(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к отчётам")
    return user


def can_bulk_import(user: User) -> bool:
    """Доступ к «Импорту истории». admin/superadmin — полный (все типы операций,
    за любого сотрудника). Сотрудник с флагом can_bulk_import — урезанный: только
    свои расходы (ограничения накладывает routers/admin._enforce_self_import)."""
    return user.role in ADMIN_ROLES or bool(user.can_bulk_import)


def require_bulk_import(user: User = Depends(get_current_user)) -> User:
    if not can_bulk_import(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к импорту истории")
    return user


def require_auditor(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("admin", "auditor", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только аудитор или admin")
    return user


# ===================== Проектные пространства =====================
# Управлять (создавать/редактировать/удалять) пространствами и видеть их детали
# целиком могут superadmin и gen_director — те же роли, что видят конфиденциальных.
WORKSPACE_MANAGER_ROLES = ("superadmin", "gen_director")


def can_manage_workspaces(user: User) -> bool:
    """Создание/редактирование/удаление пространств и их участников."""
    return user.role in WORKSPACE_MANAGER_ROLES


def can_view_workspace_aggregate(user: User) -> bool:
    """admin/auditor видят только финансовый агрегат по владельцу пространства
    (получено/потрачено/остаток), без построчной детализации."""
    return user.role in ("admin", "auditor")


def require_workspace_manager(user: User = Depends(get_current_user)) -> User:
    if not can_manage_workspaces(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Управлять проектными пространствами может только директор или суперадмин",
        )
    return user
