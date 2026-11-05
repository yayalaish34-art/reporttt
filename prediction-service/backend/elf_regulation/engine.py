"""Selects the rules in force for a room and judges its field against them."""

from dataclasses import dataclass, field
from datetime import date

from elf_engine.exposure import calculate_normalized_exposure

PASS = "PASS"
FAIL = "FAIL"
REVIEW_REQUIRED = "REGULATION_REVIEW_REQUIRED"

INSTANTANEOUS_MAX = "INSTANTANEOUS_MAX"
TIME_AVERAGED = "TIME_AVERAGED"


@dataclass(frozen=True)
class Rule:
    id: str
    country: str
    document_name: str
    document_version: str | None
    effective_date: date | None
    frequency_hz: float
    occupancy_type: str | None
    building_types: tuple[str, ...]
    threshold: float
    threshold_type: str
    averaging_hours: float | None
    active: bool
    verified: bool
    superseded_at: date | None = None
    background_mg: float = 0.0


@dataclass(frozen=True)
class RoomContext:
    country: str
    building_type: str
    occupancy_type: str
    occupancy_confirmed: bool
    occupancy_hours: float | None
    evaluation_date: date
    frequency_hz: float = 50.0


@dataclass
class RoomEvaluation:
    status: str
    checks: list[dict] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)


def _in_force(rule: Rule, on: date) -> bool:
    if rule.effective_date is None or rule.effective_date > on:
        return False
    return rule.superseded_at is None or rule.superseded_at > on


def applicable_rules(rules: list[Rule], context: RoomContext) -> list[Rule]:
    """Rules in force for this room; of several versions of a document, only the latest."""
    matching = [
        rule
        for rule in rules
        if rule.active
        and rule.verified
        and rule.country == context.country
        and rule.frequency_hz == context.frequency_hz
        and _in_force(rule, context.evaluation_date)
        and (rule.occupancy_type is None or rule.occupancy_type == context.occupancy_type)
        and (not rule.building_types or context.building_type in rule.building_types)
    ]
    latest: dict[tuple, Rule] = {}
    for rule in matching:
        key = (rule.document_name, rule.threshold_type, rule.occupancy_type)
        if key not in latest or rule.effective_date > latest[key].effective_date:
            latest[key] = rule
    return list(latest.values())


def evaluate_room(max_field_mg: float | None, rules: list[Rule], context: RoomContext) -> RoomEvaluation:
    if max_field_mg is None:
        return RoomEvaluation(REVIEW_REQUIRED, reasons=["אין ערך שדה מחושב לחדר"])
    if not context.occupancy_confirmed:
        return RoomEvaluation(REVIEW_REQUIRED, reasons=["סיווג השהייה בחדר לא אושר"])

    chosen = applicable_rules(rules, context)
    if not chosen:
        return RoomEvaluation(REVIEW_REQUIRED, reasons=["אין כלל רגולטורי מאומת ותקף שחל על החדר"])

    result = RoomEvaluation(PASS)
    undecided = False
    for rule in chosen:
        check = {
            "rule_id": rule.id,
            "document_name": rule.document_name,
            "threshold_mg": rule.threshold,
            "threshold_type": rule.threshold_type,
        }
        if rule.threshold_type == TIME_AVERAGED:
            if context.occupancy_hours is None or rule.averaging_hours is None:
                undecided = True
                check["status"] = REVIEW_REQUIRED
                result.reasons.append(f"{rule.document_name}: חסרות שעות שהייה לחישוב ממוצע זמן")
                result.checks.append(check)
                continue
            normalized = calculate_normalized_exposure(
                max_field_mg, context.occupancy_hours, rule.averaging_hours, background_mg=rule.background_mg
            )
            compared = normalized.normalized_field_mg
            check["normalization"] = {
                "raw_field_mg": normalized.raw_field_mg,
                "occupancy_hours": normalized.occupancy_hours,
                "averaging_hours": normalized.averaging_hours,
                "load_factor": normalized.load_factor,
                "normalization_method": normalized.normalization_method,
                "normalized_field_mg": normalized.normalized_field_mg,
            }
        else:
            compared = max_field_mg
        check["compared_mg"] = compared
        check["status"] = FAIL if compared > rule.threshold else PASS
        result.checks.append(check)

    # A missing hours figure must not hide a limit that is already exceeded.
    if any(check["status"] == FAIL for check in result.checks):
        result.status = FAIL
    elif undecided:
        result.status = REVIEW_REQUIRED
    return result
