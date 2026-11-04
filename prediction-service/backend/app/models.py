"""Database tables. A NULL measurement is MISSING_DATA, so inputs have no defaults."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _id() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True, default=new_id)


def _project_fk() -> Mapped[str]:
    return mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = _id()
    email: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="ENGINEER")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = _id()
    client_name: Mapped[str] = mapped_column(String(255))
    # The CRM's id for the customer, picked in the reports system, so the job stays tied to them.
    customer_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str] = mapped_column(String(100), default="", server_default="")
    contact_email: Mapped[str] = mapped_column(String(255), default="", server_default="")
    project_name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(500), default="")
    project_number: Mapped[str] = mapped_column(String(100), default="")
    ordered_by: Mapped[str] = mapped_column(String(255), default="")
    electrical_engineer: Mapped[str] = mapped_column(String(255), default="")
    architect: Mapped[str] = mapped_column(String(255), default="")
    project_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    building_type: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(Text, default="")
    country: Mapped[str] = mapped_column(String(2), default="IL")
    model_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    model_verified_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    model_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Answers given in the automatic flow, so the model can be rebuilt from them at any time.
    auto_settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    file_name: Mapped[str] = mapped_column(String(500))
    file_type: Mapped[str] = mapped_column(String(10))
    document_type: Mapped[str] = mapped_column(String(30))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    upload_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="CURRENT")
    page_count: Mapped[int] = mapped_column(Integer, default=1)
    storage_key: Mapped[str] = mapped_column(String(255))


class PageAnalysis(Base):
    """What the vision model read on one plan page, as it came back (after shape checks)."""

    __tablename__ = "page_analyses"
    __table_args__ = (UniqueConstraint("document_id", "page"),)

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    result: Mapped[dict] = mapped_column(JSON)
    model: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class Floor(Base):
    __tablename__ = "floors"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    ceiling_height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    plan_document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    plan_page: Mapped[int] = mapped_column(Integer, default=0)
    scale_m_per_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin_px: Mapped[list | None] = mapped_column(JSON, nullable=True)
    calibration: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    floor_id: Mapped[str] = mapped_column(ForeignKey("floors.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    polygon_m: Mapped[list] = mapped_column(JSON)
    area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    usage_type: Mapped[str] = mapped_column(String(100), default="")
    suggested_occupancy: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
    occupancy_classification: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
    occupancy_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[str] = mapped_column(String(10), default="HIGH")
    detection_method: Mapped[str] = mapped_column(String(30), default="MANUAL")
    source_document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)

    profile: Mapped["OccupancyProfile | None"] = relationship(
        back_populates="room", uselist=False, cascade="all, delete-orphan"
    )


class OccupancyProfile(Base):
    __tablename__ = "occupancy_profiles"

    id: Mapped[str] = _id()
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), unique=True)
    hours_per_day: Mapped[float | None] = mapped_column(Float, nullable=True)
    days_per_week: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_note: Mapped[str] = mapped_column(Text, default="")

    room: Mapped[Room] = relationship(back_populates="profile")


class ElectricalSource(Base):
    __tablename__ = "electrical_sources"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    floor_id: Mapped[str] = mapped_column(ForeignKey("floors.id", ondelete="CASCADE"), index=True)
    tag: Mapped[str] = mapped_column(String(50))
    source_type: Mapped[str] = mapped_column(String(30))
    model_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    geometry: Mapped[dict] = mapped_column(JSON)
    height_above_floor_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    voltage_v: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_a: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_basis: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rated_power_kva: Mapped[float | None] = mapped_column(Float, nullable=True)
    load_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    phase_configuration: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    layer: Mapped[str | None] = mapped_column(String(100), nullable=True)
    confidence: Mapped[str] = mapped_column(String(10), default="HIGH")
    detection_method: Mapped[str] = mapped_column(String(30), default="MANUAL")
    user_verified: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    cable: Mapped["Cable | None"] = relationship(back_populates="source", uselist=False, cascade="all, delete-orphan")
    transformer: Mapped["Transformer | None"] = relationship(
        back_populates="source", uselist=False, cascade="all, delete-orphan"
    )
    panel: Mapped["Panel | None"] = relationship(back_populates="source", uselist=False, cascade="all, delete-orphan")


class Cable(Base):
    __tablename__ = "cables"

    id: Mapped[str] = _id()
    source_id: Mapped[str] = mapped_column(ForeignKey("electrical_sources.id", ondelete="CASCADE"), unique=True)
    arrangement: Mapped[str | None] = mapped_column(String(30), nullable=True)
    spacing_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    bar_width_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    phase_currents_a: Mapped[list | None] = mapped_column(JSON, nullable=True)
    phase_angles_deg: Mapped[list | None] = mapped_column(JSON, nullable=True)
    coherence_group: Mapped[str | None] = mapped_column(String(100), nullable=True)

    source: Mapped[ElectricalSource] = relationship(back_populates="cable")


class _EmpiricalDetails:
    box_height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    reference_curve: Mapped[list | None] = mapped_column(JSON, nullable=True)
    reference_current_a: Mapped[float | None] = mapped_column(Float, nullable=True)
    decay_exponent: Mapped[float | None] = mapped_column(Float, nullable=True)
    reference_source: Mapped[str | None] = mapped_column(Text, nullable=True)


class Transformer(_EmpiricalDetails, Base):
    __tablename__ = "transformers"

    id: Mapped[str] = _id()
    source_id: Mapped[str] = mapped_column(ForeignKey("electrical_sources.id", ondelete="CASCADE"), unique=True)
    primary_voltage_v: Mapped[float | None] = mapped_column(Float, nullable=True)
    secondary_voltage_v: Mapped[float | None] = mapped_column(Float, nullable=True)

    source: Mapped[ElectricalSource] = relationship(back_populates="transformer")


class Panel(_EmpiricalDetails, Base):
    __tablename__ = "panels"

    id: Mapped[str] = _id()
    source_id: Mapped[str] = mapped_column(ForeignKey("electrical_sources.id", ondelete="CASCADE"), unique=True)

    source: Mapped[ElectricalSource] = relationship(back_populates="panel")


class Scenario(Base):
    __tablename__ = "calculation_scenarios"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30), default="NORMAL")
    # 1.0 means "the currents as entered", which invents nothing.
    current_factor: Mapped[float] = mapped_column(Float, default=1.0)
    uncertainty_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    configuration: Mapped[str] = mapped_column(Text, default="")
    shielding: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class CalculationRun(Base):
    __tablename__ = "calculation_runs"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    scenario_id: Mapped[str | None] = mapped_column(ForeignKey("calculation_scenarios.id", ondelete="SET NULL"), nullable=True)
    scenario_name: Mapped[str] = mapped_column(String(200), default="")
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    blockers: Mapped[list] = mapped_column(JSON, default=list)
    excluded_sources: Mapped[list] = mapped_column(JSON, default=list)
    grid_step_m: Mapped[float] = mapped_column(Float)
    heights_m: Mapped[list] = mapped_column(JSON)
    combination_method: Mapped[str] = mapped_column(String(40))
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    input_hash: Mapped[str] = mapped_column(String(64))
    engine_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class CalculationPoint(Base):
    """The grid points of one room at one height, as parallel arrays.

    A row per point cost about 400 bytes each, so 100 runs would have filled a 1 GB
    database. Every point is still here, and any location can be recomputed exactly
    from the run's frozen inputs.
    """

    __tablename__ = "calculation_points"
    __table_args__ = (Index("ix_points_run_floor_height", "run_id", "floor_id", "height_m"),)

    id: Mapped[str] = _id()
    run_id: Mapped[str] = mapped_column(ForeignKey("calculation_runs.id", ondelete="CASCADE"))
    room_id: Mapped[str | None] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    floor_id: Mapped[str | None] = mapped_column(ForeignKey("floors.id", ondelete="SET NULL"), nullable=True)
    height_m: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    xs: Mapped[list] = mapped_column(JSON)
    ys: Mapped[list] = mapped_column(JSON)
    # None marks a point too close to a source to have a value.
    predicted_mg: Mapped[list] = mapped_column(JSON)
    dominant_source_tags: Mapped[list] = mapped_column(JSON)


class CalculationResult(Base):
    __tablename__ = "calculation_results"

    id: Mapped[str] = _id()
    run_id: Mapped[str] = mapped_column(ForeignKey("calculation_runs.id", ondelete="CASCADE"), index=True)
    room_id: Mapped[str | None] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    room_name: Mapped[str] = mapped_column(String(200))
    floor_name: Mapped[str] = mapped_column(String(100))
    usage_type: Mapped[str] = mapped_column(String(100), default="")
    occupancy_classification: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
    occupancy_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_m: Mapped[float] = mapped_column(Float)
    max_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_point: Mapped[list | None] = mapped_column(JSON, nullable=True)
    dominant_source_tag: Mapped[str | None] = mapped_column(String(50), nullable=True)
    dominant_source_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    dominant_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    without_dominant_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    contributions: Mapped[dict] = mapped_column(JSON, default=dict)
    sensitivity: Mapped[dict] = mapped_column(JSON, default=dict)
    extrapolated: Mapped[bool] = mapped_column(Boolean, default=False)
    too_close_points: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(40))
    status_reasons: Mapped[list] = mapped_column(JSON, default=list)
    rule_checks: Mapped[list] = mapped_column(JSON, default=list)


class RegulationRule(Base):
    __tablename__ = "regulation_rules"

    id: Mapped[str] = _id()
    country: Mapped[str] = mapped_column(String(2), default="IL")
    authority: Mapped[str] = mapped_column(String(255), default="")
    instrument_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    document_name: Mapped[str] = mapped_column(String(500), default="")
    document_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    frequency_hz: Mapped[float] = mapped_column(Float, default=50.0)
    frequency_range: Mapped[str] = mapped_column(String(50), default="")
    occupancy_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    building_types: Mapped[list] = mapped_column(JSON, default=list)
    threshold: Mapped[float] = mapped_column(Float)
    threshold_unit: Mapped[str] = mapped_column(String(10), default="mG")
    original_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_type: Mapped[str] = mapped_column(String(30))
    averaging_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    superseded_at: Mapped[date | None] = mapped_column(Date, nullable=True)


class Assumption(Base):
    __tablename__ = "assumptions"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    statement: Mapped[str] = mapped_column(Text)
    justification: Mapped[str] = mapped_column(Text, default="")
    target: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(30), default="ENGINEERING_ASSUMPTION")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[str] = _id()
    run_id: Mapped[str] = mapped_column(ForeignKey("calculation_runs.id", ondelete="CASCADE"), index=True)
    result_id: Mapped[str] = mapped_column(ForeignKey("calculation_results.id", ondelete="CASCADE"))
    room_name: Mapped[str] = mapped_column(String(200))
    dominant_source_tag: Mapped[str | None] = mapped_column(String(50), nullable=True)
    explanation: Mapped[str] = mapped_column(Text)
    options: Mapped[list] = mapped_column(JSON)


class ReportVersion(Base):
    __tablename__ = "report_versions"
    __table_args__ = (UniqueConstraint("project_id", "version"),)

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    run_id: Mapped[str] = mapped_column(ForeignKey("calculation_runs.id"))
    comparison_run_id: Mapped[str | None] = mapped_column(ForeignKey("calculation_runs.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    blockers: Mapped[list] = mapped_column(JSON, default=list)
    storage_key: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Measurement(Base):
    __tablename__ = "measurements"

    id: Mapped[str] = _id()
    project_id: Mapped[str] = _project_fk()
    label: Mapped[str] = mapped_column(String(200), default="")
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    original_value: Mapped[float] = mapped_column(Float)
    original_unit: Mapped[str] = mapped_column(String(10))
    measured_mg: Mapped[float] = mapped_column(Float)
    measured_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    instrument: Mapped[str] = mapped_column(String(200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class ValidationResult(Base):
    __tablename__ = "validation_results"

    id: Mapped[str] = _id()
    measurement_id: Mapped[str] = mapped_column(ForeignKey("measurements.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("calculation_runs.id", ondelete="CASCADE"), index=True)
    predicted_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_mg: Mapped[float] = mapped_column(Float)
    absolute_error: Mapped[float | None] = mapped_column(Float, nullable=True)
    percentage_error: Mapped[float | None] = mapped_column(Float, nullable=True)
    engine_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = _id()
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_email: Mapped[str] = mapped_column(String(255), default="")
    entity: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(36))
    field: Mapped[str] = mapped_column(String(100))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
