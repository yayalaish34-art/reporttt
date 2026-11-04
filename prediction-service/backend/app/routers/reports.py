import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import storage
from ..audit import record
from ..db import get_db
from ..models import CalculationRun, ReportVersion, User, utcnow
from ..schemas import ReportIn, TransitionIn
from ..security import APPROVAL_ROLES, current_user
from ..services.readiness import project_blockers, run_staleness
from ..services.report_pdf import build_report_pdf
from .common import get_owned, get_project, row_dict, stored_file_response

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])
logger = logging.getLogger(__name__)

_ALLOWED = {
    "DRAFT": ("UNDER_REVIEW",),
    "UNDER_REVIEW": ("DRAFT", "APPROVED"),
    "APPROVED": ("ISSUED", "UNDER_REVIEW"),
    "ISSUED": (),
}
# Only these move a report past the point of no way back.
_NEEDS_FINAL = ("APPROVED", "ISSUED")


def _public(report: ReportVersion) -> dict:
    return row_dict(report, exclude=("storage_key",))


def _current_blockers(db: Session, project, run: CalculationRun) -> list[dict]:
    """Today's gaps plus the run's own: a report is only as complete as both."""
    blockers = project_blockers(db, project) + run_staleness(db, project, run)
    seen = {item["message"] for item in blockers}
    return blockers + [item for item in (run.blockers or []) if item["message"] not in seen and item["code"] == "SOURCE_EXCLUDED"]


@router.get("")
def list_reports(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ReportVersion).where(ReportVersion.project_id == project_id).order_by(ReportVersion.version.desc()))
    return [_public(row) for row in rows]


@router.post("", status_code=201)
def create_report(project_id: str, body: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    run = get_owned(db, CalculationRun, body.run_id, project_id, "הריצה")
    comparison = get_owned(db, CalculationRun, body.comparison_run_id, project_id, "הריצה") if body.comparison_run_id else None
    blockers = _current_blockers(db, project, run)
    version = (db.scalar(select(func.max(ReportVersion.version)).where(ReportVersion.project_id == project_id)) or 0) + 1
    report = ReportVersion(
        project_id=project_id,
        run_id=run.id,
        comparison_run_id=comparison.id if comparison else None,
        version=version,
        status="DRAFT",
        is_final=not blockers,
        blockers=blockers,
        created_by=user.id,
        storage_key="",
    )
    report.storage_key = storage.save(build_report_pdf(db, project, run, comparison, report), ".pdf")
    db.add(report)
    db.flush()
    record(db, user, project_id, "report", report.id, "created", None, f"v{version} final={report.is_final}")
    db.commit()
    return _public(report)


@router.get("/{report_id}/file")
def download(project_id: str, report_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    report = get_owned(db, ReportVersion, report_id, project_id, "הדוח")
    return stored_file_response(report.storage_key, "application/pdf", f"elf-prediction-v{report.version}.pdf")


@router.post("/{report_id}/transition")
def transition(project_id: str, report_id: str, body: TransitionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    report = get_owned(db, ReportVersion, report_id, project_id, "הדוח")
    if body.status not in _ALLOWED.get(report.status, ()):
        raise HTTPException(409, f"אי אפשר לעבור מ-{report.status} ל-{body.status}")
    if body.status in _NEEDS_FINAL:
        if user.role not in APPROVAL_ROLES:
            raise HTTPException(403, "רק בעל הרשאת אישור רשאי לאשר או להנפיק דוח")
        run = db.get(CalculationRun, report.run_id)
        blockers = _current_blockers(db, project, run)
        if blockers:
            raise HTTPException(
                409,
                {
                    "message": "Cannot issue final prediction report. לא ניתן להנפיק דוח חיזוי סופי.",
                    "missing": [item["message"] for item in blockers],
                },
            )
        report.is_final = True
        report.blockers = []

    record(db, user, project_id, "report", report.id, "status", report.status, body.status, body.reason)
    report.status = body.status
    if body.status == "APPROVED":
        report.approved_by = user.id
        report.approved_at = utcnow()
    elif body.status == "ISSUED":
        report.issued_at = utcnow()
    else:
        report.approved_by = None
        report.approved_at = None

    # The PDF states its status and approver, so it changes with them.
    run = db.get(CalculationRun, report.run_id)
    comparison = db.get(CalculationRun, report.comparison_run_id) if report.comparison_run_id else None
    replaced_key = report.storage_key
    report.storage_key = storage.save(build_report_pdf(db, project, run, comparison, report), ".pdf")
    db.commit()
    try:
        storage.delete(replaced_key)
    except Exception:
        # The transition already happened; a leftover file only costs storage.
        logger.warning("Could not delete replaced report file %s", replaced_key, exc_info=True)
    return _public(report)
