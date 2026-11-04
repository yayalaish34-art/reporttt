from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

COOKIE_NAME = "elf_token"
ROLES = ("ENGINEER", "APPROVER", "ADMIN")
# Only people in these roles may sign off a report or put a regulation rule in force.
APPROVAL_ROLES = ("APPROVER", "ADMIN")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=settings.elf_token_hours)
    return jwt.encode({"sub": user.id, "exp": expires}, settings.elf_jwt_secret, algorithm="HS256")


def current_user(elf_token: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> User:
    if not elf_token:
        raise HTTPException(401, "נדרשת התחברות")
    try:
        payload = jwt.decode(elf_token, settings.elf_jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise HTTPException(401, "נדרשת התחברות") from error
    user = db.get(User, payload.get("sub"))
    if user is None or not user.active:
        raise HTTPException(401, "נדרשת התחברות")
    return user


def approver_user(user: User = Depends(current_user)) -> User:
    if user.role not in APPROVAL_ROLES:
        raise HTTPException(403, "פעולה זו מותרת לבעל הרשאת אישור בלבד")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(403, "פעולה זו מותרת למנהל מערכת בלבד")
    return user
