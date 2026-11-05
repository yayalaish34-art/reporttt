"""Translates stored rules for the pure regulation engine, and loads candidates."""

import json
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from elf_regulation import RoomContext, Rule, applicable_rules

from ..models import OccupancyProfile, Project, RegulationRule, Room

DATA = Path(__file__).resolve().parents[2] / "data"
REGULATION_FILE = DATA / "regulation_il.json"

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
        background_mg=row.background_mg or 0.0,
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


def regulation_document() -> dict:
    """The guideline the rules come from: its details and where its file is kept."""
    document = json.loads(REGULATION_FILE.read_text(encoding="utf-8"))["document"]
    return {**document, "path": DATA / document["file"]}


def seed_regulation(db: Session, source_url: str) -> int:
    """Puts the guideline's rules in force, once, in place of every earlier rule."""
    data = json.loads(REGULATION_FILE.read_text(encoding="utf-8"))
    document = data["document"]
    existing = list(db.scalars(select(RegulationRule)))
    current = [
        r for r in existing if r.document_name == document["document_name"] and r.document_version == document["document_version"]
    ]
    if current:
        return 0
    for row in existing:
        db.delete(row)
    now = datetime.now(timezone.utc)
    for rule in data["rules"]:
        db.add(
            RegulationRule(
                country="IL",
                authority=document["authority"],
                instrument_type=document["instrument_type"],
                document_name=document["document_name"],
                document_version=document["document_version"],
                effective_date=date.fromisoformat(document["effective_date"]),
                source_url=source_url,
                frequency_hz=50.0,
                frequency_range="50 Hz",
                threshold_unit="mG",
                active=True,
                verified_at=now,
                **rule,
            )
        )
    db.commit()
    return len(data["rules"])
