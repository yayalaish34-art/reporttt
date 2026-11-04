"""Closed-form Biot-Savart for a finite straight filament, in phasor form."""

import numpy as np

from .constants import MU0


def segment_field(points: np.ndarray, start: np.ndarray, end: np.ndarray, current: complex) -> np.ndarray:
    """Phasor flux density in tesla at `points` (N, 3) from one filament.

    With unit axis u, a = P - A, b = P - B and rho the perpendicular from the line:

        B = mu0 I / 4pi * (a.u / |a| - b.u / |b|) * (u x rho) / |rho|^2

    The more compact (|a| + |b|) / (|a||b| (|a||b| + a.b)) * (a x b) is the same
    quantity but subtracts nearly equal numbers beside a long segment, and lost
    enough precision there to fail the analytic comparison.

    Points on the filament's own line have no defined field and return 0 here;
    callers exclude them through `distance_to_segment` before reporting a value.
    """
    axis = end - start
    unit = axis / np.linalg.norm(axis)
    a = points - start
    b = points - end
    along_a = a @ unit
    along_b = b @ unit
    rho = a - along_a[:, None] * unit
    rho_sq = np.einsum("ij,ij->i", rho, rho)
    a_len = np.linalg.norm(a, axis=1)
    b_len = np.linalg.norm(b, axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        cosines = along_a / a_len - along_b / b_len
        scale = np.where(rho_sq > 0, cosines / rho_sq, 0.0)
    return (MU0 * current / (4.0 * np.pi)) * scale[:, None] * np.cross(unit, rho)


def distance_to_segment(points: np.ndarray, start: np.ndarray, end: np.ndarray) -> np.ndarray:
    """Shortest distance in metres from each point to the segment."""
    axis = end - start
    length_sq = float(np.dot(axis, axis))
    if length_sq == 0.0:
        return np.linalg.norm(points - start, axis=1)
    along = np.clip(((points - start) @ axis) / length_sq, 0.0, 1.0)
    return np.linalg.norm(points - (start + along[:, None] * axis), axis=1)
