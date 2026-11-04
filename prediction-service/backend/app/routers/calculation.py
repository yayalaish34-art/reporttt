from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import record
from ..db import get_db
from ..models import CalculationResult, CalculationRun, Recommendation, Scenario, User
from ..schemas import RunIn, ScenarioIn
from ..security import current_user
from ..services.calculation import CalculationError, floor_points, run_calculation
from .common import get_owned, get_project, row_dict

router = APIRouter(prefix="/projects/{project_id}", tags=["calculation"])

FORMULA = (
    "B = (μ0·I / 4π) · (a·u/|a| − b·u/|b|) · (u × ρ) / |ρ|²  (Biot–Savart, finite segment, phasors); "
    "B_rms = √(|Bx|²+|By|²+|Bz|²); within a coherence group: phasor sum; between groups: RSS"
)
EMPIRICAL_FORMULA = "B(d, I) = B_ref(d) · I / I_ref, d measured from the box faces"


def _run_summary(run: CalculationRun) -> dict:
    return row_dict(run, exclude=("input_snapshot",))


@router.get("/scenarios")
def list_scenarios(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return [row_dict(row) for row in db.scalars(select(Scenario).where(Scenario.project_id == project_id))]


@router.post("/scenarios", status_code=201)
def add_scenario(project_id: str, body: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project(db, project_id)
    scenario = Scenario(project_id=project_id, **body.model_dump())
    db.add(scenario)
    db.flush()
    record(db, user, project_id, "scenario", scenario.id, "created", None, body.model_dump())
    db.commit()
    return row_dict(scenario)


@router.patch("/scenarios/{scenario_id}")
def update_scenario(project_id: str, scenario_id: str, body: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scenario = get_owned(db, Scenario, scenario_id, project_id, "התרחיש")
    for field, value in body.model_dump().items():
        if getattr(scenario, field) != value:
            record(db, user, project_id, "scenario", scenario.id, field, getattr(scenario, field), value)
            setattr(scenario, field, value)
    db.commit()
    return row_dict(scenario)


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(project_id: str, scenario_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scenario = get_owned(db, Scenario, scenario_id, project_id, "התרחיש")
    record(db, user, project_id, "scenario", scenario.id, "deleted", scenario.name, None)
    db.delete(scenario)
    db.commit()
    return {"ok": True}


@router.get("/runs")
def list_runs(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(CalculationRun).where(CalculationRun.project_id == project_id).order_by(CalculationRun.created_at.desc()))
    return [_run_summary(run) for run in rows]


@router.post("/runs", status_code=201)
def create_run(project_id: str, body: RunIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, project_id)
    scenario = get_owned(db, Scenario, body.scenario_id, project_id, "התרחיש")
    try:
        run = run_calculation(db, project, scenario, body.grid_step_m, body.heights_m, user)
    except (CalculationError, ValueError) as error:
        db.rollback()
        raise HTTPException(422, str(error)) from error
    record(db, user, project_id, "run", run.id, "created", None, f"final={run.is_final} hash={run.input_hash}")
    db.commit()
    return _run_summary(run)


@router.get("/runs/{run_id}")
def read_run(project_id: str, run_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    run = get_owned(db, CalculationRun, run_id, project_id, "הריצה")
    results = db.scalars(
        select(CalculationResult)
        .where(CalculationResult.run_id == run.id)
        .order_by(CalculationResult.floor_name, CalculationResult.room_name, CalculationResult.height_m)
    )
    data = _run_summary(run)
    data["results"] = [row_dict(result) for result in results]
    return data


@router.get("/runs/{run_id}/points")
def run_points(project_id: str, run_id: str, floor_id: str, height_m: float, _: User = Depends(current_user), db: Session = Depends(get_db)):
    run = get_owned(db, CalculationRun, run_id, project_id, "הריצה")
    return {"step_m": run.grid_step_m, "points": floor_points(db, run.id, floor_id, height_m)}


@router.get("/runs/{run_id}/recommendations")
def run_recommendations(project_id: str, run_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    run = get_owned(db, CalculationRun, run_id, project_id, "הריצה")
    return [row_dict(row) for row in db.scalars(select(Recommendation).where(Recommendation.run_id == run.id))]


@router.get("/runs/{run_id}/compare/{other_run_id}")
def compare_runs(project_id: str, run_id: str, other_run_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    """Before/after, with each figure read from its own stored run."""
    before = get_owned(db, CalculationRun, run_id, project_id, "הריצה")
    after = get_owned(db, CalculationRun, other_run_id, project_id, "הריצה")
    return comparison_rows(db, before, after)


def comparison_rows(db: Session, before: CalculationRun, after: CalculationRun) -> list[dict]:
    after_rows = {
        (row.room_id, row.height_m): row
        for row in db.scalars(select(CalculationResult).where(CalculationResult.run_id == after.id))
    }
    rows = []
    for row in db.scalars(select(CalculationResult).where(CalculationResult.run_id == before.id)):
        match = after_rows.get((row.room_id, row.height_m))
        if match is None:
            continue
        reduction = None
        if row.max_mg and match.max_mg is not None:
            reduction = (row.max_mg - match.max_mg) / row.max_mg * 100.0
        rows.append(
            {
                "room_name": row.room_name,
                "floor_name": row.floor_name,
                "height_m": row.height_m,
                "before_mg": row.max_mg,
                "after_mg": match.max_mg,
                "reduction_pct": reduction,
                "status_before": row.status,
                "status_after": match.status,
            }
        )
    return rows


@router.get("/results/{result_id}/trace")
def trace(project_id: str, result_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything behind one number, read from the run's frozen snapshot."""
    result = db.get(CalculationResult, result_id)
    run = db.get(CalculationRun, result.run_id) if result else None
    if run is None or run.project_id != project_id:
        raise HTTPException(404, "התוצאה לא נמצאה")
    snapshot = run.input_snapshot
    records = {record_["tag"]: record_ for record_ in snapshot["source_records"]}
    documents = {document["id"]: document for document in snapshot["documents"]}
    sources = []
    for source in snapshot["sources"]:
        tag = source["id"]
        record_ = records.get(tag, {})
        sources.append(
            {
                "tag": tag,
                "contribution_mg": (result.contributions or {}).get(tag),
                "formula": EMPIRICAL_FORMULA if source["kind"] == "EMPIRICAL" else FORMULA,
                "calculation_method": source.get("model_type") or source["kind"],
                "input": source,
                "current_a": record_.get("current_a"),
                "current_basis": record_.get("current_basis"),
                "source_document": documents.get(record_.get("source_document_id")),
                "detection_method": record_.get("detection_method"),
            }
        )
    return {
        "value_mg": result.max_mg,
        "room_name": result.room_name,
        "height_m": result.height_m,
        "point": result.max_point,
        "combination_method": run.combination_method,
        "sensitivity": result.sensitivity,
        "sources": sources,
        "excluded_sources": run.excluded_sources,
        "assumptions": snapshot["assumptions"],
        "regulation_checks": result.rule_checks,
        "status": result.status,
        "status_reasons": result.status_reasons,
        "engine_version": run.engine_version,
        "input_hash": run.input_hash,
        "run_id": run.id,
        "scenario": snapshot["scenario"],
        "created_at": run.created_at,
    }
