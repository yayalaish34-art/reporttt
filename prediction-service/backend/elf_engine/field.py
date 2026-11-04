"""Superposition: phasors within a coherence group, a stated rule between groups."""

from dataclasses import dataclass
from enum import Enum

import numpy as np

from .sources import EmpiricalSource

# Closer than this the thin-filament model has no meaning, so no value is reported.
DEFAULT_MIN_DISTANCE_M = 0.02


class Combination(str, Enum):
    # No known phase relationship between groups.
    RSS = "RSS_BETWEEN_GROUPS"
    # Upper bound, for conservative and worst-case views.
    ARITHMETIC = "ARITHMETIC_BETWEEN_GROUPS"


@dataclass
class FieldResult:
    total_mg: np.ndarray
    per_source_mg: np.ndarray
    source_ids: list[str]
    too_close: np.ndarray
    extrapolated: np.ndarray
    combination: Combination

    def dominant_source_index(self) -> np.ndarray:
        """Index of the largest single contribution at each point."""
        if not self.source_ids:
            return np.full(len(self.total_mg), -1)
        filled = np.nan_to_num(self.per_source_mg, nan=-1.0)
        return np.argmax(filled, axis=1)


def _rms(phasor: np.ndarray) -> np.ndarray:
    """Resultant RMS of a phasor vector field: sqrt(|Bx|^2 + |By|^2 + |Bz|^2)."""
    return np.sqrt(np.sum(np.abs(phasor) ** 2, axis=1))


def compute_field(
    points,
    sources: list,
    combination: Combination = Combination.RSS,
    current_factor: float = 1.0,
    min_distance_m: float = DEFAULT_MIN_DISTANCE_M,
) -> FieldResult:
    """Resultant RMS flux density in mG at `points` (N, 3), in metres."""
    points = np.atleast_2d(np.asarray(points, dtype=float))
    count = len(points)
    per_source = np.zeros((count, len(sources)))
    too_close = np.zeros(count, dtype=bool)
    extrapolated = np.zeros(count, dtype=bool)
    group_phasors: dict[str, np.ndarray] = {}
    group_magnitudes: dict[str, np.ndarray] = {}

    for index, source in enumerate(sources):
        too_close |= source.distance_m(points) < min_distance_m
        if isinstance(source, EmpiricalSource):
            magnitude, outside_curve = source.magnitude_mg(points, current_factor)
            extrapolated |= outside_curve
            per_source[:, index] = magnitude
            group_magnitudes[source.group] = magnitude
            too_close |= source.distance_m(points) == 0.0
        else:
            phasor = source.phasor_mg(points, current_factor)
            per_source[:, index] = _rms(phasor)
            group_phasors[source.group] = group_phasors.get(source.group, 0) + phasor

    magnitudes = [_rms(phasor) for phasor in group_phasors.values()]
    magnitudes += list(group_magnitudes.values())
    if not magnitudes:
        total = np.zeros(count)
    elif combination == Combination.ARITHMETIC:
        total = np.sum(magnitudes, axis=0)
    else:
        total = np.sqrt(np.sum(np.square(magnitudes), axis=0))

    total = total.astype(float)
    total[too_close] = np.nan
    per_source[too_close, :] = np.nan
    return FieldResult(
        total_mg=total,
        per_source_mg=per_source,
        source_ids=[source.id for source in sources],
        too_close=too_close,
        extrapolated=extrapolated,
        combination=Combination(combination),
    )
