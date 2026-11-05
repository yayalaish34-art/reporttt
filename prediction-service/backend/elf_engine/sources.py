"""Field sources. Each one knows its own physics and carries no invented defaults."""

import cmath
import math
from dataclasses import dataclass, field
from enum import Enum

import numpy as np

from .biot_savart import distance_to_segment, segment_field
from .constants import TESLA_TO_MG

# Standard sequence. Applies unless a circuit states its own.
DEFAULT_PHASE_ANGLES_DEG = (0.0, -120.0, 120.0)


class Arrangement(str, Enum):
    FLAT_HORIZONTAL = "FLAT_HORIZONTAL"
    FLAT_VERTICAL = "FLAT_VERTICAL"
    TREFOIL = "TREFOIL"


def _as_path(points) -> np.ndarray:
    path = np.asarray(points, dtype=float)
    if path.ndim != 2 or path.shape[1] != 3 or len(path) < 2:
        raise ValueError("A path needs at least two (x, y, z) points")
    if np.any(np.linalg.norm(np.diff(path, axis=0), axis=1) == 0):
        raise ValueError("A path may not repeat a point")
    return path


def _segment_frames(path: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Lateral and up unit vectors for each segment of a polyline.

    A vertical segment (a riser) has no lateral direction of its own, so it keeps
    the previous segment's, which leaves the conductors in order around the bend.
    """
    tangents = np.diff(path, axis=0)
    tangents = tangents / np.linalg.norm(tangents, axis=1, keepdims=True)
    lateral = np.zeros_like(tangents)
    previous = None
    for i, tangent in enumerate(tangents):
        candidate = np.cross(tangent, [0.0, 0.0, 1.0])
        norm = np.linalg.norm(candidate)
        if norm > 1e-9:
            previous = candidate / norm
        elif previous is None:
            previous = np.array([1.0, 0.0, 0.0])
        lateral[i] = previous
    up = np.cross(lateral, tangents)
    return lateral, up


def _miter(vectors: np.ndarray) -> np.ndarray:
    """Per-vertex offset direction that keeps neighbouring offset segments joined."""
    result = np.zeros((len(vectors) + 1, 3))
    result[0] = vectors[0]
    result[-1] = vectors[-1]
    for i in range(1, len(vectors)):
        bisector = vectors[i - 1] + vectors[i]
        norm = np.linalg.norm(bisector)
        if norm < 1e-9:
            result[i] = vectors[i]
            continue
        bisector = bisector / norm
        result[i] = bisector / max(float(np.dot(bisector, vectors[i])), 0.1)
    return result


def _offset_path(path: np.ndarray, across: float, vertical: float) -> np.ndarray:
    lateral, up = _segment_frames(path)
    return path + across * _miter(lateral) + vertical * _miter(up)


def _arrangement_offsets(arrangement: Arrangement, spacing: float) -> list[tuple[float, float]]:
    if arrangement == Arrangement.FLAT_HORIZONTAL:
        return [(-spacing, 0.0), (0.0, 0.0), (spacing, 0.0)]
    if arrangement == Arrangement.FLAT_VERTICAL:
        return [(0.0, -spacing), (0.0, 0.0), (0.0, spacing)]
    radius = spacing / math.sqrt(3.0)
    return [
        (radius * math.cos(math.radians(angle)), radius * math.sin(math.radians(angle)))
        for angle in (90.0, 210.0, 330.0)
    ]


@dataclass
class _FilamentSource:
    """A source made of straight filaments, summed coherently as phasors."""

    id: str
    coherence_group: str | None = field(default=None, kw_only=True)
    attenuation_factor: float = field(default=1.0, kw_only=True)
    # Points this close are inside the source's enclosure (a shaft, a tray), where nobody stands.
    keep_out_m: float = field(default=0.0, kw_only=True)

    @property
    def group(self) -> str:
        return self.coherence_group or self.id

    def filaments(self) -> list[tuple[np.ndarray, np.ndarray, complex]]:
        raise NotImplementedError

    def phasor_mg(self, points: np.ndarray, current_factor: float = 1.0) -> np.ndarray:
        total = np.zeros((len(points), 3), dtype=complex)
        for start, end, current in self.filaments():
            total += segment_field(points, start, end, current * current_factor)
        return total * TESLA_TO_MG * self.attenuation_factor

    def distance_m(self, points: np.ndarray) -> np.ndarray:
        distances = [distance_to_segment(points, start, end) for start, end, _ in self.filaments()]
        return np.min(distances, axis=0)


@dataclass
class ConductorSource(_FilamentSource):
    """One conductor along a path. A single-phase line needs its return modelled too."""

    path: list = field(default_factory=list)
    current_a: float = 0.0
    phase_deg: float = 0.0

    def filaments(self):
        path = _as_path(self.path)
        current = cmath.rect(self.current_a, math.radians(self.phase_deg))
        return [(path[i], path[i + 1], current) for i in range(len(path) - 1)]


@dataclass
class ThreePhaseCircuit(_FilamentSource):
    """L1, L2 and L3 laid around a shared centreline."""

    centerline: list = field(default_factory=list)
    arrangement: Arrangement = Arrangement.FLAT_HORIZONTAL
    spacing_m: float = 0.0
    currents_a: tuple = (0.0, 0.0, 0.0)
    phase_angles_deg: tuple = DEFAULT_PHASE_ANGLES_DEG

    def filaments(self):
        if self.spacing_m <= 0:
            raise ValueError(f"Circuit {self.id}: spacing must be positive")
        centerline = _as_path(self.centerline)
        offsets = _arrangement_offsets(Arrangement(self.arrangement), self.spacing_m)
        result = []
        for (across, vertical), amps, angle in zip(offsets, self.currents_a, self.phase_angles_deg):
            current = cmath.rect(amps, math.radians(angle))
            conductor = _offset_path(centerline, across, vertical)
            result += [(conductor[i], conductor[i + 1], current) for i in range(len(conductor) - 1)]
        return result


@dataclass
class BusbarSource(_FilamentSource):
    """Three bars, each split into equal strips across its width.

    Uniform current across the width is an approximation; skin and proximity
    effects in the bar are not modelled.
    """

    centerline: list = field(default_factory=list)
    arrangement: Arrangement = Arrangement.FLAT_HORIZONTAL
    spacing_m: float = 0.0
    width_m: float = 0.0
    currents_a: tuple = (0.0, 0.0, 0.0)
    phase_angles_deg: tuple = DEFAULT_PHASE_ANGLES_DEG
    strips: int = 5

    def filaments(self):
        if self.spacing_m <= 0 or self.width_m <= 0:
            raise ValueError(f"Busbar {self.id}: spacing and width must be positive")
        arrangement = Arrangement(self.arrangement)
        if arrangement == Arrangement.TREFOIL:
            raise ValueError(f"Busbar {self.id}: trefoil is not a busbar arrangement")
        centerline = _as_path(self.centerline)
        strip_positions = (np.arange(self.strips) + 0.5) / self.strips * self.width_m - self.width_m / 2.0
        result = []
        offsets = _arrangement_offsets(arrangement, self.spacing_m)
        for (across, vertical), amps, angle in zip(offsets, self.currents_a, self.phase_angles_deg):
            current = cmath.rect(amps / self.strips, math.radians(angle))
            for strip in strip_positions:
                # The bar's width runs perpendicular to the direction separating the phases.
                if arrangement == Arrangement.FLAT_HORIZONTAL:
                    conductor = _offset_path(centerline, across, vertical + strip)
                else:
                    conductor = _offset_path(centerline, across + strip, vertical)
                result += [(conductor[i], conductor[i + 1], current) for i in range(len(conductor) - 1)]
        return result


@dataclass
class EmpiricalSource:
    """A transformer or panel, as a box with a reference field curve.

    B(d, I) = B_ref(d) * I / I_ref, with d measured from the box's faces. The curve
    comes from a manufacturer, a measurement or a calibrated model, never from here.
    It has no phase information, so it can only ever combine incoherently.
    """

    id: str
    model_type: str
    center: tuple
    size: tuple
    reference_curve: list
    reference_current_a: float
    current_a: float
    decay_exponent: float | None = None
    attenuation_factor: float = 1.0
    keep_out_m: float = 0.0

    def __post_init__(self):
        if not self.reference_curve:
            raise ValueError(f"Source {self.id}: reference curve is required")
        if self.reference_current_a <= 0:
            raise ValueError(f"Source {self.id}: reference current must be positive")
        if len(self.reference_curve) == 1 and self.decay_exponent is None:
            raise ValueError(f"Source {self.id}: a single reference point needs a decay exponent")
        if any(d <= 0 or b <= 0 for d, b in self.reference_curve):
            raise ValueError(f"Source {self.id}: reference points must be positive")

    @property
    def group(self) -> str:
        return self.id

    def distance_m(self, points: np.ndarray) -> np.ndarray:
        half = np.asarray(self.size, dtype=float) / 2.0
        outside = np.maximum(np.abs(points - np.asarray(self.center, dtype=float)) - half, 0.0)
        return np.linalg.norm(outside, axis=1)

    def magnitude_mg(self, points: np.ndarray, current_factor: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
        """Field magnitude per point, and whether it left the reference curve's range."""
        curve = sorted(self.reference_curve)
        distances = np.asarray([d for d, _ in curve], dtype=float)
        fields = np.asarray([b for _, b in curve], dtype=float)
        d = np.maximum(self.distance_m(points), 1e-9)

        if len(curve) == 1:
            reference = fields[0] * (distances[0] / d) ** self.decay_exponent
            extrapolated = d != distances[0]
        else:
            log_d, log_b = np.log(distances), np.log(fields)
            log_query = np.log(d)
            log_result = np.interp(log_query, log_d, log_b)
            near_slope = (log_b[1] - log_b[0]) / (log_d[1] - log_d[0])
            far_slope = (log_b[-1] - log_b[-2]) / (log_d[-1] - log_d[-2])
            near = log_query < log_d[0]
            far = log_query > log_d[-1]
            log_result[near] = log_b[0] + near_slope * (log_query[near] - log_d[0])
            log_result[far] = log_b[-1] + far_slope * (log_query[far] - log_d[-1])
            reference = np.exp(log_result)
            extrapolated = near | far

        scale = self.current_a * current_factor / self.reference_current_a
        return reference * scale * self.attenuation_factor, np.asarray(extrapolated)
