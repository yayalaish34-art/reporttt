"""Rooms on a plan: their outlines from the drawn walls, their kind from the vision model.

The model is good at saying what a room is and roughly where its middle is, and poor at
drawing its outline. The walls are on the plan. So each room grows from the model's point
across the open floor until it meets a wall or a neighbouring room, which at a doorway
splits the opening between the two. The building's outline, with its doorways closed,
keeps a room from leaking outside.
"""

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.geometry import MultiPoint, Polygon, box as shapely_box
from shapely.ops import unary_union

CELL_M = 0.05
# A wall is a band about 20 cm thick, dense across its width whether solid or hatched; a
# single line (furniture, a door's swing, text) is dense only along itself.
WALL_WINDOW_M = 0.11
WALL_DENSITY = 0.22
INK = 200
# Doorways up to this wide are closed when finding the building's outline.
DOORWAY_M = 0.9
# A point that lands on a wall is moved to open floor within this distance.
SNAP_M = 0.6
MIN_ROOM_M2 = 0.4
# Rooms of these kinds are where people stay; the rest only ever covers what was found for it.
STAY_KINDS = ("APARTMENT_ROOM", "OFFICE", "COMMERCIAL", "PUBLIC_ROOM")
# Floor further than this from every room's point is outside the building. A long corridor
# reaches far from its one point; anything outside the building's outline is cut off later.
REACH_M = 12.0


def wall_grid(gray: np.ndarray, m_per_px: float) -> np.ndarray:
    """Walls on a CELL_M grid, from the plan's pixels."""
    ink = (gray < INK).astype(np.float32)
    window = max(3, round(WALL_WINDOW_M / m_per_px)) | 1
    wallish = ndimage.uniform_filter(ink, size=window) > WALL_DENSITY
    block = max(1, round(CELL_M / m_per_px))
    rows, cols = wallish.shape[0] // block, wallish.shape[1] // block
    walls = wallish[: rows * block, : cols * block].reshape(rows, block, cols, block).mean(axis=(1, 3)) > 0.3
    walls = ndimage.binary_closing(walls, iterations=1)
    # Symbols and blocks of text are small dense blobs; walls join into long runs.
    labels, count = ndimage.label(walls)
    if count:
        sizes = ndimage.sum(np.ones_like(labels), labels, index=np.arange(1, count + 1))
        walls = np.isin(labels, 1 + np.flatnonzero(sizes * CELL_M**2 >= 0.25))
    return walls


def building_interior(walls: np.ndarray) -> np.ndarray:
    """Open floor inside the building: what the outline, doorways closed, encloses."""
    closed = ndimage.binary_dilation(walls, iterations=round(DOORWAY_M / 2 / CELL_M))
    footprint = ndimage.binary_fill_holes(closed)
    return footprint & ~walls


def _grow(labels: np.ndarray, allowed: np.ndarray, steps: int) -> None:
    """Grows the labelled rooms into allowed, unlabelled cells, one cell a step, in place."""
    for _ in range(steps):
        grown = ndimage.grey_dilation(labels, size=3)
        frontier = (labels == 0) & allowed & (grown > 0)
        if not frontier.any():
            return
        labels[frontier] = grown[frontier]


def grow_rooms(interior: np.ndarray, walls: np.ndarray, seeds: list[tuple[int, int]]) -> np.ndarray:
    """Labels 1..n: each seed's room, grown across open floor; 0 is wall or unreached.

    First only through floor at least half a doorway from any wall, where every doorway is
    shut, so a room cannot pass into the next one. Then the strip along the walls is filled
    from whichever room is beside it.
    """
    door = round(DOORWAY_M / 2 / CELL_M)
    core = interior & ~ndimage.binary_dilation(walls, iterations=door)
    labels = np.zeros(interior.shape, dtype=np.int32)
    snap = round(SNAP_M / CELL_M)
    core_distance, core_nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    open_distance, open_nearest = ndimage.distance_transform_edt(~interior, return_indices=True)
    for index, (row, col) in enumerate(seeds, start=1):
        if not (0 <= row < interior.shape[0] and 0 <= col < interior.shape[1]):
            continue
        if core_distance[row, col] <= snap:
            row, col = core_nearest[0][row, col], core_nearest[1][row, col]
        elif open_distance[row, col] <= snap:
            # A room narrower than a doorway (a toilet, a shaft): it starts in the strip.
            row, col = open_nearest[0][row, col], open_nearest[1][row, col]
        else:
            continue
        if labels[row, col] == 0:
            labels[row, col] = index
    _grow(labels, core, 4000)
    _grow(labels, interior, door + 2)
    return labels


def _outline(mask: np.ndarray) -> Polygon | None:
    """The cells of one room as a polygon in cell coordinates."""
    rows = np.flatnonzero(mask.any(axis=1))
    boxes = []
    for row in rows:
        line = mask[row]
        edges = np.flatnonzero(np.diff(np.concatenate([[0], line.astype(np.int8), [0]])))
        for start, end in zip(edges[::2], edges[1::2]):
            boxes.append(shapely_box(start, row, end, row + 1))
    if not boxes:
        return None
    shape = unary_union(boxes).simplify(1.5)
    if shape.geom_type == "MultiPolygon":
        shape = max(shape.geoms, key=lambda part: part.area)
    return shape if shape.geom_type == "Polygon" and not shape.is_empty else None


def segment(page_png, box_px: list[float], m_per_px: float, zones: list[dict]) -> dict:
    """{"rooms": [{kind, label, unit, polygon_px, area_m2}], "footprint_px": [...]} in the page's pixels.

    Also the building's outline, so whatever no room covers can still be evaluated.
    """
    Image.MAX_IMAGE_PIXELS = None
    x0, y0, x1, y1 = (int(round(v)) for v in box_px)
    margin = int(1.0 / m_per_px)
    with Image.open(page_png) as opened:
        width, height = opened.size
        crop = (max(x0 - margin, 0), max(y0 - margin, 0), min(x1 + margin, width), min(y1 + margin, height))
        gray = np.asarray(opened.convert("L").crop(crop))
    walls = wall_grid(gray, m_per_px)
    interior = building_interior(walls)
    cell_px = CELL_M / m_per_px

    seeds = [(int((z["point"][1] - crop[1]) / cell_px), int((z["point"][0] - crop[0]) / cell_px)) for z in zones]
    near = np.zeros(interior.shape, dtype=bool)
    for row, col in seeds:
        if 0 <= row < near.shape[0] and 0 <= col < near.shape[1]:
            near[row, col] = True
    if near.any():
        interior &= ndimage.distance_transform_edt(~near) * CELL_M <= REACH_M
    labels = grow_rooms(interior, walls, seeds)

    rooms = []
    to_page = lambda x, y: [round(crop[0] + x * cell_px, 1), round(crop[1] + y * cell_px, 1)]

    for index, zone in enumerate(zones, start=1):
        mask = labels == index
        area = float(mask.sum()) * CELL_M**2
        if area < MIN_ROOM_M2:
            continue
        shape = _outline(mask)
        if shape is None:
            continue
        rooms.append(
            {
                "kind": zone["kind"],
                "label": zone["label"],
                "unit": zone.get("unit"),
                "polygon_px": [to_page(x, y) for x, y in shape.exterior.coords[:-1]],
                "area_m2": round(area, 2),
            }
        )
    return {"rooms": rooms, "footprint_px": [[to_page(x, y) for x, y in part.exterior.coords[:-1]] for part in _footprint(walls)]}


def _footprint(walls: np.ndarray) -> list[Polygon]:
    """The building's outline on the floor: the hull of each building's walls.

    A sheet often shows two buildings side by side; each one's walls form one connected
    network, so each gets its own outline and the yard between them is left out.
    """
    labels, count = ndimage.label(ndimage.binary_dilation(walls, iterations=round(DOORWAY_M / 2 / CELL_M)))
    hulls = []
    for index in range(1, count + 1):
        rows, cols = np.nonzero(labels == index)
        if len(rows) * CELL_M**2 < 20:
            continue
        hull = MultiPoint(np.column_stack([cols, rows]).astype(float)).convex_hull
        if hull.geom_type == "Polygon":
            hulls.append(hull)
    union = unary_union(hulls) if hulls else None
    if union is None or union.is_empty:
        return []
    return [part.simplify(2) for part in (union.geoms if hasattr(union, "geoms") else [union]) if part.area * CELL_M**2 >= 20]
