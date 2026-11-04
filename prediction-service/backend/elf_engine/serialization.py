"""Plain dicts to sources. One path for stored runs, the API and the golden cases."""

from .sources import (
    DEFAULT_PHASE_ANGLES_DEG,
    BusbarSource,
    ConductorSource,
    EmpiricalSource,
    ThreePhaseCircuit,
)


def source_from_dict(data: dict):
    kind = data["kind"]
    shared = {
        "coherence_group": data.get("coherence_group"),
        "attenuation_factor": data.get("attenuation_factor", 1.0),
    }
    if kind == "CONDUCTOR":
        return ConductorSource(
            id=data["id"],
            path=data["path"],
            current_a=data["current_a"],
            phase_deg=data.get("phase_deg", 0.0),
            **shared,
        )
    if kind == "THREE_PHASE":
        return ThreePhaseCircuit(
            id=data["id"],
            centerline=data["centerline"],
            arrangement=data["arrangement"],
            spacing_m=data["spacing_m"],
            currents_a=tuple(data["currents_a"]),
            phase_angles_deg=tuple(data.get("phase_angles_deg", DEFAULT_PHASE_ANGLES_DEG)),
            **shared,
        )
    if kind == "BUSBAR":
        return BusbarSource(
            id=data["id"],
            centerline=data["centerline"],
            arrangement=data["arrangement"],
            spacing_m=data["spacing_m"],
            width_m=data["width_m"],
            currents_a=tuple(data["currents_a"]),
            phase_angles_deg=tuple(data.get("phase_angles_deg", DEFAULT_PHASE_ANGLES_DEG)),
            **shared,
        )
    if kind == "EMPIRICAL":
        return EmpiricalSource(
            id=data["id"],
            model_type=data["model_type"],
            center=tuple(data["center"]),
            size=tuple(data["size"]),
            reference_curve=[tuple(point) for point in data["reference_curve"]],
            reference_current_a=data["reference_current_a"],
            current_a=data["current_a"],
            decay_exponent=data.get("decay_exponent"),
            attenuation_factor=data.get("attenuation_factor", 1.0),
        )
    raise ValueError(f"Unknown source kind: {kind!r}")


def sources_from_dicts(items: list[dict]) -> list:
    return [source_from_dict(item) for item in items]
