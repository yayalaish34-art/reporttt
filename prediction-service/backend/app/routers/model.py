"""Floors, rooms and sources. Every change voids MODEL VERIFIED and is audited."""

import math

from fastapi import APIRouter, Depends, HTTPException
from shapely.geometry import Polygon
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..audit import invalidate_verification, record
from ..constants import ARRANGEMENTS, CURRENT_BASES, EMPIRICAL_MODEL_TYPES, SOURCE_TYPES
from ..db import get_db
from ..models import Document, ElectricalSource, Floor, OccupancyProfile, Room, User
from ..schemas import AnswerIn, CalibrationIn, FloorIn, FloorPatch, OriginIn, RoomIn, RoomPatch, SourceIn, SourcePatch
from ..security import current_user
from ..services.occupancy import suggest_occupancy
from ..services.source_model import ensure_details, get_field, set_field, settable_fields, source_to_dict
from .common import get_owned, get_project, row_dict

router = APIRouter(prefix="/projects/{project_id}", tags=["model"])


def _validated_polygon(points) -> tuple[list, float]:
    polygon = [[float(x), float(y)] for x, y in points]
    shape = Polygon(polygon)
    if not shape.is_valid or shape.area <= 0:
        raise HTTPException(422, "פוליגון החדר אינו תקין (קווים חוצים או שטח אפס)")
    return polygon, shape.area


def _room_dict(room: Room) -> dict:
    data = row_dict(room)
    profile = room.profile
    data["hours_per_day"] = profile.hours_per_day if profile else None
    data["days_per_week"] = profile.days_per_week if profile else None
    data["source_note"] = profile.source_note if profile else ""
    return data


# ── Floors ──────────────────────────────────────────────────────────────


@router.get("/floors")
def list_floors(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Floor).where(Floor.project_id == project_id).order_by(Floor.sort_order, Floor.name))
    return [row_dict(row) for row in rows]


def _check_plan(db: Session, project_id: str, document_id: str | None, page: int | None) -> None:
    if document_id is None:
        return
    document = get_owned(db, Document, document_id, project_id, "המסמך")
    if page is not None and not 0 <= page < document.page_count:
        raise HTTPException(422, "עמוד התוכנית לא קיים במסמך")


@router.post("/floors", status_code=201)
def add_floor(project_id: str, body: FloorIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project(db, project_id)
    _check_plan(db, project_id, body.plan_document_id, body.plan_page)
    floor = Floor(project_id=project_id, **body.model_dump())
    db.add(floor)
    db.flush()
    record(db, user, project_id, "floor", floor.id, "created", None, floor.name)
    invalidate_verification(db, user, project_id, "נוספה קומה")
    db.commit()
    return row_dict(floor)


@router.patch("/floors/{floor_id}")
def update_floor(project_id: str, floor_id: str, body: FloorPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    floor = get_owned(db, Floor, floor_id, project_id, "הקומה")
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    _check_plan(db, project_id, changes.get("plan_document_id", floor.plan_document_id), changes.get("plan_page", floor.plan_page))
    changed = False
    for field, value in changes.items():
        if getattr(floor, field) != value:
            record(db, user, project_id, "floor", floor.id, field, getattr(floor, field), value, body.reason)
            setattr(floor, field, value)
            changed = True
    if changed:
        invalidate_verification(db, user, project_id, "שינוי קומה")
    db.commit()
    return row_dict(floor)


@router.delete("/floors/{floor_id}")
def delete_floor(project_id: str, floor_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    floor = get_owned(db, Floor, floor_id, project_id, "הקומה")
    record(db, user, project_id, "floor", floor.id, "deleted", floor.name, None)
    invalidate_verification(db, user, project_id, "נמחקה קומה")
    for model in (Room, ElectricalSource):
        for row in db.scalars(select(model).where(model.floor_id == floor.id)):
            db.delete(row)
    db.delete(floor)
    db.commit()
    return {"ok": True}


def _rebase_floor_geometry(db: Session, floor: Floor, new_scale: float, new_origin: list[float]) -> None:
    """Keeps drawn geometry on the plan when the calibration changes.

    Geometry is stored in metres, so a new scale would otherwise silently move every
    room and source on this floor. The pixels are what the user actually drew.
    """
    old_scale, old_origin = floor.scale_m_per_px, floor.origin_px
    if old_scale is None or not old_origin:
        return

    def rebase(point):
        px = point[0] / old_scale + old_origin[0]
        py = old_origin[1] - point[1] / old_scale
        return [(px - new_origin[0]) * new_scale, (new_origin[1] - py) * new_scale]

    for room in db.scalars(select(Room).where(Room.floor_id == floor.id)):
        room.polygon_m = [rebase(point) for point in room.polygon_m]
        room.area_m2 = Polygon(room.polygon_m).area
    for source in db.scalars(select(ElectricalSource).where(ElectricalSource.floor_id == floor.id)):
        source.geometry = {**source.geometry, "points": [rebase(point) for point in source.geometry["points"]]}


@router.post("/floors/{floor_id}/calibrate")
def calibrate(project_id: str, floor_id: str, body: CalibrationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    floor = get_owned(db, Floor, floor_id, project_id, "הקומה")
    pixels = math.dist(body.p1, body.p2)
    if pixels < 5:
        raise HTTPException(422, "שתי נקודות הכיול קרובות מדי")
    scale = body.distance_m / pixels
    origin = floor.origin_px or list(body.p1)
    _rebase_floor_geometry(db, floor, scale, origin)
    record(db, user, project_id, "floor", floor.id, "scale_m_per_px", floor.scale_m_per_px, scale, body.reason)
    floor.scale_m_per_px = scale
    floor.origin_px = origin
    floor.calibration = {"p1": list(body.p1), "p2": list(body.p2), "distance_m": body.distance_m}
    invalidate_verification(db, user, project_id, "שינוי כיול")
    db.commit()
    return row_dict(floor)


@router.post("/floors/{floor_id}/origin")
def set_origin(project_id: str, floor_id: str, body: OriginIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    floor = get_owned(db, Floor, floor_id, project_id, "הקומה")
    if floor.scale_m_per_px is None:
        raise HTTPException(409, "יש לכייל את הקומה לפני קביעת נקודת הייחוס")
    origin = list(body.origin_px)
    _rebase_floor_geometry(db, floor, floor.scale_m_per_px, origin)
    record(db, user, project_id, "floor", floor.id, "origin_px", floor.origin_px, origin, body.reason)
    floor.origin_px = origin
    invalidate_verification(db, user, project_id, "שינוי נקודת ייחוס")
    db.commit()
    return row_dict(floor)


# ── Rooms ───────────────────────────────────────────────────────────────


@router.get("/rooms")
def list_rooms(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Room).options(selectinload(Room.profile)).where(Room.project_id == project_id).order_by(Room.name))
    return [_room_dict(room) for room in rows]


@router.post("/rooms", status_code=201)
def add_room(project_id: str, body: RoomIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned(db, Floor, body.floor_id, project_id, "הקומה")
    polygon, area = _validated_polygon(body.polygon_m)
    room = Room(
        project_id=project_id,
        floor_id=body.floor_id,
        name=body.name,
        polygon_m=polygon,
        area_m2=area,
        usage_type=body.usage_type or body.name,
        suggested_occupancy=suggest_occupancy(body.name),
    )
    db.add(room)
    db.flush()
    record(db, user, project_id, "room", room.id, "created", None, room.name)
    invalidate_verification(db, user, project_id, "נוסף חדר")
    db.commit()
    return _room_dict(room)


def _apply_room_changes(db: Session, user: User, project_id: str, room: Room, changes: dict, reason: str) -> None:
    profile_fields = ("hours_per_day", "days_per_week", "source_note")
    for field, value in changes.items():
        if field == "polygon_m":
            value, room.area_m2 = _validated_polygon(value)
        if field in profile_fields:
            if room.profile is None:
                room.profile = OccupancyProfile()
            target = room.profile
        else:
            target = room
        if getattr(target, field) != value:
            record(db, user, project_id, "room", room.id, field, getattr(target, field), value, reason)
            setattr(target, field, value)
    if changes.get("name"):
        room.suggested_occupancy = suggest_occupancy(room.name)
    # Choosing a class is the person's confirmation; going back to UNKNOWN withdraws it.
    if "occupancy_classification" in changes and "occupancy_confirmed" not in changes:
        room.occupancy_confirmed = room.occupancy_classification != "UNKNOWN"
    invalidate_verification(db, user, project_id, "שינוי חדר")


@router.patch("/rooms/{room_id}")
def update_room(project_id: str, room_id: str, body: RoomPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = get_owned(db, Room, room_id, project_id, "החדר")
    _apply_room_changes(db, user, project_id, room, body.model_dump(exclude_unset=True, exclude={"reason"}), body.reason)
    db.commit()
    return _room_dict(room)


@router.delete("/rooms/{room_id}")
def delete_room(project_id: str, room_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = get_owned(db, Room, room_id, project_id, "החדר")
    record(db, user, project_id, "room", room.id, "deleted", room.name, None)
    invalidate_verification(db, user, project_id, "נמחק חדר")
    db.delete(room)
    db.commit()
    return {"ok": True}


# ── Sources ─────────────────────────────────────────────────────────────


def _validate_source_value(field: str, value) -> None:
    """Rejects a value the engine could not use, at the moment it is entered."""
    if value is None:
        return
    if field == "arrangement" and value not in ARRANGEMENTS:
        raise HTTPException(422, "סידור מוליכים לא מוכר")
    if field == "current_basis" and value not in CURRENT_BASES:
        raise HTTPException(422, "בסיס זרם לא מוכר")
    if field == "model_type" and value not in EMPIRICAL_MODEL_TYPES:
        raise HTTPException(422, "סוג מודל לא נתמך")
    if field in ("current_a", "spacing_m", "bar_width_m", "box_height_m", "reference_current_a", "load_factor", "decay_exponent"):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            raise HTTPException(422, f"{field}: נדרש מספר לא שלילי")
    if field in ("spacing_m", "bar_width_m", "box_height_m", "reference_current_a") and value == 0:
        raise HTTPException(422, f"{field}: נדרש ערך חיובי")
    if field == "reference_curve":
        try:
            valid = bool(value) and all(len(p) == 2 and float(p[0]) > 0 and float(p[1]) > 0 for p in value)
            distances = [float(p[0]) for p in value]
        except (TypeError, ValueError):
            valid, distances = False, []
        if not valid or len(set(distances)) != len(distances):
            raise HTTPException(422, "נתוני ייחוס: נדרשים זוגות חיוביים של מרחק ושדה, בלי מרחק כפול")
    if field in ("phase_currents_a", "phase_angles_deg"):
        if not isinstance(value, list) or len(value) != 3 or not all(isinstance(v, (int, float)) for v in value):
            raise HTTPException(422, f"{field}: נדרשים שלושה ערכים מספריים")


@router.get("/sources")
def list_sources(project_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ElectricalSource).where(ElectricalSource.project_id == project_id).order_by(ElectricalSource.tag))
    return [source_to_dict(row) for row in rows]


@router.post("/sources", status_code=201)
def add_source(project_id: str, body: SourceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned(db, Floor, body.floor_id, project_id, "הקומה")
    if body.source_type not in SOURCE_TYPES:
        raise HTTPException(422, "סוג מקור לא מוכר")
    if db.scalar(select(ElectricalSource).where(ElectricalSource.project_id == project_id, ElectricalSource.tag == body.tag)):
        raise HTTPException(409, f"התג {body.tag} כבר קיים בפרויקט")
    source = ElectricalSource(
        project_id=project_id,
        floor_id=body.floor_id,
        tag=body.tag,
        source_type=body.source_type,
        geometry={"points": [[float(x), float(y)] for x, y in body.points]},
    )
    ensure_details(source)
    db.add(source)
    db.flush()
    record(db, user, project_id, "source", source.id, "created", None, source.tag)
    invalidate_verification(db, user, project_id, "נוסף מקור")
    db.commit()
    return source_to_dict(source)


def _apply_source_changes(db: Session, user: User, project_id: str, source: ElectricalSource, changes: dict, reason: str) -> None:
    allowed = settable_fields(source)
    for field, value in changes.items():
        if field == "points":
            value = [[float(x), float(y)] for x, y in value]
            record(db, user, project_id, "source", source.id, "points", source.geometry.get("points"), value, reason)
            source.geometry = {**source.geometry, "points": value}
            continue
        if field == "z_values":
            if value is not None and len(value) != len(source.geometry.get("points", [])):
                raise HTTPException(422, "z_values: נדרש ערך לכל נקודה")
            record(db, user, project_id, "source", source.id, "z_values", source.geometry.get("z_values"), value, reason)
            source.geometry = {**source.geometry, "z_values": value}
            continue
        if field == "floor_id":
            get_owned(db, Floor, value, project_id, "הקומה")
            record(db, user, project_id, "source", source.id, "floor_id", source.floor_id, value, reason)
            source.floor_id = value
            continue
        if field not in allowed:
            raise HTTPException(422, f"השדה {field} אינו רלוונטי למקור מסוג {source.source_type}")
        _validate_source_value(field, value)
        if field == "tag":
            duplicate = db.scalar(
                select(ElectricalSource).where(
                    ElectricalSource.project_id == project_id, ElectricalSource.tag == value, ElectricalSource.id != source.id
                )
            )
            if duplicate:
                raise HTTPException(409, f"התג {value} כבר קיים בפרויקט")
        old = get_field(source, field)
        if old != value:
            record(db, user, project_id, "source", source.id, field, old, value, reason)
            set_field(source, field, value)
    invalidate_verification(db, user, project_id, "שינוי מקור")


@router.patch("/sources/{source_id}")
def update_source(project_id: str, source_id: str, body: SourcePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    source = get_owned(db, ElectricalSource, source_id, project_id, "המקור")
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    _apply_source_changes(db, user, project_id, source, changes, body.reason)
    db.commit()
    return source_to_dict(source)


@router.delete("/sources/{source_id}")
def delete_source(project_id: str, source_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    source = get_owned(db, ElectricalSource, source_id, project_id, "המקור")
    record(db, user, project_id, "source", source.id, "deleted", source.tag, None)
    invalidate_verification(db, user, project_id, "נמחק מקור")
    db.delete(source)
    db.commit()
    return {"ok": True}


# ── Answers ─────────────────────────────────────────────────────────────


@router.post("/answers")
def answer(project_id: str, body: AnswerIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One question answered, through the same validation as a direct edit."""
    reason = body.reason or "תשובה בשאלון"
    if body.target_type == "floor":
        floor = get_owned(db, Floor, body.target_id, project_id, "הקומה")
        if body.field not in ("elevation_m", "ceiling_height_m"):
            raise HTTPException(422, "שדה לא מוכר")
        record(db, user, project_id, "floor", floor.id, body.field, getattr(floor, body.field), body.value, reason)
        setattr(floor, body.field, body.value)
        invalidate_verification(db, user, project_id, "תשובה בשאלון")
    elif body.target_type == "room":
        room = get_owned(db, Room, body.target_id, project_id, "החדר")
        changes = RoomPatch(**{body.field: body.value}).model_dump(exclude_unset=True, exclude={"reason"})
        _apply_room_changes(db, user, project_id, room, changes, reason)
    else:
        source = get_owned(db, ElectricalSource, body.target_id, project_id, "המקור")
        _apply_source_changes(db, user, project_id, source, {body.field: body.value}, reason)
    db.commit()
    return {"ok": True}
