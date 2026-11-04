from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import record
from ..constants import BUILDING_TYPES
from ..db import get_db
from ..models import Assumption, AuditLog, Project, User, utcnow
from ..schemas import AssumptionIn, ProjectIn, ProjectPatch, VerifyIn
from ..security import current_user
from ..services.questions import project_questions
from ..services.readiness import project_blockers
from .common import get_project, row_dict

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return [row_dict(p) for p in db.scalars(select(Project).order_by(Project.created_at.desc()))]


@router.post("", status_code=201)
def create_project(body: ProjectIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = Project(**body.model_dump(), created_by=user.id)
    db.add(project)
    db.flush()
    record(db, user, project.id, "project", project.id, "created", None, project.project_name)
    db.commit()
    return row_dict(project)


@router.get("/{project_id}")
def read_project(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return row_dict(get_project(db, project_id))


@router.patch("/{project_id}")
def update_project(project_id: str, body: ProjectPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    for field, value in changes.items():
        if getattr(project, field) != value:
            record(db, user, project.id, "project", project.id, field, getattr(project, field), value, body.reason)
            setattr(project, field, value)
    db.commit()
    return row_dict(project)


@router.get("/{project_id}/readiness")
def readiness(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    blockers = project_blockers(db, get_project(db, project_id))
    return {"ready": not blockers, "blockers": blockers}


@router.get("/{project_id}/questions")
def questions(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return project_questions(db, get_project(db, project_id))


@router.post("/{project_id}/verify-model")
def verify_model(project_id: str, body: VerifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    if body.verified:
        structural = [
            b
            for b in project_blockers(db, project)
            if b["code"] in ("NO_FLOORS", "NO_ROOMS", "NO_SOURCES", "FLOOR_CALIBRATION", "SOURCE_LOCATION", "LOW_CONFIDENCE")
        ]
        if structural:
            raise HTTPException(409, {"message": "לא ניתן לאשר את המודל", "blockers": structural})
    record(db, user, project.id, "project", project.id, "model_verified", project.model_verified, body.verified, body.reason)
    project.model_verified = body.verified
    project.model_verified_by = user.id if body.verified else None
    project.model_verified_at = utcnow() if body.verified else None
    db.commit()
    return row_dict(project)


@router.get("/{project_id}/assumptions")
def list_assumptions(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return [row_dict(a) for a in db.scalars(select(Assumption).where(Assumption.project_id == project_id))]


@router.post("/{project_id}/assumptions", status_code=201)
def add_assumption(project_id: str, body: AssumptionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project(db, project_id)
    assumption = Assumption(project_id=project_id, created_by=user.id, **body.model_dump())
    db.add(assumption)
    db.flush()
    record(db, user, project_id, "assumption", assumption.id, "created", None, body.statement, body.justification)
    db.commit()
    return row_dict(assumption)


@router.delete("/{project_id}/assumptions/{assumption_id}")
def delete_assumption(project_id: str, assumption_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    assumption = db.get(Assumption, assumption_id)
    if assumption is None or assumption.project_id != project_id:
        raise HTTPException(404, "ההנחה לא נמצאה")
    record(db, user, project_id, "assumption", assumption.id, "deleted", assumption.statement, None)
    db.delete(assumption)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/audit")
def audit(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).where(AuditLog.project_id == project_id).order_by(AuditLog.at.desc()).limit(500))
    return [row_dict(row) for row in rows]


meta_router = APIRouter(tags=["meta"])


@meta_router.get("/meta")
def meta():
    from ..config import settings
    from ..constants import (
        ARRANGEMENTS,
        CONTENT_TYPES,
        CURRENT_BASES,
        DOCUMENT_TYPES,
        EMPIRICAL_MODEL_TYPES,
        FILE_TYPES,
        INSTRUMENT_TYPES,
        OCCUPANCY_TYPES,
        SCENARIO_KINDS,
        SOURCE_TYPES,
        THRESHOLD_TYPES,
    )
    from ..services.visualization import BANDS

    return {
        "building_types": BUILDING_TYPES,
        "document_types": DOCUMENT_TYPES,
        "file_types": FILE_TYPES,
        "file_content_types": CONTENT_TYPES,
        "max_upload_bytes": settings.max_upload_bytes,
        # A plan is usually larger than a function may receive, so deployed it goes straight to storage.
        "direct_upload": settings.uses_blob_storage,
        "source_types": SOURCE_TYPES,
        "occupancy_types": OCCUPANCY_TYPES,
        "current_bases": CURRENT_BASES,
        "arrangements": ARRANGEMENTS,
        "empirical_model_types": EMPIRICAL_MODEL_TYPES,
        "scenario_kinds": SCENARIO_KINDS,
        "instrument_types": INSTRUMENT_TYPES,
        "threshold_types": THRESHOLD_TYPES,
        "heatmap_bands": BANDS,
    }
