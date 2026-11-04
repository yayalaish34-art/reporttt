"""Translates stored rules for the pure regulation engine, and loads candidates."""

import json
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from elf_regulation import RoomContext, Rule, applicable_rules

from ..models import OccupancyProfile, Project, RegulationRule, Room

CANDIDATES_FILE = Path(__file__).resolve().parents[2] / "data" / "regulation_candidates_il.json"

# What the API requires before a rule may go into force.
REQUIRED_TO_ACTIVATE = ("document_name", "document_version", "effective_date", "source_url", "instrument_type")


def rule_row_to_engine(row: RegulationRule) -> Rule:
    return Rule(
        id=row.id,
        country=row.country,
        document_name=row.document_name,
        document_version=row.document_version,
        effective_date=row.effective_date,
        frequency_hz=row.frequency_hz,
        occupancy_type=row.occupancy_type,
        building_types=tuple(row.building_types or ()),
        threshold=row.threshold,
        threshold_type=row.threshold_type,
        averaging_hours=row.averaging_hours,
        active=row.active,
        verified=row.verified_at is not None,
        superseded_at=row.superseded_at,
    )


def load_engine_rules(db: Session) -> list[Rule]:
    return [rule_row_to_engine(row) for row in db.scalars(select(RegulationRule))]


def room_context(project: Project, room: Room, on: date | None = None) -> RoomContext:
    profile: OccupancyProfile | None = room.profile
    return RoomContext(
        country=project.country,
        building_type=project.building_type,
        occupancy_type=room.occupancy_classification,
        occupancy_confirmed=room.occupancy_confirmed,
        occupancy_hours=profile.hours_per_day if profile else None,
        evaluation_date=on or date.today(),
    )


def rules_for_room(rules: list[Rule], project: Project, room: Room) -> list[Rule]:
    return applicable_rules(rules, room_context(project, room))


def seed_candidates(db: Session) -> int:
    """Loads unverified candidates once, inactive. They affect nothing until a person acts."""
    if db.scalars(select(RegulationRule).limit(1)).first() is not None:
        return 0
    candidates = json.loads(CANDIDATES_FILE.read_text(encoding="utf-8"))["rules"]
    for candidate in candidates:
        db.add(RegulationRule(**candidate, active=False))
    db.commit()
    return len(candidates)
