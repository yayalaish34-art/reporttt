"""Calculation points inside a room's polygon."""

import numpy as np
from shapely import contains_xy
from shapely.geometry import Polygon


def room_grid(polygon, step_m: float, z_values) -> np.ndarray:
    """(N, 3) points at cell centres of a step_m grid, at every z.

    A room narrower than the step would otherwise get no point and silently vanish
    from the results, so it falls back to one guaranteed-interior point.
    """
    if step_m <= 0:
        raise ValueError("Grid step must be positive")
    if not list(z_values):
        raise ValueError("At least one calculation height is required")
    shape = Polygon(polygon)
    if not shape.is_valid or shape.area == 0:
        raise ValueError("Room polygon is not valid")

    min_x, min_y, max_x, max_y = shape.bounds
    xs = np.arange(min_x + step_m / 2.0, max_x, step_m)
    ys = np.arange(min_y + step_m / 2.0, max_y, step_m)
    mesh_x, mesh_y = np.meshgrid(xs, ys)
    flat_x, flat_y = mesh_x.ravel(), mesh_y.ravel()
    inside = contains_xy(shape, flat_x, flat_y)
    plan = np.column_stack([flat_x[inside], flat_y[inside]])
    if len(plan) == 0:
        interior = shape.representative_point()
        plan = np.array([[interior.x, interior.y]])

    layers = [np.column_stack([plan, np.full(len(plan), float(z))]) for z in z_values]
    return np.vstack(layers)
