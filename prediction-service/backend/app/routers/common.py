from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import storage
from ..models import Project


def get_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "הפרויקט לא נמצא")
    return project


def get_owned(db: Session, model, row_id: str, project_id: str, label: str = "הפריט"):
    """A row addressed through a project must belong to that project."""
    row = db.get(model, row_id)
    if row is None or row.project_id != project_id:
        raise HTTPException(404, f"{label} לא נמצא")
    return row


def stored_file_response(
    key: str,
    media_type: str,
    download_name: str | None = None,
    cache_control: str = "private, no-store",
) -> StreamingResponse:
    """Streamed, because a function may not return more than 4.5 MB in one piece."""
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": cache_control}
    if download_name:
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(download_name)}"
    return StreamingResponse(storage.stream(key), media_type=media_type, headers=headers)


def row_dict(row, exclude: tuple[str, ...] = ()) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns if c.name not in exclude}
