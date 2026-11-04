import json

from sqlalchemy.orm import Session

from .models import AuditLog, Project, User


def _text(value) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)


def record(
    db: Session,
    user: User | None,
    project_id: str | None,
    entity: str,
    entity_id: str,
    field: str,
    old,
    new,
    reason: str = "",
) -> None:
    db.add(
        AuditLog(
            project_id=project_id,
            user_id=user.id if user else None,
            user_email=user.email if user else "system",
            entity=entity,
            entity_id=entity_id,
            field=field,
            old_value=_text(old),
            new_value=_text(new),
            reason=reason,
        )
    )


def invalidate_verification(db: Session, user: User, project_id: str, why: str) -> None:
    """Any change to the model voids its MODEL VERIFIED sign-off."""
    project = db.get(Project, project_id)
    if project and project.model_verified:
        project.model_verified = False
        project.model_verified_by = None
        project.model_verified_at = None
        record(db, user, project_id, "project", project_id, "model_verified", True, False, why)
