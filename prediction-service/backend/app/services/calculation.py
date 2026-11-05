"""Runs a scenario: freezes the inputs, calls the engine, stores what came back."""

import hashlib
import json
import math

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from elf_engine import ENGINE_VERSION, Combination, compute_field, room_grid, sources_from_dicts
from elf_regulation import evaluate_room

from ..models import (
    Assumption,
    CalculationPoint,
    CalculationResult,
    CalculationRun,
    Document,
    ElectricalSource,
    Floor,
    Project,
    RegulationRule,
    Room,
    Scenario,
    User,
    new_id,
)
from .readiness import project_blockers
from .recommendations import build_recommendations
from .regulation_rules import load_engine_rules, room_context
from .source_model import computable, engine_dict


# Grid points are stored for the heatmap, far finer than it shows. Each room's exact
# maximum is kept unrounded on its result row.
POINT_MG_DECIMALS = 5
POINT_M_DECIMALS = 4


class CalculationError(ValueError):
    pass


def _hash(snapshot: dict) -> str:
    canonical = json.dumps(snapshot, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _rule_snapshot(row: RegulationRule) -> dict:
    return {
        "id": row.id,
        "authority": row.authority,
        "instrument_type": row.instrument_type,
        "document_name": row.document_name,
        "document_version": row.document_version,
        "effective_date": row.effective_date.isoformat() if row.effective_date else None,
        "source_url": row.source_url,
        "occupancy_type": row.occupancy_type,
        "building_types": row.building_types,
        "threshold": row.threshold,
        "threshold_unit": row.threshold_unit,
        "threshold_type": row.threshold_type,
        "averaging_hours": row.averaging_hours,
        "notes": row.notes,
    }


def _finite(value) -> float | None:
    value = float(value)
    return value if math.isfinite(value) else None


def floor_points(db: Session, run_id: str, floor_id: str, height_m: float) -> list[tuple]:
    """(x, y, predicted_mg) for every grid point on a floor at one height."""
    layers = db.scalars(
        select(CalculationPoint).where(
            CalculationPoint.run_id == run_id,
            CalculationPoint.floor_id == floor_id,
            CalculationPoint.height_m == height_m,
        )
    )
    return [point for layer in layers for point in zip(layer.xs, layer.ys, layer.predicted_mg)]


def sensitivity_at(point: np.ndarray, source_dicts: list[dict], uncertainty_pct: float | None) -> dict:
    """Expected and conservative always; the +/- cases only with a stated uncertainty."""
    sources = sources_from_dicts(source_dicts)
    point = point.reshape(1, 3)

    def at(factor: float, combination: Combination) -> float | None:
        return _finite(compute_field(point, sources, combination, current_factor=factor).total_mg[0])

    result = {
        "expected_mg": at(1.0, Combination.RSS),
        "conservative_mg": at(1.0, Combination.ARITHMETIC),
        "uncertainty_pct": uncertainty_pct,
    }
    if uncertainty_pct is not None:
        u = uncertainty_pct / 100.0
        result["lower_mg"] = at(1.0 - u, Combination.RSS)
        result["worst_case_mg"] = at(1.0 + u, Combination.ARITHMETIC)
    return result


def run_calculation(
    db: Session,
    project: Project,
    scenario: Scenario,
    grid_step_m: float,
    heights_m: list[float],
    user: User,
) -> CalculationRun:
    heights = sorted(set(heights_m))
    floors = {f.id: f for f in db.scalars(select(Floor).where(Floor.project_id == project.id))}
    rooms = list(db.scalars(select(Room).options(selectinload(Room.profile)).where(Room.project_id == project.id)))
    stored_sources = list(db.scalars(select(ElectricalSource).where(ElectricalSource.project_id == project.id)))
    blockers = project_blockers(db, project)

    overrides = scenario.source_overrides or {}
    source_dicts, source_rows, excluded = [], [], []
    for source in stored_sources:
        override = dict(overrides.get(source.id) or {})
        floor = floors.get(source.floor_id)
        if override.get("excluded"):
            excluded.append({"tag": source.tag, "reason": "הוסר בתרחיש"})
            continue
        if not computable(source, floor):
            # Left out, loudly. A run that excludes a source can never be final.
            excluded.append({"tag": source.tag, "reason": "MISSING_DATA"})
            continue
        override["current_factor"] = override.get("current_factor", 1.0) * scenario.current_factor
        source_dicts.append(engine_dict(source, floor, override))
        source_rows.append(source)

    tags = [item["id"] for item in source_dicts]
    if len(set(tags)) != len(tags):
        raise CalculationError("קיימים שני מקורות עם אותו תג. יש לתת לכל מקור תג ייחודי.")
    if not source_dicts:
        raise CalculationError("אין אף מקור עם נתונים מספיקים לחישוב. יש להשלים את השאלות.")

    room_plan = []
    for room in rooms:
        floor = floors.get(room.floor_id)
        if floor is None or floor.elevation_m is None:
            continue
        for height in heights:
            room_plan.append((room, floor, height, room_grid(room.polygon_m, grid_step_m, [floor.elevation_m + height], room.holes_m)))
    if not room_plan:
        raise CalculationError("אין חדר עם גובה קומה ידוע לחישוב.")

    sources = sources_from_dicts(source_dicts)
    all_points = np.vstack([plan[3] for plan in room_plan])
    field = compute_field(all_points, sources, Combination.RSS)
    dominant = field.dominant_source_index()

    rule_rows = list(db.scalars(select(RegulationRule)))
    engine_rules = load_engine_rules(db)
    documents = db.scalars(select(Document).where(Document.project_id == project.id))
    snapshot = {
        "engine_version": ENGINE_VERSION,
        "project": {"id": project.id, "building_type": project.building_type, "country": project.country},
        "scenario": {
            "id": scenario.id,
            "name": scenario.name,
            "kind": scenario.kind,
            "current_factor": scenario.current_factor,
            "uncertainty_pct": scenario.uncertainty_pct,
            "source_overrides": overrides,
            "configuration": scenario.configuration,
            "shielding": scenario.shielding,
            "notes": scenario.notes,
        },
        "grid_step_m": grid_step_m,
        "heights_m": heights,
        "sources": source_dicts,
        "source_records": [
            {
                "tag": row.tag,
                "source_type": row.source_type,
                "current_a": row.current_a,
                "current_basis": row.current_basis,
                "load_factor": row.load_factor,
                "source_document_id": row.source_document_id,
                "page": row.page,
                "detection_method": row.detection_method,
            }
            for row in source_rows
        ],
        "excluded_sources": excluded,
        "floors": [
            {"id": f.id, "name": f.name, "elevation_m": f.elevation_m, "scale_m_per_px": f.scale_m_per_px}
            for f in floors.values()
        ],
        "rooms": [
            {
                "id": r.id,
                "name": r.name,
                "floor_id": r.floor_id,
                "polygon_m": r.polygon_m,
                "holes_m": r.holes_m,
                "usage_type": r.usage_type,
                "occupancy_classification": r.occupancy_classification,
                "occupancy_confirmed": r.occupancy_confirmed,
                "hours_per_day": r.profile.hours_per_day if r.profile else None,
            }
            for r in rooms
        ],
        "assumptions": [
            {"statement": a.statement, "justification": a.justification, "target": a.target, "status": a.status}
            for a in db.scalars(select(Assumption).where(Assumption.project_id == project.id))
        ],
        "regulation_rules": [_rule_snapshot(row) for row in rule_rows if row.active and row.verified_at],
        "documents": [
            {"id": d.id, "file_name": d.file_name, "document_type": d.document_type, "revision": d.revision}
            for d in documents
        ],
    }

    if excluded and not any(b["code"].startswith("SOURCE_") for b in blockers):
        blockers = blockers + [
            {"code": "SOURCE_EXCLUDED", "target": e["tag"], "message": f"{e['tag']}: לא נכלל בחישוב", "status": "MISSING_DATA"}
            for e in excluded
            if e["reason"] == "MISSING_DATA"
        ]

    run = CalculationRun(
        id=new_id(),
        project_id=project.id,
        scenario_id=scenario.id,
        scenario_name=scenario.name,
        is_final=not blockers,
        blockers=blockers,
        excluded_sources=excluded,
        grid_step_m=grid_step_m,
        heights_m=heights,
        combination_method=Combination.RSS.value,
        input_snapshot=snapshot,
        input_hash=_hash(snapshot),
        engine_version=ENGINE_VERSION,
        created_by=user.id,
    )
    db.add(run)
    db.flush()

    point_layers = []
    results = []
    offset = 0
    for room, floor, height, grid in room_plan:
        count = len(grid)
        values = field.total_mg[offset : offset + count]
        dominants = dominant[offset : offset + count]
        extrapolated = bool(field.extrapolated[offset : offset + count].any())
        per_source = field.per_source_mg[offset : offset + count]
        rounded = [None if np.isnan(value) else round(float(value), POINT_MG_DECIMALS) for value in values]
        point_layers.append(
            CalculationPoint(
                run_id=run.id,
                room_id=room.id,
                floor_id=floor.id,
                height_m=height,
                z=float(grid[0][2]),
                xs=[round(float(x), POINT_M_DECIMALS) for x in grid[:, 0]],
                ys=[round(float(y), POINT_M_DECIMALS) for y in grid[:, 1]],
                predicted_mg=rounded,
                dominant_source_tags=[
                    tags[index] if value is not None else None for index, value in zip(dominants, rounded)
                ],
            )
        )
        offset += count

        valid = ~np.isnan(values)
        result = CalculationResult(
            id=new_id(),
            run_id=run.id,
            room_id=room.id,
            room_name=room.name,
            floor_name=floor.name,
            usage_type=room.usage_type,
            occupancy_classification=room.occupancy_classification if room.occupancy_confirmed else "UNKNOWN",
            occupancy_hours=room.profile.hours_per_day if room.profile else None,
            height_m=height,
            extrapolated=extrapolated,
            too_close_points=int((~valid).sum()),
            contributions={},
            sensitivity={},
        )
        max_mg = None
        if valid.any():
            index = int(np.nanargmax(values))
            max_mg = float(values[index])
            max_point = grid[index]
            dominant_tag = tags[dominants[index]]
            dominant_position = tags.index(dominant_tag)
            result.max_mg = max_mg
            result.mean_mg = float(np.nanmean(values))
            result.max_point = [float(c) for c in max_point]
            result.dominant_source_tag = dominant_tag
            result.dominant_source_mg = float(per_source[index, dominant_position])
            result.dominant_distance_m = float(sources[dominant_position].distance_m(max_point.reshape(1, 3))[0])
            result.contributions = {tag: float(per_source[index, i]) for i, tag in enumerate(tags)}
            result.sensitivity = sensitivity_at(max_point, source_dicts, scenario.uncertainty_pct)
            without = [item for item in source_dicts if item["id"] != dominant_tag]
            result.without_dominant_mg = (
                _finite(compute_field(max_point.reshape(1, 3), sources_from_dicts(without)).total_mg[0]) if without else 0.0
            )

        evaluation = evaluate_room(max_mg, engine_rules, room_context(project, room))
        result.status = evaluation.status
        result.status_reasons = evaluation.reasons
        result.rule_checks = evaluation.checks
        results.append(result)

    db.add_all(results)
    db.flush()
    db.add_all(point_layers)
    db.add_all(build_recommendations(run, results, snapshot))
    return run
