import re
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import storage
from ..audit import record
from ..config import settings
from ..constants import CONTENT_TYPES, DOCUMENT_TYPES, FILE_TYPES, RASTER_TYPES
from ..db import get_db
from ..models import Document, User
from ..schemas import RegisterUploadIn, UploadPermitIn
from ..security import current_user
from ..services.visualization import plan_page_count, render_page_png
from .common import get_owned, get_project, row_dict, stored_file_response

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])

# A rendered page never changes: a document's id is fixed to one uploaded revision.
RENDERED_PAGE_CACHE = "private, max-age=86400"
_UPLOAD_PATHNAME = re.compile(r"uploads/([0-9a-f-]{36})/[0-9a-f-]{36}\.([a-z0-9]+)")


def _public(document: Document) -> dict:
    data = row_dict(document, exclude=("storage_key",))
    data["viewable"] = document.file_type in RASTER_TYPES
    return data


def _clean_name(raw: str | None) -> tuple[str, str]:
    """The base name and lowercase extension. A client may send a whole path as a name."""
    file_name = PurePosixPath((raw or "").replace("\\", "/")).name
    return file_name, file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""


def _check_upload(document_type: str, extension: str) -> None:
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(422, "סוג מסמך לא מוכר")
    if extension not in FILE_TYPES:
        raise HTTPException(422, f"סוג קובץ לא נתמך. מותר: {', '.join(FILE_TYPES)}")


def _store_document(
    db: Session,
    user: User,
    project_id: str,
    file_name: str,
    extension: str,
    document_type: str,
    key: str,
) -> dict:
    """Validates a file already in storage and records it as the next revision."""
    try:
        with storage.local_copy(key) as path:
            page_count = plan_page_count(path, extension)
    except ValueError as error:
        storage.delete(key)
        raise HTTPException(422, str(error)) from error

    same_document = (
        Document.project_id == project_id,
        Document.file_name == file_name,
        Document.document_type == document_type,
    )
    previous = db.scalar(select(func.max(Document.revision)).where(*same_document))
    if previous:
        for row in db.scalars(select(Document).where(*same_document)):
            row.status = "SUPERSEDED"

    document = Document(
        project_id=project_id,
        file_name=file_name,
        file_type=extension,
        document_type=document_type,
        revision=(previous or 0) + 1,
        uploaded_by=user.id,
        page_count=page_count,
        storage_key=key,
    )
    db.add(document)
    db.flush()
    record(db, user, project_id, "document", document.id, "uploaded", None, f"{file_name} rev {document.revision}")
    db.commit()
    return _public(document)


@router.get("")
def list_documents(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Document).where(Document.project_id == project_id).order_by(Document.file_name, Document.revision.desc())
    )
    return [_public(row) for row in rows]


@router.post("", status_code=201)
def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Through the API itself: local development. Deployed, a function takes at most 4.5 MB."""
    get_project(db, project_id)
    file_name, extension = _clean_name(file.filename)
    _check_upload(document_type, extension)
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"הקובץ גדול מ-{settings.elf_max_upload_mb} MB")
    if not data:
        raise HTTPException(422, "הקובץ ריק")
    key = storage.save(data, f".{extension}", prefix=f"uploads/{project_id}")
    return _store_document(db, user, project_id, file_name, extension, document_type, key)


def _pathname_extension(project_id: str, pathname: str) -> str:
    """Accepts only the shape the browser is told to use, inside this project."""
    match = _UPLOAD_PATHNAME.fullmatch(pathname)
    if match is None or match.group(1) != project_id or match.group(2) not in FILE_TYPES:
        raise HTTPException(422, "נתיב העלאה לא תקין")
    return match.group(2)


@router.post("/upload-permit")
def upload_permit(project_id: str, body: UploadPermitIn, _: User = Depends(current_user), db: Session = Depends(get_db)):
    """What the signing route may allow for one direct upload. The rules stay on this side."""
    get_project(db, project_id)
    extension = _pathname_extension(project_id, body.pathname)
    return {"content_type": CONTENT_TYPES[extension], "max_bytes": settings.max_upload_bytes}


@router.post("/register", status_code=201)
def register_upload(project_id: str, body: RegisterUploadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Records a file the browser already put in storage. Nothing about it is taken on trust."""
    get_project(db, project_id)
    extension = _pathname_extension(project_id, body.pathname)
    file_name, name_extension = _clean_name(body.file_name)
    _check_upload(body.document_type, name_extension)
    # A signed upload must carry the type of its name, but a jpeg may arrive as either spelling.
    if CONTENT_TYPES[name_extension] != CONTENT_TYPES[extension]:
        raise HTTPException(422, "סוג הקובץ לא תואם לשמו")
    if db.scalar(select(Document.id).where(Document.storage_key == body.pathname)):
        raise HTTPException(409, "הקובץ כבר נרשם")
    size = storage.size(body.pathname)
    if size is None:
        raise HTTPException(422, "הקובץ לא נמצא באחסון")
    if size > settings.max_upload_bytes:
        storage.delete(body.pathname)
        raise HTTPException(413, f"הקובץ גדול מ-{settings.elf_max_upload_mb} MB")
    return _store_document(db, user, project_id, file_name, name_extension, body.document_type, body.pathname)


@router.get("/{document_id}/file")
def download(project_id: str, document_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    document = get_owned(db, Document, document_id, project_id, "המסמך")
    return stored_file_response(document.storage_key, CONTENT_TYPES[document.file_type], document.file_name)


@router.get("/{document_id}/pages/{page}.png")
def page_image(project_id: str, document_id: str, page: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    document = get_owned(db, Document, document_id, project_id, "המסמך")
    if document.file_type not in RASTER_TYPES:
        raise HTTPException(422, "סוג קובץ זה נשמר אך עדיין לא ניתן להצגה")
    if page < 0 or page >= document.page_count:
        raise HTTPException(404, "העמוד לא נמצא")
    return stored_file_response(render_page_png(document, page), "image/png", cache_control=RENDERED_PAGE_CACHE)
