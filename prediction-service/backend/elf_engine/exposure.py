"""Time normalization, kept apart from the field calculation so it is never implicit."""

from dataclasses import dataclass

TIME_WEIGHTED_LINEAR = "TIME_WEIGHTED_LINEAR"


@dataclass(frozen=True)
class NormalizedExposure:
    raw_field_mg: float
    occupancy_hours: float
    averaging_hours: float
    load_factor: float
    normalization_method: str
    normalized_field_mg: float


def calculate_normalized_exposure(
    raw_field_mg: float,
    occupancy_hours: float,
    averaging_hours: float,
    load_factor: float = 1.0,
) -> NormalizedExposure:
    """raw * load_factor * occupancy_hours / averaging_hours.

    Assumes zero field outside the occupied hours. Whether that suits a given
    criterion is a professional call, which is why the method is stored by name.
    `load_factor` must stay 1 when the scenario's currents already include it.
    """
    if averaging_hours <= 0:
        raise ValueError("Averaging period must be positive")
    if occupancy_hours < 0 or occupancy_hours > averaging_hours:
        raise ValueError("Occupancy hours must lie within the averaging period")
    if load_factor < 0:
        raise ValueError("Load factor may not be negative")
    return NormalizedExposure(
        raw_field_mg=raw_field_mg,
        occupancy_hours=occupancy_hours,
        averaging_hours=averaging_hours,
        load_factor=load_factor,
        normalization_method=TIME_WEIGHTED_LINEAR,
        normalized_field_mg=raw_field_mg * load_factor * occupancy_hours / averaging_hours,
    )
