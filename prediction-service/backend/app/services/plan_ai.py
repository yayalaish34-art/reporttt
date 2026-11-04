"""Reads one plan page with a vision model: which floor it is, its scale, and the sources drawn on it.

Everything that comes back is a proposal. It is stored as it came, turned into a model
by `auto_build`, and labelled as automatic detection until a person approves it. The
model is told to leave out what it cannot read rather than guess, and every value it
does give is checked here before anything uses it.

A sheet is read twice. Once whole and small, for what it is (floor, use, where the
building is). Then in tiles at full resolution, because a shrunk A0 sheet loses every
label. A tile keeps only what lies in its own core, so the overlap between neighbouring
tiles never counts a source twice.
"""

import base64
import io
import json
import math
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pypdfium2 as pdfium
from PIL import Image
from shapely.geometry import LineString, MultiLineString, box as shapely_box

from .. import storage
from ..config import settings
from ..models import Document
from .visualization import MAX_RENDER_SIDE, PDFIUM_LOCK, RENDER_DPI, render_page_png

ENDPOINT = "https://api.openai.com/v1/chat/completions"
OVERVIEW_SIDE = 2000
TILE_SIDE = 2200
TILE_OVERLAP = 160
PARALLEL_CALLS = 8
TIMEOUT_S = 240

SHEET_KINDS = ("ELECTRICAL", "ARCHITECTURAL", "SINGLE_LINE", "OTHER")
SOURCE_KINDS = (
    "TRANSFORMER",
    "METER_BOARD",
    "DISTRIBUTION_PILLAR",
    "MAIN_BOARD",
    "EV_CHARGING",
    "GENERATOR",
    "PV_INVERTER",
    "FEEDER",
    "BUSBAR",
    "RISER",
)
PATH_KINDS = ("FEEDER", "BUSBAR")
FLOOR_USES = ("PARKING", "RESIDENTIAL", "OFFICE", "COMMERCIAL", "PUBLIC", "TECHNICAL", "MIXED")
CONFIDENCES = ("HIGH", "MEDIUM", "LOW")
_CONFIDENCE_RANK = {"HIGH": 2, "MEDIUM": 1, "LOW": 0}

OVERVIEW_PROMPT = """You read Israeli building plans (Hebrew) for a 50 Hz magnetic-field prediction.
You get one whole sheet as a small image, its file name, and any text extracted from the PDF.
Return JSON only, in exactly this shape:
{
  "sheet_kind": "ELECTRICAL" | "ARCHITECTURAL" | "SINGLE_LINE" | "OTHER",
  "floors": [{"name": "<Hebrew floor name as written>", "level": <int>}],
  "floor_use": "PARKING" | "RESIDENTIAL" | "OFFICE" | "COMMERCIAL" | "PUBLIC" | "TECHNICAL" | "MIXED" | null,
  "scale_text": "1:100" | null,
  "building_box": [x0, y0, x1, y1] | null,
  "notes": "<one short Hebrew sentence on anything unclear>"
}
Coordinates are integers from 0 to 1000 across the image width (x, left to right) and height (y, top to bottom).
Floors: level 0 is the ground floor (קומת קרקע), 1 is קומה 1, -1 is מרתף 1- (also written מרתף מ1), -2 is מרתף 2-.
A typical-floor sheet such as "קומות 3-4" lists every floor it covers. A technical roof (גג טכני) is the level above the top floor.
The file name is usually the most reliable floor label. Use it.
An electrical sheet (תוכנית חשמל, מתקן חשמל) shows electrical symbols and wiring over the floor plan; an architectural sheet (גרמושקה, תוכנית אדריכלית) shows only the building.
scale_text is the drawing scale written in the title block (קנ"מ), or null if you cannot read it.
building_box frames all building drawings on the sheet (one or more buildings), without the title block, legend, notes or details."""

TILE_PROMPT = """You read one tile of an Israeli electrical plan (Hebrew) for a 50 Hz magnetic-field prediction.
Find equipment that carries building-level current, drawn in this tile.
Return JSON only, in exactly this shape:
{
  "scale_text": "1:100" | null,
  "sources": [
    {"kind": "<kind>", "label": "<text written next to it>", "box": [x0, y0, x1, y1] | null,
     "path": [[x, y], ...] | null, "point": [x, y] | null, "rating_text": "<e.g. 630KVA, 3x400A>" | null,
     "kva": <number> | null, "current_a": <number> | null, "confidence": "HIGH" | "MEDIUM" | "LOW"}
  ]
}
Coordinates are integers from 0 to 1000 across this tile's width (x, left to right) and height (y, top to bottom).
Kinds:
- TRANSFORMER: a transformer or transformer room (שנאי, טרפו, חדר שנאים, חדר טרפו). box = the transformer or the room.
- METER_BOARD: meter boards (לוח מונים, ריכוז מונים, גומחת מונים). box.
- DISTRIBUTION_PILLAR: a distribution pillar (פילר, פילר חלוקה). box.
- MAIN_BOARD: a main or public switchboard (לוח ראשי, לוח חשמל ציבורי, לוח חניון, ל"ר). box.
- EV_CHARGING: an EV-charging board (לוח טעינת רכבים). box.
- GENERATOR, PV_INVERTER: box.
- FEEDER: a main low-voltage feeder or cable tray route (קו הזנה ראשי, תעלת כבלים, סולם כבלים, כבלי הזנה). path along the route inside this tile, 2 to 12 points.
- BUSBAR: a busbar trunking (פס צבירה). path.
- RISER: a riser shaft carrying feeders up the building (פיר חשמל, פיר כבלים, עולה לקומות). point at the shaft.
Leave out lights, sockets, switches, small apartment boards (לוח דירתי), low-current and communication systems (תקשורת, טלפון, טלוויזיה, אינטרקום), lightning protection (הגנת ברקים), earthing, and anything you cannot read.
Give kva and current_a only when they are written in the tile; never estimate them.
If something is probably a source but you are not sure, include it with confidence LOW.
scale_text: the drawing scale (קנ"מ) if this tile shows the title block, otherwise null.
Most tiles contain no sources. Then return an empty list."""


class PlanAiError(RuntimeError):
    pass


def ai_available() -> bool:
    return bool(settings.openai_api_key)


def page_facts(document: Document, page: int) -> dict:
    """The page's paper size and the text inside it, read straight from the PDF."""
    facts = {"width_pt": None, "height_pt": None, "render_scale": None, "text": ""}
    if document.file_type != "pdf":
        return facts
    with storage.local_copy(document.storage_key) as source, PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(str(source))
        try:
            pdf_page = pdf[page]
            width, height = pdf_page.get_size()
            facts["width_pt"], facts["height_pt"] = width, height
            facts["render_scale"] = min(RENDER_DPI / 72.0, MAX_RENDER_SIDE / max(width, height))
            text_page = pdf_page.get_textpage()
            try:
                facts["text"] = text_page.get_text_range()[:6000]
            finally:
                text_page.close()
        finally:
            pdf.close()
    return facts


def scale_denominator(*texts: str | None) -> int | None:
    """1:100 → 100, from the first text that has a usual drawing scale."""
    for text in texts:
        for match in re.finditer(r"(?<!\d)1\s*:\s*(\d{2,4})(?!\d)", text or ""):
            value = int(match.group(1))
            if value in (20, 25, 50, 75, 100, 125, 200, 250, 500, 1000):
                return value
    return None


def _jpeg_url(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def _call_model(system_prompt: str, image: Image.Image, user_text: str, effort: str = "low") -> dict:
    body = {
        "model": settings.openai_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": _jpeg_url(image), "detail": "high"}},
                ],
            },
        ],
        "response_format": {"type": "json_object"},
        "max_completion_tokens": 12000,
    }
    if re.match(r"^(gpt-5|o\d)", settings.openai_model):
        body["reasoning_effort"] = effort
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise PlanAiError(f"OpenAI החזיר שגיאה ({error.code}): {detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise PlanAiError("לא ניתן היה לקבל תשובה מ-OpenAI. נסו שוב.") from error
    content = (payload.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise PlanAiError("המודל החזיר תשובה שאינה JSON") from error
    if not isinstance(parsed, dict):
        raise PlanAiError("המודל החזיר תשובה במבנה לא צפוי")
    return parsed


# ── Checking what came back ──────────────────────────────────────────────


def _coord(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return min(max(number, 0.0), 1000.0) if math.isfinite(number) else None


def _point(value) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    x, y = _coord(value[0]), _coord(value[1])
    return None if x is None or y is None else [x, y]


def _box(value) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    numbers = [_coord(v) for v in value]
    if any(n is None for n in numbers):
        return None
    x0, y0, x1, y1 = numbers
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return [x0, y0, x1, y1]


def _positive(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def clean_overview(raw: dict) -> dict:
    floors = []
    for floor in raw.get("floors") or []:
        if not isinstance(floor, dict):
            continue
        try:
            level = int(floor.get("level"))
        except (TypeError, ValueError):
            continue
        if -10 <= level <= 120:
            floors.append({"name": str(floor.get("name") or "").strip()[:80], "level": level})
    return {
        "sheet_kind": raw.get("sheet_kind") if raw.get("sheet_kind") in SHEET_KINDS else "OTHER",
        "floors": floors,
        "floor_use": raw.get("floor_use") if raw.get("floor_use") in FLOOR_USES else None,
        "scale_text": str(raw.get("scale_text") or "").strip()[:20] or None,
        "building_box": _box(raw.get("building_box")),
        "notes": str(raw.get("notes") or "").strip()[:300],
    }


def clean_sources(raw: dict) -> list[dict]:
    """Well-formed sources only, coordinates 0–1000. One with no usable position is dropped."""
    sources = []
    for item in raw.get("sources") or []:
        if not isinstance(item, dict) or item.get("kind") not in SOURCE_KINDS:
            continue
        kind = item["kind"]
        source = {
            "kind": kind,
            "label": str(item.get("label") or "").strip()[:120],
            "rating_text": str(item.get("rating_text") or "").strip()[:60] or None,
            "kva": _positive(item.get("kva")),
            "current_a": _positive(item.get("current_a")),
            "confidence": item.get("confidence") if item.get("confidence") in CONFIDENCES else "LOW",
        }
        if kind in PATH_KINDS:
            path = [p for p in (_point(p) for p in item.get("path") or []) if p]
            if len(path) < 2:
                continue
            source["path"] = path
        elif kind == "RISER":
            point = _point(item.get("point"))
            box = _box(item.get("box"))
            if point is None and box is not None:
                point = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
            if point is None:
                continue
            source["point"] = point
        else:
            box = _box(item.get("box"))
            if box is None:
                point = _point(item.get("point"))
                if point is None:
                    continue
                box = [max(point[0] - 5, 0), max(point[1] - 5, 0), min(point[0] + 5, 1000), min(point[1] + 5, 1000)]
            source["box"] = box
        sources.append(source)
    return sources


# ── Tiles ────────────────────────────────────────────────────────────────


def tile_grid(width: int, height: int) -> list[dict]:
    """Overlapping tiles covering the page. `core` is the part each tile answers for."""
    cols = max(1, math.ceil(width / TILE_SIDE))
    rows = max(1, math.ceil(height / TILE_SIDE))
    tiles = []
    for row in range(rows):
        for col in range(cols):
            core = (
                round(col * width / cols),
                round(row * height / rows),
                round((col + 1) * width / cols),
                round((row + 1) * height / rows),
            )
            crop = (
                max(core[0] - TILE_OVERLAP, 0),
                max(core[1] - TILE_OVERLAP, 0),
                min(core[2] + TILE_OVERLAP, width),
                min(core[3] + TILE_OVERLAP, height),
            )
            tiles.append({"row": row, "col": col, "rows": rows, "cols": cols, "core": core, "crop": crop})
    return tiles


def _to_page(point: list[float], crop: tuple) -> list[float]:
    x0, y0, x1, y1 = crop
    return [x0 + point[0] / 1000.0 * (x1 - x0), y0 + point[1] / 1000.0 * (y1 - y0)]


def sources_in_core(sources: list[dict], tile: dict) -> list[dict]:
    """A tile's sources in page pixels, cut to its core so neighbours never overlap."""
    core = tile["core"]
    core_shape = shapely_box(*core)
    kept = []
    for source in sources:
        if source["kind"] in PATH_KINDS:
            line = LineString([_to_page(p, tile["crop"]) for p in source["path"]])
            clipped = line.intersection(core_shape)
            parts = list(clipped.geoms) if isinstance(clipped, MultiLineString) else [clipped]
            for part in parts:
                if isinstance(part, LineString) and part.length > 1:
                    kept.append({**source, "path": [list(c) for c in part.coords]})
        elif source["kind"] == "RISER":
            point = _to_page(source["point"], tile["crop"])
            if core[0] <= point[0] < core[2] and core[1] <= point[1] < core[3]:
                kept.append({**source, "point": point})
        else:
            (x0, y0), (x1, y1) = _to_page(source["box"][:2], tile["crop"]), _to_page(source["box"][2:], tile["crop"])
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if core[0] <= cx < core[2] and core[1] <= cy < core[3]:
                kept.append({**source, "box": [x0, y0, x1, y1]})
    return kept


def _merge_boxes(sources: list[dict]) -> list[dict]:
    """One piece of equipment seen whole by two tiles still has its centre in one core only,
    but a large room can be reported as two halves. Overlapping boxes of a kind become one."""
    boxes = [s for s in sources if "box" in s]
    others = [s for s in sources if "box" not in s]
    merged: list[dict] = []
    for source in sorted(boxes, key=lambda s: -_CONFIDENCE_RANK[s["confidence"]]):
        for kept in merged:
            if kept["kind"] != source["kind"]:
                continue
            a, b = shapely_box(*kept["box"]), shapely_box(*source["box"])
            if a.intersection(b).area > 0.3 * min(a.area, b.area):
                bounds = a.union(b).bounds
                kept["box"] = list(bounds)
                kept["label"] = kept["label"] or source["label"]
                kept["rating_text"] = kept["rating_text"] or source["rating_text"]
                kept["kva"] = kept["kva"] or source["kva"]
                kept["current_a"] = kept["current_a"] or source["current_a"]
                break
        else:
            merged.append(dict(source))
    return merged + others


def analyze_page(document: Document, page: int) -> dict:
    """One page, read and checked. Coordinates are pixels of the page image the plan view shows."""
    if not ai_available():
        raise PlanAiError("זיהוי אוטומטי לא הוגדר בשרת (OPENAI_API_KEY)")
    facts = page_facts(document, page)
    with storage.local_copy(render_page_png(document, page)) as path:
        with Image.open(path) as opened:
            image = opened.convert("RGB")
    width, height = image.size

    overview_image = image.copy()
    overview_image.thumbnail((OVERVIEW_SIDE, OVERVIEW_SIDE))
    overview_text = (
        f"File name: {document.file_name}\n"
        f"Page {page + 1} of {document.page_count}\n"
        f"Text extracted from the PDF (Hebrew may be garbled or reversed):\n{facts['text'][:4000]}"
    )
    tiles = tile_grid(width, height)

    def read_tile(tile: dict) -> dict:
        text = (
            f"Sheet: {document.file_name}. Tile row {tile['row'] + 1} of {tile['rows']}, "
            f"column {tile['col'] + 1} of {tile['cols']}."
        )
        # Finding small labelled equipment in a dense tile is where more reasoning pays off.
        return _call_model(TILE_PROMPT, image.crop(tile["crop"]), text, effort="medium")

    with ThreadPoolExecutor(PARALLEL_CALLS) as pool:
        overview_future = pool.submit(_call_model, OVERVIEW_PROMPT, overview_image, overview_text)
        tile_results = list(pool.map(read_tile, tiles))
        overview = clean_overview(overview_future.result())

    sources: list[dict] = []
    tile_scales = []
    for tile, raw in zip(tiles, tile_results):
        sources += sources_in_core(clean_sources(raw), tile)
        tile_scales.append(str(raw.get("scale_text") or ""))

    building_box = overview["building_box"]
    return {
        **overview,
        "building_box": [b / 1000.0 * (width if i % 2 == 0 else height) for i, b in enumerate(building_box)]
        if building_box
        else None,
        "sources": _merge_boxes(sources),
        "scale_denominator": scale_denominator(*tile_scales, overview["scale_text"], facts["text"]),
        "page_size_pt": [facts["width_pt"], facts["height_pt"]] if facts["width_pt"] else None,
        "render_scale": facts["render_scale"],
        "image_px": [width, height],
        "tiles": len(tiles),
        "model": settings.openai_model,
    }
