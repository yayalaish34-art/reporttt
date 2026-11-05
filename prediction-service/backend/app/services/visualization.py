"""Heatmap colour bands and plan images.

The bands are for display only. No status is ever derived from them; that comes
from the regulation engine alone.
"""

import io
import threading
from pathlib import Path

import pypdfium2 as pdfium
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont
from pypdfium2 import PdfiumError

from .. import storage
from ..constants import RASTER_TYPES
from ..models import Document

BANDS = [
    {"label": "0–1", "min": 0.0, "max": 1.0, "color": "#2c7fb8"},
    {"label": "1–2", "min": 1.0, "max": 2.0, "color": "#41b6c4"},
    {"label": "2–3", "min": 2.0, "max": 3.0, "color": "#7fcdbb"},
    {"label": "3–4", "min": 3.0, "max": 4.0, "color": "#fecc5c"},
    {"label": "4–10", "min": 4.0, "max": 10.0, "color": "#fd8d3c"},
    {"label": ">10", "min": 10.0, "max": None, "color": "#d7301f"},
]

RENDER_DPI = 150
MAX_RENDER_SIDE = 8000
FONT_PATH = Path(__file__).resolve().parents[2] / "assets" / "fonts" / "Arimo-Regular.ttf"
# PDFium is not thread-safe, and requests are served on a thread pool. Every use holds this.
PDFIUM_LOCK = threading.Lock()


def band_color(value: float) -> tuple[int, int, int]:
    for band in BANDS:
        if band["max"] is None or value < band["max"]:
            code = band["color"]
            return tuple(int(code[i : i + 2], 16) for i in (1, 3, 5))
    raise AssertionError("The last band is open-ended")


def plan_page_count(path: Path, extension: str) -> int:
    """How many pages an uploaded file has. Raises ValueError when it cannot be read."""
    if extension == "pdf":
        with PDFIUM_LOCK:
            try:
                document = pdfium.PdfDocument(str(path))
            except PdfiumError as error:
                raise ValueError("לא ניתן לקרוא את קובץ ה-PDF") from error
            try:
                return len(document)
            finally:
                document.close()
    if extension in RASTER_TYPES:
        try:
            with Image.open(path) as image:
                image.verify()
        except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as error:
            raise ValueError("לא ניתן לקרוא את קובץ התמונה") from error
    return 1


def page_png_key(document: Document, page: int) -> str:
    return f"rendered/{document.storage_key}.p{page}.png"


def render_page_png(document: Document, page: int) -> str:
    """The key of the plan image all pixel coordinates refer to. Rendered once, then reused."""
    key = page_png_key(document, page)
    if storage.exists(key):
        return key
    with storage.local_copy(document.storage_key) as source:
        if document.file_type == "pdf":
            with PDFIUM_LOCK:
                pdf = pdfium.PdfDocument(str(source))
                try:
                    pdf_page = pdf[page]
                    width, height = pdf_page.get_size()
                    scale = min(RENDER_DPI / 72.0, MAX_RENDER_SIDE / max(width, height))
                    image = pdf_page.render(scale=scale).to_pil().convert("RGB")
                finally:
                    pdf.close()
        else:
            with Image.open(source) as opened:
                image = opened.convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    storage.save_as(key, buffer.getvalue())
    return key


def world_to_px(x: float, y: float, scale: float, origin: list[float]) -> tuple[float, float]:
    return x / scale + origin[0], origin[1] - y / scale


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def draw_heatmap(
    plan: Path,
    floor_scale: float,
    origin: list[float],
    step_m: float,
    points: list[tuple[float, float, float | None]],
    rooms: list[dict],
    sources: list[dict],
) -> Image.Image:
    """Colour cells plus numbers, room outlines and source tags, cropped to the content."""
    with Image.open(plan) as opened:
        base = opened.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    half = step_m / floor_scale / 2.0
    cell = half * 2
    font = _font(max(11, min(int(cell * 0.32), 22)))
    label = _font(24)
    xs, ys = [], []

    for x, y, value in points:
        px, py = world_to_px(x, y, floor_scale, origin)
        xs.append(px)
        ys.append(py)
        box = [px - half, py - half, px + half, py + half]
        if value is None:
            draw.rectangle(box, fill=(120, 120, 120, 120))
            continue
        draw.rectangle(box, fill=band_color(value) + (150,))
        if cell >= 26:
            draw.text((px, py), f"{value:.1f}", fill=(0, 0, 0, 255), font=font, anchor="mm")

    for room in rooms:
        outline = [world_to_px(x, y, floor_scale, origin) for x, y in room["polygon_m"]]
        xs += [p[0] for p in outline]
        ys += [p[1] for p in outline]
        draw.line(outline + [outline[0]], fill=(30, 30, 30, 255), width=3)
        for hole in room.get("holes_m") or []:
            ring = [world_to_px(x, y, floor_scale, origin) for x, y in hole]
            draw.line(ring + [ring[0]], fill=(30, 30, 30, 255), width=2)

    for source in sources:
        path = [world_to_px(x, y, floor_scale, origin) for x, y in source["points"]]
        if source["is_box"]:
            (x1, y1), (x2, y2) = path[:2]
            draw.rectangle([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)], outline=(160, 0, 160, 255), width=4)
        else:
            draw.line(path, fill=(160, 0, 160, 255), width=4)
        xs += [p[0] for p in path]
        ys += [p[1] for p in path]
        draw.text(path[0], get_display(source["tag"]), fill=(160, 0, 160, 255), font=label, anchor="lb")

    merged = Image.alpha_composite(base, overlay).convert("RGB")
    if xs:
        margin = 80
        merged = merged.crop(
            (
                max(int(min(xs)) - margin, 0),
                max(int(min(ys)) - margin, 0),
                min(int(max(xs)) + margin, merged.width),
                min(int(max(ys)) + margin, merged.height),
            )
        )
    return merged
