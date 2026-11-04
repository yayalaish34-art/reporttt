"""The questionnaire: only what is missing, derived from the model itself.

No transformer in the project means no transformer question, because there is no
transformer row to ask about. Nothing here is pre-filled with an answer.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..constants import ARRANGEMENTS, CURRENT_BASES, EMPIRICAL_MODEL_TYPES, OCCUPANCY_TYPES
from ..models import ElectricalSource, Floor, Project, Room
from .regulation_rules import load_engine_rules, rules_for_room
from .source_model import details_of, missing_fields

_SOURCE_PROMPTS = {
    "height_above_floor_m": ("מה גובה {tag} מעל מפלס הקומה?", "number", "מ׳", None),
    "current_a": ("מה הזרם של {tag}?", "number", "A", None),
    "current_basis": ("הזרם של {tag} הוא:", "select", None, CURRENT_BASES),
    "arrangement": ("איך מונחים מוליכי הפאזות של {tag}?", "select", None, ARRANGEMENTS),
    "spacing_m": ("מה המרחק בין המוליכים של {tag}?", "number", "מ׳", None),
    "bar_width_m": ("מה רוחב הפס של {tag}?", "number", "מ׳", None),
    "model_type": ("איזה מודל מתאר את {tag}?", "select", None, EMPIRICAL_MODEL_TYPES),
    "box_height_m": ("מה גובה הגוף של {tag}?", "number", "מ׳", None),
    "reference_curve": ("נתוני ייחוס של {tag}: מרחק מפני הגוף ושדה", "curve", "מ׳, mG", None),
    "reference_current_a": ("באיזה זרם נמדדו נתוני הייחוס של {tag}?", "number", "A", None),
    "decay_exponent": ("מה מעריך הדעיכה של {tag}? (נדרש כי יש נקודת ייחוס אחת)", "number", None, None),
    "reference_source": ("מה מקור נתוני הייחוס של {tag}?", "text", None, None),
}


def _question(target_type, target_id, field, prompt, input_type, unit=None, options=None, group="") -> dict:
    return {
        "id": f"{target_type}:{target_id}:{field}",
        "target_type": target_type,
        "target_id": target_id,
        "field": field,
        "prompt": prompt,
        "input_type": input_type,
        "unit": unit,
        "options": list(options) if options else None,
        "group": group,
    }


def project_questions(db: Session, project: Project) -> list[dict]:
    questions = []

    for floor in db.scalars(select(Floor).where(Floor.project_id == project.id).order_by(Floor.sort_order)):
        if floor.elevation_m is None:
            questions.append(
                _question("floor", floor.id, "elevation_m", f"מה גובה מפלס {floor.name}?", "number", "מ׳", group="קומות")
            )

    for source in db.scalars(
        select(ElectricalSource).where(ElectricalSource.project_id == project.id).order_by(ElectricalSource.tag)
    ):
        for field in missing_fields(source):
            if field == "location":
                continue  # Drawn on the plan, not typed.
            prompt, input_type, unit, options = _SOURCE_PROMPTS[field]
            questions.append(
                _question("source", source.id, field, prompt.format(tag=source.tag), input_type, unit, options, source.tag)
            )
        # An optional answer, but it changes the current used, so it is asked and never assumed.
        if source.load_factor is None and details_of(source) is not None:
            questions.append(
                _question(
                    "source",
                    source.id,
                    "load_factor",
                    f"מה מקדם העומס הצפוי של {source.tag}? (ריק = הזרם שהוזן מחושב במלואו)",
                    "optional_number",
                    group=source.tag,
                )
            )

    rules = load_engine_rules(db)
    for room in db.scalars(
        select(Room).options(selectinload(Room.profile)).where(Room.project_id == project.id).order_by(Room.name)
    ):
        if not room.occupancy_confirmed:
            questions.append(
                _question(
                    "room",
                    room.id,
                    "occupancy_classification",
                    f"מה סיווג השהייה ב{room.name}? (הצעת המערכת: {room.suggested_occupancy})",
                    "select",
                    None,
                    OCCUPANCY_TYPES[:2],
                    "חדרים",
                )
            )
        elif room.profile is None or room.profile.hours_per_day is None:
            needs_hours = any(rule.threshold_type == "TIME_AVERAGED" for rule in rules_for_room(rules, project, room))
            if needs_hours:
                questions.append(
                    _question("room", room.id, "hours_per_day", f"כמה שעות ביום צפויה שהייה ב{room.name}?", "number", "שעות", group="חדרים")
                )
    return questions
