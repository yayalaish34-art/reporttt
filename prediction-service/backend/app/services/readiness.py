"""What stands between this project and a final report, in the engineer's terms."""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import CalculationRun, ElectricalSource, Floor, Project, RegulationRule, Room
from .regulation_rules import load_engine_rules, rules_for_room
from .source_model import missing_fields

FIELD_LABELS = {
    "location": "מיקום",
    "height_above_floor_m": "גובה מעל מפלס הקומה",
    "current_a": "זרם",
    "current_basis": "בסיס הזרם (Rated/Design/Measured/Estimated)",
    "arrangement": "סידור מוליכים",
    "spacing_m": "מרחק בין מוליכים",
    "bar_width_m": "רוחב פס",
    "model_type": "סוג מודל",
    "box_height_m": "גובה הגוף",
    "reference_curve": "נתוני ייחוס של שדה",
    "reference_current_a": "זרם ייחוס",
    "decay_exponent": "מעריך דעיכה",
    "reference_source": "מקור נתוני הייחוס",
}


def _blocker(code: str, target: str, message: str) -> dict:
    return {"code": code, "target": target, "message": message, "status": "MISSING_DATA"}


def project_blockers(db: Session, project: Project) -> list[dict]:
    floors = list(db.scalars(select(Floor).where(Floor.project_id == project.id)))
    rooms = list(
        db.scalars(select(Room).options(selectinload(Room.profile)).where(Room.project_id == project.id))
    )
    sources = list(db.scalars(select(ElectricalSource).where(ElectricalSource.project_id == project.id)))
    floor_name = {floor.id: floor.name for floor in floors}
    blockers = []

    if not floors:
        blockers.append(_blocker("NO_FLOORS", "project", "לא הוגדרו קומות"))
    for floor in floors:
        if floor.elevation_m is None:
            blockers.append(_blocker("FLOOR_ELEVATION", floor.name, f"קומה {floor.name}: חסר גובה מפלס"))
        if floor.scale_m_per_px is None or not floor.origin_px:
            blockers.append(_blocker("FLOOR_CALIBRATION", floor.name, f"קומה {floor.name}: חסרים כיול ונקודת ייחוס"))

    if not rooms:
        blockers.append(_blocker("NO_ROOMS", "project", "לא הוגדרו חדרים"))
    if not sources:
        blockers.append(_blocker("NO_SOURCES", "project", "לא הוגדרו מקורות קרינה"))

    for source in sources:
        for field in missing_fields(source):
            label = FIELD_LABELS.get(field, field)
            blockers.append(_blocker(f"SOURCE_{field.upper()}", source.tag, f"{source.tag}: חסר {label}"))
        if source.confidence == "LOW" and not source.user_verified:
            blockers.append(_blocker("LOW_CONFIDENCE", source.tag, f"{source.tag}: זיהוי ברמת ודאות נמוכה דורש אימות"))
        if source.model_type == "TRANSFORMER_NUMERICAL":
            blockers.append(_blocker("MODEL_UNSUPPORTED", source.tag, f"{source.tag}: מודל שנאי מספרי עדיין לא נתמך"))

    rules = load_engine_rules(db)
    for room in rooms:
        where = f"{floor_name.get(room.floor_id, '')} / {room.name}"
        if not room.occupancy_confirmed or room.occupancy_classification == "UNKNOWN":
            blockers.append(_blocker("ROOM_OCCUPANCY", where, f"{where}: סיווג השהייה לא אושר"))
            continue
        chosen = rules_for_room(rules, project, room)
        if not chosen:
            blockers.append(_blocker("REGULATION_RULE", where, f"{where}: אין כלל רגולטורי מאומת ותקף שחל על החדר"))
        needs_hours = any(rule.threshold_type == "TIME_AVERAGED" for rule in chosen)
        if needs_hours and (room.profile is None or room.profile.hours_per_day is None):
            blockers.append(_blocker("ROOM_HOURS", where, f"{where}: חסרות שעות שהייה"))

    if not project.model_verified:
        blockers.append(_blocker("MODEL_NOT_VERIFIED", "project", "המודל לא אושר (MODEL VERIFIED)"))
    return blockers


def _naive(moment):
    return moment.replace(tzinfo=None) if moment is not None else None


def run_staleness(db: Session, project: Project, run: CalculationRun) -> list[dict]:
    """Whether the world moved after this run: a re-verified model or changed rules."""
    blockers = []
    verified_at = _naive(project.model_verified_at)
    if verified_at is not None and verified_at > _naive(run.created_at):
        blockers.append(_blocker("RUN_STALE", "run", "המודל השתנה ואושר מחדש אחרי הריצה. יש להריץ חישוב חדש."))
    # The building type decides which rules apply, so a changed type voids the run's statuses.
    if run.input_snapshot.get("project", {}).get("building_type") != project.building_type:
        blockers.append(_blocker("RUN_STALE", "run", "סוג המבנה שונה אחרי הריצה. יש להריץ חישוב חדש."))
    in_force = {row.id for row in db.scalars(select(RegulationRule)) if row.active and row.verified_at}
    used = {rule["id"] for rule in run.input_snapshot.get("regulation_rules", [])}
    if in_force != used:
        blockers.append(_blocker("RULES_CHANGED", "run", "הכללים הרגולטוריים השתנו אחרי הריצה. יש להריץ חישוב חדש."))
    if not run.is_final and not blockers:
        blockers.append(_blocker("RUN_PRELIMINARY", "run", "הריצה בוצעה לפני שהמודל הושלם. יש להריץ חישוב חדש."))
    return blockers
