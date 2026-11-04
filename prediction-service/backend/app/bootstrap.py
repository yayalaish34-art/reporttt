"""What a fresh database needs: the first admin and the inactive rule candidates.

Safe to run repeatedly. It runs at deployment rather than at startup because every cold
start would race to insert the same rows.
"""

from sqlalchemy import func, select

from .config import settings
from .db import SessionLocal
from .models import User
from .security import hash_password
from .services.regulation_rules import seed_candidates


def bootstrap() -> None:
    with SessionLocal() as db:
        # The first admin comes from the environment, and only into an empty user table.
        if settings.elf_admin_email and settings.elf_admin_password:
            if not db.scalar(select(func.count()).select_from(User)):
                db.add(
                    User(
                        email=settings.elf_admin_email.strip().lower(),
                        full_name="Admin",
                        password_hash=hash_password(settings.elf_admin_password),
                        role="ADMIN",
                    )
                )
                db.commit()
        seed_candidates(db)


if __name__ == "__main__":
    bootstrap()
