from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .constants import BUILDING_TYPES, INSTRUMENT_TYPES, OCCUPANCY_TYPES, SCENARIO_KINDS, THRESHOLD_TYPES


class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    email: str
    full_name: str = ""
    password: str = Field(min_length=10)
    role: Literal["ENGINEER", "APPROVER", "ADMIN"] = "ENGINEER"


class ProjectIn(BaseModel):
    client_name: str = Field(min_length=1)
    customer_id: str | None = None
    contact_phone: str = ""
    contact_email: str = ""
    project_name: str = Field(min_length=1)
    address: str = ""
    project_number: str = ""
    ordered_by: str = ""
    electrical_engineer: str = ""
    architect: str = ""
    project_date: date | None = None
    building_type: str
    description: str = ""

    @field_validator("building_type")
    @classmethod
    def known_building_type(cls, value: str) -> str:
        if value not in BUILDING_TYPES:
            raise ValueError("סוג מבנה לא מוכר")
        return value


class ProjectPatch(BaseModel):
    client_name: str | None = None
    customer_id: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    building_type: str | None = None
    project_name: str | None = None
    address: str | None = None
    project_number: str | None = None
    ordered_by: str | None = None
    electrical_engineer: str | None = None
    architect: str | None = None
    project_date: date | None = None
    description: str | None = None
    reason: str = ""

    @field_validator("building_type")
    @classmethod
    def known_building_type(cls, value: str | None) -> str | None:
        if value is not None and value not in BUILDING_TYPES:
            raise ValueError("סוג מבנה לא מוכר")
        return value


class UploadPermitIn(BaseModel):
    pathname: str


class RegisterUploadIn(BaseModel):
    pathname: str
    file_name: str
    document_type: str


class FloorIn(BaseModel):
    name: str = Field(min_length=1)
    sort_order: int = 0
    elevation_m: float | None = None
    ceiling_height_m: float | None = None
    plan_document_id: str | None = None
    plan_page: int = 0


class FloorPatch(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    elevation_m: float | None = None
    ceiling_height_m: float | None = None
    plan_document_id: str | None = None
    plan_page: int | None = None
    reason: str = ""


class CalibrationIn(BaseModel):
    p1: tuple[float, float]
    p2: tuple[float, float]
    distance_m: float = Field(gt=0)
    reason: str = ""


class OriginIn(BaseModel):
    origin_px: tuple[float, float]
    reason: str = ""


class RoomIn(BaseModel):
    floor_id: str
    name: str = Field(min_length=1)
    polygon_m: list[tuple[float, float]] = Field(min_length=3)
    usage_type: str = ""


class RoomPatch(BaseModel):
    name: str | None = None
    polygon_m: list[tuple[float, float]] | None = None
    usage_type: str | None = None
    occupancy_classification: str | None = None
    occupancy_confirmed: bool | None = None
    hours_per_day: float | None = Field(default=None, ge=0, le=24)
    days_per_week: float | None = Field(default=None, ge=0, le=7)
    source_note: str | None = None
    reason: str = ""

    @field_validator("occupancy_classification")
    @classmethod
    def known_class(cls, value: str | None) -> str | None:
        if value is not None and value not in OCCUPANCY_TYPES:
            raise ValueError("סיווג שהייה לא מוכר")
        return value


class SourceIn(BaseModel):
    floor_id: str
    tag: str = Field(min_length=1)
    source_type: str
    points: list[tuple[float, float]] = Field(min_length=2)


class SourcePatch(BaseModel):
    """Only fields the caller sent are touched, so an explicit null clears a value."""

    model_config = {"extra": "allow"}

    reason: str = ""
    points: list[tuple[float, float]] | None = None
    z_values: list[float] | None = None
    floor_id: str | None = None


class AnswerIn(BaseModel):
    target_type: Literal["floor", "room", "source"]
    target_id: str
    field: str
    value: float | str | list | bool | None
    reason: str = ""


class AssumptionIn(BaseModel):
    statement: str = Field(min_length=1)
    justification: str = Field(min_length=1)
    target: str = ""


class VerifyIn(BaseModel):
    verified: bool
    reason: str = ""


class ScenarioIn(BaseModel):
    name: str = Field(min_length=1)
    kind: str = "NORMAL"
    current_factor: float = Field(default=1.0, gt=0)
    uncertainty_pct: float | None = Field(default=None, ge=0, lt=100)
    source_overrides: dict = Field(default_factory=dict)
    configuration: str = ""
    shielding: str = ""
    notes: str = ""

    @field_validator("kind")
    @classmethod
    def known_kind(cls, value: str) -> str:
        if value not in SCENARIO_KINDS:
            raise ValueError("סוג תרחיש לא מוכר")
        return value

    @field_validator("source_overrides")
    @classmethod
    def shielding_must_cite_a_source(cls, value: dict) -> dict:
        for override in value.values():
            factor = override.get("attenuation_factor")
            if factor is None:
                continue
            if not 0 <= factor <= 1:
                raise ValueError("מקדם מיגון חייב להיות בין 0 ל-1")
            if not override.get("attenuation_source"):
                raise ValueError("מקדם מיגון מחייב ציון מקור: מדידה, יצרן או חישוב")
        return value


class RunIn(BaseModel):
    scenario_id: str
    grid_step_m: float = Field(default=0.5, ge=0.1, le=2.0)
    heights_m: list[float] = Field(min_length=1)


class RegulationRuleIn(BaseModel):
    country: str = "IL"
    authority: str = ""
    instrument_type: str | None = None
    document_name: str = Field(min_length=1)
    document_version: str | None = None
    effective_date: date | None = None
    source_url: str | None = None
    frequency_hz: float = 50.0
    frequency_range: str = ""
    occupancy_type: str | None = None
    building_types: list[str] = Field(default_factory=list)
    threshold: float = Field(gt=0)
    threshold_unit: str = "mG"
    threshold_type: str
    averaging_hours: float | None = None
    notes: str = ""

    @field_validator("instrument_type")
    @classmethod
    def known_instrument(cls, value: str | None) -> str | None:
        if value is not None and value not in INSTRUMENT_TYPES:
            raise ValueError("סוג מסמך לא מוכר")
        return value

    @field_validator("threshold_type")
    @classmethod
    def known_threshold_type(cls, value: str) -> str:
        if value not in THRESHOLD_TYPES:
            raise ValueError("סוג סף לא מוכר")
        return value


class RegulationRulePatch(BaseModel):
    model_config = {"extra": "forbid"}

    authority: str | None = None
    instrument_type: str | None = None
    document_name: str | None = None
    document_version: str | None = None
    effective_date: date | None = None
    source_url: str | None = None
    occupancy_type: str | None = None
    building_types: list[str] | None = None
    threshold: float | None = Field(default=None, gt=0)
    threshold_type: str | None = None
    averaging_hours: float | None = None
    superseded_at: date | None = None
    notes: str | None = None
    reason: str = ""


class ActivateIn(BaseModel):
    active: bool
    reason: str = Field(min_length=1)


class ReportIn(BaseModel):
    run_id: str
    comparison_run_id: str | None = None


class TransitionIn(BaseModel):
    status: str
    reason: str = ""


class MeasurementIn(BaseModel):
    label: str = ""
    x: float
    y: float
    z: float
    value: float = Field(ge=0)
    unit: str = "mG"
    measured_at: date | None = None
    instrument: str = ""
    notes: str = ""
    run_id: str


