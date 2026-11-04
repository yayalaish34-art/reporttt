"""The automatic flow: read the plans, answer a few questions, get a report.

Reading a page is one request, so the browser can show progress page by page and no single
request runs long. Building, approving, calculating and issuing reuse the same code as the
step-by-step screens, so the strict checks there still hold here.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import record
from ..db import get_db
from ..models import CalculationRun, Document, ElectricalSource, PageAnalysis, Project, Scenario, User, utcnow
from ..schemas import ReportIn, RunIn, VerifyIn
from ..security import current_user
from ..services import auto_build, plan_ai
from ..services.readiness import project_blockers
from .calculation import create_run
from .common import get_owned, get_project
from .projects import verify_model
from .reports import create_report

router = APIRouter(prefix="/projects/{project_id}/auto", tags=["auto"])

AUTO_SCENARIO = "זרם אופייני (אוטומטי)"
AUTO_HEIGHT_M = 1.0
AUTO_GRID_M = 0.5


class AnalyzeIn(BaseModel):
    document_id: str
    page: int = Field(ge=0)


class SettingsIn(BaseModel):
    floor_height_m: float | None = Field(default=None, gt=1.5, le=10)
    basement_height_m: float | None = Field(default=None, gt=1.5, le=10)
    typical_load_pct: float | None = Field(default=None, gt=0, le=100)
    pages: dict[str, dict] | None = None
    sources: dict[str, dict] | None = None
    kinds: dict[str, dict] | None = None


_KIND_FIELDS = {"max_current_a": float}
_PAGE_FIELDS = {"scale_denominator": int, "use": str, "plan_for": int}
_SOURCE_FIELDS = {"include": bool, "kind": str, "max_current_a": float}


def _merge(target: dict, updates: dict, fields: dict, check) -> None:
    for key, values in updates.items():
        current = dict(target.get(key) or {})
        for name, value in (values or {}).items():
            if name not in fields:
                raise HTTPException(422, f"שדה לא מוכר: {name}")
            if value is None:
                current.pop(name, None)
                continue
            try:
                value = fields[name](value)
            except (TypeError, ValueError) as error:
                raise HTTPException(422, f"{name}: ערך לא תקין") from error
            check(name, value)
            current[name] = value
        target[key] = current


def _check_page(name: str, value) -> None:
    if name == "scale_denominator" and not 10 <= value <= 2000:
        raise HTTPException(422, "קנה מידה לא סביר")
    if name == "use" and value not in plan_ai.FLOOR_USES:
        raise HTTPException(422, "שימוש קומה לא מוכר")


def _check_source(name: str, value) -> None:
    if name == "kind" and value not in plan_ai.SOURCE_KINDS:
        raise HTTPException(422, "סוג מקור לא מוכר")
    if name == "max_current_a" and not 0 < value <= 20000:
        raise HTTPException(422, "זרם לא סביר")


def _state(db: Session, project: Project) -> dict:
    documents = list(db.scalars(select(Document).where(Document.project_id == project.id, Document.status == "CURRENT")))
    ids = {d.id for d in documents}
    analyses = [a for a in db.scalars(select(PageAnalysis).where(PageAnalysis.project_id == project.id)) if a.document_id in ids]
    settings = auto_build.settings_of(project)
    choices = auto_build.plan_choices(analyses, settings)
    scales = auto_build.resolve_scales(choices, settings)
    library = auto_build.load_library()

    floors = []
    detected = []
    for level in sorted(choices):
        chosen = choices[level]["chosen"]
        result = chosen["result"]
        page_settings = settings["pages"].get(chosen["key"]) or {}
        denominator = scales[level]["denominator"]
        scale = auto_build.m_per_px(result, denominator)
        if not any(d["page_key"] == chosen["key"] for d in detected):
            document_id, page = chosen["row"].document_id, chosen["row"].page
            for source in auto_build.merge_risers(result.get("sources") or [], scale):
                key = auto_build.source_key(document_id, page, source["index"])
                answer = settings["sources"].get(key) or {}
                kind = answer.get("kind") or source["kind"]
                detected.append(
                    {
                        **source,
                        "key": key,
                        "page_key": chosen["key"],
                        "levels": auto_build.choices_for_page(choices, chosen["key"]),
                        "kind_label": library[kind]["label"],
                        "read_max_current_a": auto_build.suggested_max_current(source),
                        "max_current_a": auto_build.max_current_for(source, answer, settings),
                        "answer": answer,
                    }
                )
        box = result.get("building_box")
        floors.append(
            {
                "level": level,
                "name": auto_build.floor_name(level, chosen["name"]),
                "plan": chosen["key"],
                "pages": [p["key"] for p in choices[level]["pages"]],
                "sheet_kind": result.get("sheet_kind"),
                "use": page_settings.get("use") or result.get("floor_use"),
                "scale_denominator": denominator,
                "scale_basis": scales[level]["basis"],
                "scale_read": result.get("scale_denominator"),
                "building_size_m": [round((box[2] - box[0]) * scale, 1), round((box[3] - box[1]) * scale, 1)] if scale and box else None,
            }
        )

    kinds_used = sorted(
        {(d["answer"].get("kind") or d["kind"]) for d in detected if d["answer"].get("include") is not False}
    )

    return {
        "ai_available": plan_ai.ai_available(),
        "documents": [
            {"id": d.id, "file_name": d.file_name, "page_count": d.page_count, "document_type": d.document_type, "file_type": d.file_type}
            for d in documents
        ],
        "analyses": [
            {
                "key": auto_build.page_key(a.document_id, a.page),
                "document_id": a.document_id,
                "page": a.page,
                "sheet_kind": a.result.get("sheet_kind"),
                "floors": a.result.get("floors"),
                "sources": len(a.result.get("sources") or []),
                "notes": a.result.get("notes"),
                "error": a.result.get("error"),
            }
            for a in analyses
        ],
        "settings": settings,
        "floors": floors,
        "detected": detected,
        "kinds": {kind: spec["label"] for kind, spec in library.items()},
        "kinds_used": kinds_used,
        "uses": list(plan_ai.FLOOR_USES),
        "missing": auto_build.missing_answers(project, analyses),
    }


@router.get("")
def state(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return _state(db, get_project(db, project_id))


@router.post("/analyze")
def analyze(project_id: str, body: AnalyzeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    document = get_owned(db, Document, body.document_id, project_id, "המסמך")
    if document.file_type not in ("pdf", "png", "jpg", "jpeg"):
        raise HTTPException(422, "ניתן לקרוא אוטומטית רק PDF או תמונה")
    if body.page >= document.page_count:
        raise HTTPException(422, "העמוד לא קיים במסמך")
    try:
        result = plan_ai.analyze_page(document, body.page)
    except plan_ai.PlanAiError as error:
        raise HTTPException(502, str(error)) from error
    row = db.scalar(select(PageAnalysis).where(PageAnalysis.document_id == document.id, PageAnalysis.page == body.page))
    if row is None:
        row = PageAnalysis(project_id=project.id, document_id=document.id, page=body.page, result=result, created_by=user.id)
        db.add(row)
    else:
        row.result, row.created_at, row.created_by = result, utcnow(), user.id
    row.model = result.get("model", "")
    # A sheet that turns out to be architectural is filed as such, for the step-by-step screens.
    if result["sheet_kind"] in ("ELECTRICAL", "ARCHITECTURAL") and document.page_count == 1:
        document.document_type = result["sheet_kind"]
    db.flush()
    record(db, user, project.id, "page_analysis", row.id, "created", None, f"{document.file_name} p{body.page + 1}: {len(result['sources'])} sources")
    db.commit()
    return {"key": auto_build.page_key(document.id, body.page), "sheet_kind": result["sheet_kind"], "floors": result["floors"], "sources": len(result["sources"])}


@router.put("/settings")
def save_settings(project_id: str, body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    settings = auto_build.settings_of(project)
    old = dict(settings)
    for field in ("floor_height_m", "basement_height_m", "typical_load_pct"):
        if field in body.model_fields_set:
            settings[field] = getattr(body, field)
    if body.pages:
        _merge(settings["pages"], body.pages, _PAGE_FIELDS, _check_page)
    if body.sources:
        _merge(settings["sources"], body.sources, _SOURCE_FIELDS, _check_source)
    if body.kinds:
        unknown = set(body.kinds) - set(plan_ai.SOURCE_KINDS)
        if unknown:
            raise HTTPException(422, "סוג מקור לא מוכר")
        _merge(settings["kinds"], body.kinds, _KIND_FIELDS, _check_source)
    project.auto_settings = settings
    record(db, user, project.id, "project", project.id, "auto_settings", old, settings, "שאלון אוטומטי")
    db.commit()
    return _state(db, project)


def _build(db: Session, project: Project, user: User) -> dict:
    analyses = [a for a in db.scalars(select(PageAnalysis).where(PageAnalysis.project_id == project.id))]
    if not analyses:
        raise HTTPException(409, "עדיין לא נקראה אף תוכנית")
    missing = auto_build.missing_answers(project, analyses)
    if missing:
        raise HTTPException(409, {"message": "יש להשלים את השאלות", "missing": missing})
    return auto_build.build_model(db, project, user)


@router.post("/build")
def build(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    summary = _build(db, project, user)
    db.commit()
    return {**summary, "blockers": project_blockers(db, project)}


@router.post("/finish")
def finish(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The engineer's one click: the automatic sources are confirmed, the model approved,
    the calculation run and a report issued. Anything still missing stays on the report."""
    project = get_project(db, project_id)
    for source in db.scalars(
        select(ElectricalSource).where(
            ElectricalSource.project_id == project.id,
            ElectricalSource.detection_method == auto_build.AUTO,
            ElectricalSource.user_verified.is_(False),
        )
    ):
        record(db, user, project.id, "source", source.id, "user_verified", False, True, "אושר במסך האוטומטי")
        source.user_verified = True
    db.commit()

    verify_model(project.id, VerifyIn(verified=True, reason="אישור במסך האוטומטי"), user, db)

    scenario = db.scalar(select(Scenario).where(Scenario.project_id == project.id, Scenario.name == AUTO_SCENARIO))
    if scenario is None:
        scenario = Scenario(project_id=project.id, name=AUTO_SCENARIO, kind="NORMAL", current_factor=1.0)
        db.add(scenario)
        db.commit()
    run = create_run(project.id, RunIn(scenario_id=scenario.id, grid_step_m=AUTO_GRID_M, heights_m=[AUTO_HEIGHT_M]), user, db)
    report = create_report(project.id, ReportIn(run_id=run["id"]), user, db)
    latest = db.get(CalculationRun, run["id"])
    return {"run": run, "report": report, "blockers": latest.blockers if latest else []}
