"""Time normalization, kept apart from the field calculation so it is never implicit."""

from dataclasses import dataclass

TIME_WEIGHTED_LINEAR = "TIME_WEIGHTED_LINEAR"
# The rest of the day at a stated background field, rather than at zero.
TIME_WEIGHTED_WITH_BACKGROUND = "TIME_WEIGHTED_WITH_BACKGROUND"


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
    background_mg: float = 0.0,
) -> NormalizedExposure:
    """(raw * load_factor * occupancy_hours + background * (averaging - occupancy)) / averaging.

    With no background, the field outside the occupied hours is taken as zero. The
    Israeli guideline takes it as 1 mG, so the rule states its background. The method
    is stored by name, since which one suits a criterion is a professional call.
    `load_factor` must stay 1 when the scenario's currents already include it.
    """
    if averaging_hours <= 0:
        raise ValueError("Averaging period must be positive")
    if occupancy_hours < 0 or occupancy_hours > averaging_hours:
        raise ValueError("Occupancy hours must lie within the averaging period")
    if load_factor < 0:
        raise ValueError("Load factor may not be negative")
    if background_mg < 0:
        raise ValueError("Background may not be negative")
    return NormalizedExposure(
        raw_field_mg=raw_field_mg,
        occupancy_hours=occupancy_hours,
        averaging_hours=averaging_hours,
        load_factor=load_factor,
        normalization_method=TIME_WEIGHTED_WITH_BACKGROUND if background_mg else TIME_WEIGHTED_LINEAR,
        normalized_field_mg=(raw_field_mg * load_factor * occupancy_hours + background_mg * (averaging_hours - occupancy_hours))
        / averaging_hours,
    )
