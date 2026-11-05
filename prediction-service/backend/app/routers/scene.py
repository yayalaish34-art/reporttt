"""The building in 3D for the browser: floors, their field images, and the sources in place."""

import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import CalculationRun, ElectricalSource, Floor, User
from ..security import current_user
from ..services.hebrew import SOURCE_TYPES, he
from ..services.source_model import is_line
from ..services.view3d import floor_bounds, floor_raster
from ..services.visualization import BANDS
from .common import get_owned

router = APIRouter(prefix="/projects/{project_id}/runs/{run_id}", tags=["scene"])


def _floors(db: Session, project_id: str) -> list[Floor]:
    return sorted(db.scalars(select(Floor).where(Floor.project_id == project_id)), key=lambda f: f.elevation_m or 0)


@router.get("/scene")
def scene(project_id: str, run_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    run = get_owned(db, CalculationRun, run_id, project_id, "הריצה")
    floors = [f for f in _floors(db, project_id) if f.elevation_m is not None]
    height = run.heights_m[0]
    bounds = floor_bounds(db, run, floors, height)
    if bounds is None:
        raise HTTPException(409, "לריצה אין נקודות חישוב")
    by_id = {f.id: f for f in floors}
    sources = []
    for source in db.scalars(select(ElectricalSource).where(ElectricalSource.project_id == project_id)):
        floor = by_id.get(source.floor_id)
        points = (source.geometry or {}).get("points") or []
        if floor is None or len(points) < 2:
            continue
        item = {"tag": source.tag, "type": he(SOURCE_TYPES, source.source_type)}
        z_values = source.geometry.get("z_values")
        if z_values:
            item.update(kind="riser", points=[[points[0][0], points[0][1], z_values[0]], [points[0][0], points[0][1], z_values[-1]]])
        elif is_line(source.source_type):
            z = floor.elevation_m + (source.height_above_floor_m or 0)
            item.update(kind="line", points=[[x, y, z] for x, y in points])
        else:
            (ax, ay), (bx, by) = points[:2]
            details = source.transformer or source.panel
            rise = (details.box_height_m if details and details.box_height_m else 2.0)
            bottom = floor.elevation_m + (source.height_above_floor_m or 0)
            item.update(kind="box", points=[[min(ax, bx), min(ay, by), bottom], [max(ax, bx), max(ay, by), bottom + rise]])
        sources.append(item)
    return {
        "bounds": bounds,
        "height_m": height,
        "floors": [{"id": f.id, "name": f.name, "elevation_m": f.elevation_m, "height_m": f.ceiling_height_m} for f in floors],
        "sources": sources,
        "bands": BANDS,
    }


@router.get("/floors/{floor_id}/field.png")
def field_image(project_id: str, run_id: str, floor_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    """The floor's field over the whole building's bounds, so every floor lines up."""
    run = get_owned(db, CalculationRun, run_id, project_id, "הריצה")
    floor = get_owned(db, Floor, floor_id, project_id, "הקומה")
    floors = [f for f in _floors(db, project_id) if f.elevation_m is not None]
    bounds = floor_bounds(db, run, floors, run.heights_m[0])
    if bounds is None:
        raise HTTPException(409, "לריצה אין נקודות חישוב")
    buffer = io.BytesIO()
    floor_raster(db, run, floor, run.heights_m[0], bounds).save(buffer, "PNG")
    return Response(buffer.getvalue(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
