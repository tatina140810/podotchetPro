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
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для администратора")
    return user


# ===================== Расширенные ролевые проверки =====================
# Иерархия прав:
#   admin (техническая суперроль) ⊇ gen_director ⊇ auditor (для просмотра)
#   accountable — обычный подотчётный сотрудник

DIRECTOR_LEVEL_ROLES = ("admin", "gen_director")
DIRECTOR_OR_AUDITOR_ROLES = ("admin", "gen_director", "auditor")


def is_director_level(user: User) -> bool:
    return user.role in DIRECTOR_LEVEL_ROLES


def is_director_or_auditor(user: User) -> bool:
    return user.role in DIRECTOR_OR_AUDITOR_ROLES


def require_director_level(user: User = Depends(get_current_user)) -> User:
    if not is_director_level(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только генеральный директор или admin")
    return user


def require_director_or_auditor(user: User = Depends(get_current_user)) -> User:
    if not is_director_or_auditor(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только директор, аудитор или admin")
    return user


def require_auditor(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("admin", "auditor"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только аудитор или admin")
    return user
