"""The building in three dimensions: each floor's field as a coloured plane, the sources in place.

An isometric view, floors stacked by level with the gaps between them widened so every
plane can be seen. The same floor images feed the interactive 3D view in the browser.
"""

import math

import numpy as np
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import CalculationRun, ElectricalSource, Floor, Room
from .calculation import floor_points
from .source_model import is_line
from .visualization import BANDS, FONT_PATH, band_color

RASTER_M = 0.25
LABEL_SPACE = 200
COS30, SIN30 = math.cos(math.radians(30)), math.sin(math.radians(30))
INK = (40, 40, 40, 255)
SOURCE_INK = (150, 0, 150, 255)


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def floor_bounds(db: Session, run: CalculationRun, floors: list[Floor], height: float) -> tuple[float, float, float, float] | None:
    xs, ys = [], []
    for floor in floors:
        for x, y, _ in floor_points(db, run.id, floor.id, height):
            xs.append(x)
            ys.append(y)
    if not xs:
        return None
    return min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1


def floor_raster(db: Session, run: CalculationRun, floor: Floor, height: float, bounds) -> Image.Image:
    """The floor's field as an RGBA image over bounds, north up; RASTER_M a pixel."""
    x0, y0, x1, y1 = bounds
    width, rows = int(math.ceil((x1 - x0) / RASTER_M)), int(math.ceil((y1 - y0) / RASTER_M))
    pixels = np.zeros((rows, width, 4), dtype=np.uint8)
    half = max(1, int(round(run.grid_step_m / RASTER_M / 2)))
    for x, y, value in floor_points(db, run.id, floor.id, height):
        col, row = int((x - x0) / RASTER_M), int((y1 - y) / RASTER_M)
        colour = (150, 150, 150, 170) if value is None else band_color(value) + (225,)
        pixels[max(row - half, 0) : row + half, max(col - half, 0) : col + half] = colour
    image = Image.fromarray(pixels, "RGBA")
    draw = ImageDraw.Draw(image)
    for room in db.scalars(select(Room).where(Room.floor_id == floor.id)):
        for ring in [room.polygon_m, *(room.holes_m or [])]:
            outline = [((x - x0) / RASTER_M, (y1 - y) / RASTER_M) for x, y in ring]
            draw.line(outline + [outline[0]], fill=(60, 60, 60, 200), width=1)
    return image


class _Projection:
    """World metres (x east, y north, z up) to image pixels, floors spread apart."""

    def __init__(self, bounds, scale: float, gap: float, levels: dict[str, int], z_per_level: float, margin: int):
        self.x0, self.y0, self.x1, self.y1 = bounds
        self.scale, self.gap, self.levels, self.z_per_level = scale, gap, levels, z_per_level
        corners = [(self.x0, self.y0), (self.x1, self.y0), (self.x0, self.y1), (self.x1, self.y1)]
        us = [(x - y) * COS30 * scale for x, y in corners]
        vs = [-(x + y) * SIN30 * scale for x, y in corners]
        # Room on the left for the floors' names.
        self.u0, self.v0 = min(us) - margin - LABEL_SPACE, min(vs) - margin
        self.plane_height = max(vs) - min(vs)
        self.count = max(levels.values()) + 1 if levels else 1
        self.width = int(max(us) - min(us) + 2 * margin + LABEL_SPACE)
        self.height = int(self.plane_height + gap * (self.count - 1) + 2 * margin)

    def point(self, x: float, y: float, floor_index: int, lift_m: float = 0.0) -> tuple[float, float]:
        u = (x - y) * COS30 * self.scale - self.u0
        v = -(x + y) * SIN30 * self.scale - self.v0
        offset = (self.count - 1 - floor_index) * self.gap
        return u, v + offset - lift_m * self.z_per_level

    def affine_for(self, floor_index: int) -> tuple:
        """The inverse map PIL needs: image pixel -> raster pixel of the floor."""
        s, r = self.scale, RASTER_M
        a, b = s * COS30 * r, s * COS30 * r
        c = s * COS30 * (self.x0 - self.y1) - self.u0
        d, e = -s * SIN30 * r, s * SIN30 * r
        f = -s * SIN30 * (self.x0 + self.y1) - self.v0 + (self.count - 1 - floor_index) * self.gap
        det = a * e - b * d
        return (e / det, -b / det, (b * f - e * c) / det, -d / det, a / det, (d * c - a * f) / det)


def building_view(db: Session, run: CalculationRun, floors: list[Floor], height: float, width_px: int = 1700) -> Image.Image | None:
    """The given floors, bottom to top, with their sources, in one isometric picture."""
    floors = sorted(floors, key=lambda f: f.elevation_m or 0)
    bounds = floor_bounds(db, run, floors, height)
    if bounds is None:
        return None
    x0, y0, x1, y1 = bounds
    scale = (width_px - 260 - LABEL_SPACE) / ((x1 - x0 + y1 - y0) * COS30)
    plane = (x1 - x0 + y1 - y0) * SIN30 * scale
    gap = max(plane * 0.55, 140)
    typical_height = np.median([f.ceiling_height_m for f in floors if f.ceiling_height_m] or [3.0])
    projection = _Projection(bounds, scale, gap, {f.id: i for i, f in enumerate(floors)}, gap / typical_height, 130)

    canvas = Image.new("RGBA", (projection.width, projection.height + 70), (255, 255, 255, 255))
    by_floor = {}
    for source in db.scalars(select(ElectricalSource).where(ElectricalSource.floor_id.in_([f.id for f in floors]))):
        by_floor.setdefault(source.floor_id, []).append(source)
    label_font, tag_font = _font(22), _font(18)

    for index, floor in enumerate(floors):
        raster = floor_raster(db, run, floor, height, bounds)
        warped = raster.transform(canvas.size, Image.Transform.AFFINE, projection.affine_for(index), resample=Image.Resampling.BILINEAR)
        # The slab half see-through, so the floor below still shows behind it.
        slab = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        frame = [projection.point(x, y, index) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
        ImageDraw.Draw(slab).polygon(frame, fill=(236, 239, 243, 150), outline=(150, 150, 150, 255))
        canvas.alpha_composite(slab)
        canvas.alpha_composite(warped)
        # Sources on a layer of their own, so a see-through box blends with the map under it.
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        labels = []
        for source in by_floor.get(floor.id, []):
            points = source.geometry.get("points") or []
            if len(points) < 2:
                continue
            lift = source.height_above_floor_m or 0.0
            if source.geometry.get("z_values"):
                bottom, top = source.geometry["z_values"][0], source.geometry["z_values"][-1]
                base = projection.point(points[0][0], points[0][1], index, 0.0)
                peak = projection.point(points[0][0], points[0][1], index, top - bottom)
                draw.line([base, peak], fill=SOURCE_INK, width=5)
                labels.append(((peak[0] + 6, peak[1]), source.tag, "lm"))
            elif is_line(source.source_type):
                path = [projection.point(x, y, index, lift) for x, y in points]
                draw.line(path, fill=SOURCE_INK, width=4)
                labels.append((path[0], source.tag, "lb"))
            else:
                (ax, ay), (bx, by) = points[:2]
                rise = getattr(source.transformer or source.panel, "box_height_m", None) or 2.0
                footprint = [(ax, ay), (bx, ay), (bx, by), (ax, by)]
                low = [projection.point(x, y, index, lift) for x, y in footprint]
                high = [projection.point(x, y, index, lift + rise) for x, y in footprint]
                for i in range(4):
                    draw.polygon([low[i], low[(i + 1) % 4], high[(i + 1) % 4], high[i]], fill=(150, 0, 150, 60), outline=SOURCE_INK)
                draw.polygon(high, fill=(150, 0, 150, 90), outline=SOURCE_INK)
                labels.append((min(high, key=lambda p: p[1]), source.tag, "mb"))
        canvas.alpha_composite(layer)
        draw = ImageDraw.Draw(canvas)
        for position, tag, anchor in labels:
            draw.text(position, get_display(tag), fill=SOURCE_INK, font=tag_font, anchor=anchor, stroke_width=3, stroke_fill=(255, 255, 255, 255))
        u, v = projection.point(x0, y1, index)
        draw.text((u - 12, v), get_display(floor.name), fill=INK, font=label_font, anchor="rm")

    _legend(canvas, projection.height + 10)
    return canvas.convert("RGB")


def _legend(canvas: Image.Image, top: int) -> None:
    draw = ImageDraw.Draw(canvas)
    font = _font(18)
    width = 120
    left = (canvas.width - width * len(BANDS)) // 2
    for i, band in enumerate(BANDS):
        box = [left + i * width, top, left + (i + 1) * width, top + 30]
        draw.rectangle(box, fill=band_color(band["min"] + 0.01) + (255,))
        draw.text(((box[0] + box[2]) / 2, top + 15), band["label"] + " mG", fill=INK, font=font, anchor="mm")


def floor_groups(floors: list[Floor], size: int = 4) -> list[list[Floor]]:
    """Floors in readable groups for the report, bottom up; the lowest group starts with the basements."""
    ordered = sorted(floors, key=lambda f: f.elevation_m or 0)
    return [ordered[i : i + size] for i in range(0, len(ordered), size)]
