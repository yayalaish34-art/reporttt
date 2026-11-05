"""Bridges a stored electrical source and what the engine needs.

The single place that decides which fields each source type requires, so the
questionnaire, the readiness gate and the calculation can never disagree.
"""

from ..constants import (
    BUSBAR_SOURCE_TYPE,
    LINE_SOURCE_TYPES,
    PANEL_SOURCE_TYPES,
    SHAFT_KEEP_OUT_M,
    SHAFT_SOURCE_TYPES,
    TRANSFORMER_SOURCE_TYPE,
)
from ..models import Cable, ElectricalSource, Floor, Panel, Transformer

_CABLE_FIELDS = ("arrangement", "spacing_m", "bar_width_m", "phase_currents_a", "phase_angles_deg", "coherence_group")
_EMPIRICAL_FIELDS = ("box_height_m", "reference_curve", "reference_current_a", "decay_exponent", "reference_source")
_TRANSFORMER_FIELDS = ("primary_voltage_v", "secondary_voltage_v")
_BASE_FIELDS = (
    "tag",
    "model_type",
    "height_above_floor_m",
    "voltage_v",
    "current_a",
    "current_basis",
    "rated_power_kva",
    "load_factor",
    "phase_configuration",
    "notes",
)


def is_line(source_type: str) -> bool:
    return source_type in LINE_SOURCE_TYPES or source_type == BUSBAR_SOURCE_TYPE


def ensure_details(source: ElectricalSource) -> None:
    if is_line(source.source_type):
        if source.cable is None:
            source.cable = Cable()
    elif source.source_type == TRANSFORMER_SOURCE_TYPE:
        if source.transformer is None:
            source.transformer = Transformer()
    elif source.source_type in PANEL_SOURCE_TYPES and source.panel is None:
        source.panel = Panel()


def details_of(source: ElectricalSource):
    return source.cable or source.transformer or source.panel


def get_field(source: ElectricalSource, name: str):
    if name in _BASE_FIELDS:
        return getattr(source, name)
    details = details_of(source)
    return getattr(details, name, None) if details is not None else None


def settable_fields(source: ElectricalSource) -> tuple[str, ...]:
    if is_line(source.source_type):
        return _BASE_FIELDS + _CABLE_FIELDS
    if source.source_type == TRANSFORMER_SOURCE_TYPE:
        return _BASE_FIELDS + _EMPIRICAL_FIELDS + _TRANSFORMER_FIELDS
    return _BASE_FIELDS + _EMPIRICAL_FIELDS


def set_field(source: ElectricalSource, name: str, value) -> None:
    if name in _BASE_FIELDS:
        setattr(source, name, value)
    else:
        setattr(details_of(source), name, value)


def source_to_dict(source: ElectricalSource) -> dict:
    data = {
        "id": source.id,
        "project_id": source.project_id,
        "floor_id": source.floor_id,
        "source_type": source.source_type,
        "geometry": source.geometry,
        "confidence": source.confidence,
        "detection_method": source.detection_method,
        "user_verified": source.user_verified,
        "source_document_id": source.source_document_id,
        "page": source.page,
        "layer": source.layer,
    }
    for name in settable_fields(source):
        data[name] = get_field(source, name)
    data["missing"] = missing_fields(source)
    return data


def _has_points(source: ElectricalSource, count: int) -> bool:
    return len((source.geometry or {}).get("points") or []) >= count


def missing_fields(source: ElectricalSource) -> list[str]:
    """Every field the calculation needs and does not have, for this source's type."""
    missing = []
    get = lambda name: get_field(source, name)
    if not _has_points(source, 2):
        missing.append("location")
    if get("height_above_floor_m") is None and not (source.geometry or {}).get("z_values"):
        missing.append("height_above_floor_m")

    if is_line(source.source_type):
        if get("current_a") is None and not get("phase_currents_a"):
            missing.append("current_a")
        if not get("arrangement"):
            missing.append("arrangement")
        if get("spacing_m") is None:
            missing.append("spacing_m")
        if source.source_type == BUSBAR_SOURCE_TYPE and get("bar_width_m") is None:
            missing.append("bar_width_m")
    else:
        if get("current_a") is None:
            missing.append("current_a")
        if not get("model_type"):
            missing.append("model_type")
        if get("box_height_m") is None:
            missing.append("box_height_m")
        curve = get("reference_curve") or []
        if not curve:
            missing.append("reference_curve")
        elif len(curve) == 1 and get("decay_exponent") is None:
            missing.append("decay_exponent")
        if get("reference_current_a") is None:
            missing.append("reference_current_a")
        if not get("reference_source"):
            missing.append("reference_source")

    if get("current_basis") is None:
        missing.append("current_basis")
    return missing


# Basis and provenance are required for a final report, but the arithmetic can run without them.
_NOT_NEEDED_TO_COMPUTE = {"current_basis", "reference_source"}


def computable(source: ElectricalSource, floor: Floor | None) -> bool:
    needed = set(missing_fields(source)) - _NOT_NEEDED_TO_COMPUTE
    return not needed and floor is not None and floor.elevation_m is not None


def _path_3d(source: ElectricalSource, floor: Floor) -> list[list[float]]:
    points = source.geometry["points"]
    z_values = source.geometry.get("z_values")
    if z_values:
        return [[p[0], p[1], z] for p, z in zip(points, z_values)]
    z = floor.elevation_m + source.height_above_floor_m
    return [[p[0], p[1], z] for p in points]


def engine_dict(source: ElectricalSource, floor: Floor, override: dict | None = None) -> dict:
    """The plain dict `elf_engine.source_from_dict` takes, with the scenario applied."""
    override = override or {}
    current_scale = (source.load_factor if source.load_factor is not None else 1.0) * override.get("current_factor", 1.0)
    attenuation = override.get("attenuation_factor", 1.0)

    if is_line(source.source_type):
        cable = source.cable
        phase_currents = cable.phase_currents_a or [source.current_a] * 3
        data = {
            "id": source.tag,
            "kind": "BUSBAR" if source.source_type == BUSBAR_SOURCE_TYPE else "THREE_PHASE",
            "centerline": _path_3d(source, floor),
            "arrangement": cable.arrangement,
            "spacing_m": cable.spacing_m,
            "currents_a": [amps * current_scale for amps in phase_currents],
            "coherence_group": cable.coherence_group,
            "attenuation_factor": attenuation,
            "keep_out_m": SHAFT_KEEP_OUT_M if source.source_type in SHAFT_SOURCE_TYPES else 0.0,
        }
        if cable.phase_angles_deg:
            data["phase_angles_deg"] = cable.phase_angles_deg
        if source.source_type == BUSBAR_SOURCE_TYPE:
            data["width_m"] = cable.bar_width_m
        return data

    details = details_of(source)
    (x1, y1), (x2, y2) = source.geometry["points"][:2]
    bottom = floor.elevation_m + source.height_above_floor_m
    return {
        "id": source.tag,
        "kind": "EMPIRICAL",
        "model_type": source.model_type,
        "center": [(x1 + x2) / 2, (y1 + y2) / 2, bottom + details.box_height_m / 2],
        "size": [abs(x2 - x1), abs(y2 - y1), details.box_height_m],
        "reference_curve": details.reference_curve,
        "reference_current_a": details.reference_current_a,
        "current_a": source.current_a * current_scale,
        "decay_exponent": details.decay_exponent,
        "attenuation_factor": attenuation,
    }
