"""Predicted against measured. Stores the error; it never feeds back into the model."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from elf_engine import compute_field, sources_from_dicts, to_mg

from ..audit import record
from ..db import get_db
from ..models import CalculationRun, Measurement, User, ValidationResult
from ..schemas import MeasurementIn
from ..security import current_user
from .common import get_owned, get_project, row_dict

router = APIRouter(prefix="/projects/{project_id}/validation", tags=["validation"])


@router.get("")
def list_validation(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Measurement, ValidationResult)
        .join(ValidationResult, ValidationResult.measurement_id == Measurement.id)
        .where(Measurement.project_id == project_id)
    )
    return [{"measurement": row_dict(m), "validation": row_dict(v)} for m, v in rows]


@router.post("", status_code=201)
def add_measurement(project_id: str, body: MeasurementIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project(db, project_id)
    run = get_owned(db, CalculationRun, body.run_id, project_id, "הריצה")
    try:
        converted = to_mg(body.value, body.unit)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

    measurement = Measurement(
        project_id=project_id,
        label=body.label,
        x=body.x,
        y=body.y,
        z=body.z,
        original_value=converted.original_value,
        original_unit=converted.original_unit,
        measured_mg=converted.value_mg,
        measured_at=body.measured_at,
        instrument=body.instrument,
        notes=body.notes,
        created_by=user.id,
    )
    db.add(measurement)
    db.flush()

    # At the measured location, from that run's frozen inputs rather than the nearest grid point.
    sources = sources_from_dicts(run.input_snapshot["sources"])
    value = float(compute_field([[body.x, body.y, body.z]], sources).total_mg[0])
    predicted = None if value != value else value
    absolute = None if predicted is None else abs(predicted - converted.value_mg)
    percentage = None if absolute is None or converted.value_mg == 0 else absolute / converted.value_mg * 100.0
    validation = ValidationResult(
        measurement_id=measurement.id,
        run_id=run.id,
        predicted_mg=predicted,
        measured_mg=converted.value_mg,
        absolute_error=absolute,
        percentage_error=percentage,
        engine_version=run.engine_version,
    )
    db.add(validation)
    db.flush()
    record(db, user, project_id, "measurement", measurement.id, "created", None, body.model_dump())
    db.commit()
    return {"measurement": row_dict(measurement), "validation": row_dict(validation)}
