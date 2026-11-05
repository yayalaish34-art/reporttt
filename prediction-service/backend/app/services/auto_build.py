"""Turns what was read off the plans, plus the answers to a few questions, into the model.

Deterministic: the same analyses and answers always give the same floors, sources and
zones, so the model can be rebuilt whenever an answer changes. Everything built here is
marked AUTO, and every value that did not come from the plans or from the person is
recorded as an ENGINEERING_ASSUMPTION. What the person drew by hand is kept.
"""

import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.ops import unary_union
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..audit import invalidate_verification, record
from .plan_ai import PATH_KINDS
from ..models import Assumption, Document, ElectricalSource, Floor, OccupancyProfile, PageAnalysis, Project, Room, User
from .source_model import ensure_details, is_line, set_field
from .visualization import render_page_png

LIBRARY_PATH = Path(__file__).resolve().parents[2] / "data" / "default_source_models.json"
AUTO = "AUTO"
METRES_PER_PT = 0.0254 / 72.0
ALIGN_M_PER_PX = 0.1
# Phase correlation peak relative to the correlation's spread; below it the match is not trusted.
ALIGN_MIN_SCORE = 8.0
# Coarse matching works on 1 m cells; the fine match looks within 3 m of it.
COARSE_CELL_PX = 10
FINE_SEARCH_PX = 30
NOMINAL_LV_V = 400.0

DEFAULT_SETTINGS = {
    "floor_height_m": None,
    "basement_height_m": None,
    "typical_load_pct": None,
    "pages": {},
    "sources": {},
    "kinds": {},
}

# Tags in Hebrew, as they appear on the plans and in the report.
TAG_PREFIX = {
    "TRANSFORMER": "ש",
    "METER_BOARD": "מ",
    "DISTRIBUTION_PILLAR": "פל",
    "MAIN_BOARD": "ל",
    "EV_CHARGING": "ט",
    "GENERATOR": "ג",
    "PV_INVERTER": "ממ",
    "FEEDER": "ק",
    "BUSBAR": "פס",
    "RISER": "פ",
}
CONTINUOUS_USES = ("RESIDENTIAL", "OFFICE", "COMMERCIAL", "PUBLIC", "MIXED")


def load_library() -> dict:
    return json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))["kinds"]


def page_key(document_id: str, page: int) -> str:
    return f"{document_id}:{page}"


def source_key(document_id: str, page: int, index: int) -> str:
    return f"{document_id}:{page}:{index}"


def settings_of(project: Project) -> dict:
    stored = project.auto_settings or {}
    return {
        **DEFAULT_SETTINGS,
        **stored,
        "pages": dict(stored.get("pages") or {}),
        "sources": dict(stored.get("sources") or {}),
        "kinds": dict(stored.get("kinds") or {}),
    }


def current_from_kva(kva: float | None) -> float | None:
    return round(kva * 1000.0 / (math.sqrt(3) * NOMINAL_LV_V)) if kva else None


def m_per_px(analysis: dict, denominator: int | None) -> float | None:
    """Paper size is exact in a PDF, so the drawing scale is all that is needed."""
    if not denominator or not analysis.get("render_scale"):
        return None
    return METRES_PER_PT / analysis["render_scale"] * denominator


# ── Which page is each floor ────────────────────────────────────────────


def plan_choices(analyses: list[PageAnalysis], settings: dict) -> dict[int, dict]:
    """For every floor level, the pages that show it and the one used as its plan.

    An electrical sheet wins over an architectural one: the sources are drawn on it. Among
    electrical sheets the one with more sources wins, unless the person chose another.
    """
    by_level: dict[int, list[dict]] = {}
    sheets = [row for row in analyses if row.result.get("sheet_kind") != "SINGLE_LINE"]
    # A roof's level depends on how many floors the building has, which no single sheet knows.
    top = max(
        (f["level"] for row in sheets for f in row.result.get("floors") or [] if not is_roof(f["name"])),
        default=0,
    )
    for row in sheets:
        result = row.result
        key = page_key(row.document_id, row.page)
        for floor in result.get("floors") or []:
            level = top + 1 if is_roof(floor["name"]) else floor["level"]
            by_level.setdefault(level, []).append({"key": key, "row": row, "name": floor["name"], "result": result})

    choices = {}
    for level, pages in by_level.items():
        chosen_keys = [p["key"] for p in pages if (settings["pages"].get(p["key"]) or {}).get("plan_for") == level]

        def rank(p):
            electrical = p["result"].get("sheet_kind") == "ELECTRICAL"
            return (electrical, len(p["result"].get("sources") or []), p["row"].created_at)

        chosen = next((p for p in pages if p["key"] in chosen_keys), None) or max(pages, key=rank)
        choices[level] = {"chosen": chosen, "pages": pages}
    return choices


def is_roof(name: str) -> bool:
    return "גג" in (name or "")


STANDARD_SCALES = (20, 25, 50, 75, 100, 125, 200, 250, 500)
# A floor this much larger or smaller than the others is read at the wrong scale.
SCALE_OUTLIER_RATIO = 1.6


def resolve_scales(choices: dict[int, dict], settings: dict) -> dict[int, dict]:
    """The scale of every floor's plan, and where it came from.

    USER: answered. READ: written on the sheet and consistent with the other floors.
    INFERRED: missing or inconsistent, so the standard scale that gives this building the
    same size as the other floors. INFERRED is shown for confirmation, never hidden.
    """
    plans = {}
    for level, choice in choices.items():
        chosen = choice["chosen"]
        result = chosen["result"]
        box = result.get("building_box")
        plans[level] = {
            "answered": (settings["pages"].get(chosen["key"]) or {}).get("scale_denominator"),
            "read": result.get("scale_denominator"),
            "width_px": (box[2] - box[0]) if box else None,
            "result": result,
        }

    def width_m(plan, denominator):
        scale = m_per_px(plan["result"], denominator)
        return plan["width_px"] * scale if scale and plan["width_px"] else None

    known = sorted(w for w in (width_m(p, p["answered"] or p["read"]) for p in plans.values()) if w)
    median = known[len(known) // 2] if known else None

    resolved = {}
    for level, plan in plans.items():
        if plan["answered"]:
            resolved[level] = {"denominator": plan["answered"], "basis": "USER"}
            continue
        if plan["read"]:
            width = width_m(plan, plan["read"])
            if median is None or width is None or 1 / SCALE_OUTLIER_RATIO <= width / median <= SCALE_OUTLIER_RATIO:
                resolved[level] = {"denominator": plan["read"], "basis": "READ"}
                continue
        if median is None or not plan["width_px"] or not plan["result"].get("render_scale"):
            resolved[level] = {"denominator": None, "basis": "MISSING"}
            continue
        best = min(STANDARD_SCALES, key=lambda d: abs(math.log(width_m(plan, d) / median)))
        resolved[level] = {"denominator": best, "basis": "INFERRED"}
    return resolved


def floor_name(level: int, read_name: str) -> str:
    if read_name:
        return read_name
    if level == 0:
        return "קומת קרקע"
    return f"מרתף {level}" if level < 0 else f"קומה {level}"


# ── Aligning floors to one another ──────────────────────────────────────


def _alignment_image(document: Document, page: int, box: list[float], scale: float) -> tuple[np.ndarray, tuple[int, int]]:
    """The building drawing, lines as 1, resampled to ALIGN_M_PER_PX."""
    with storage.local_copy(render_page_png(document, page)) as path:
        with Image.open(path) as opened:
            gray = opened.convert("L")
    x0, y0, x1, y1 = box
    margin = 0.03 * max(x1 - x0, y1 - y0)
    crop = (max(int(x0 - margin), 0), max(int(y0 - margin), 0), min(int(x1 + margin), gray.width), min(int(y1 + margin), gray.height))
    region = gray.crop(crop)
    factor = scale / ALIGN_M_PER_PX
    size = (max(int(region.width * factor), 8), max(int(region.height * factor), 8))
    small = region.resize(size, Image.Resampling.BOX).filter(ImageFilter.GaussianBlur(1.5))
    lines = 1.0 - np.asarray(small, dtype=np.float32) / 255.0
    return lines - lines.mean(), (crop[0], crop[1])


def _correlation(reference: np.ndarray, other: np.ndarray, whiten: bool) -> np.ndarray:
    height = max(reference.shape[0], other.shape[0]) * 2
    width = max(reference.shape[1], other.shape[1]) * 2
    a = np.zeros((height, width), np.float32)
    b = np.zeros((height, width), np.float32)
    a[: reference.shape[0], : reference.shape[1]] = reference - reference.mean()
    b[: other.shape[0], : other.shape[1]] = other - other.mean()
    spectrum = np.fft.rfft2(a) * np.conj(np.fft.rfft2(b))
    if whiten:
        spectrum /= np.abs(spectrum) + 1e-9
    return np.fft.irfft2(spectrum, s=(height, width))


def _peak(correlation: np.ndarray, centre: tuple[float, float] = (0.0, 0.0), radius: float | None = None) -> tuple[float, float, float]:
    """(dx, dy, score) of the highest peak, optionally within `radius` of `centre`."""
    height, width = correlation.shape
    mean, spread = correlation.mean(), correlation.std() + 1e-12
    if radius is not None:
        rows = np.arange(height)
        cols = np.arange(width)
        row_shift = np.where(rows > height // 2, rows - height, rows)
        col_shift = np.where(cols > width // 2, cols - width, cols)
        far = (np.abs(row_shift - centre[1])[:, None] > radius) | (np.abs(col_shift - centre[0])[None, :] > radius)
        correlation = np.where(far, -np.inf, correlation)
    row, col = np.unravel_index(int(np.argmax(correlation)), correlation.shape)
    dy = row - height if row > height // 2 else row
    dx = col - width if col > width // 2 else col
    return float(dx), float(dy), float((correlation[row, col] - mean) / spread)


def _downsample(image: np.ndarray, factor: int) -> np.ndarray:
    height, width = (image.shape[0] // factor) * factor, (image.shape[1] // factor) * factor
    return image[:height, :width].reshape(height // factor, factor, width // factor, factor).mean(axis=(1, 3))


def phase_shift(reference: np.ndarray, other: np.ndarray) -> tuple[float, float, float]:
    """(dx, dy, score) such that other(c) ≈ reference(c + d), in reference pixels.

    Coarse first, on where the drawing is dense (1 m cells): the building's mass. A thin
    sheet frame or a title block hardly counts there, and two identical buildings side by
    side give one clear peak, both overlapping. Then fine, on the lines themselves, only
    close to the coarse answer.
    """
    factor = COARSE_CELL_PX
    coarse = _peak(_correlation(_downsample(reference, factor), _downsample(other, factor), whiten=False))
    centre = (coarse[0] * factor, coarse[1] * factor)
    return _peak(_correlation(reference, other, whiten=True), centre, radius=FINE_SEARCH_PX)


def align_floors(plans: dict[int, dict], documents: dict[str, Document]) -> dict[int, dict]:
    """Origin pixel per level, so every floor shares one horizontal coordinate system.

    The reference is the ground floor when there is one. Each other floor is matched to it
    by phase correlation of the building drawings; a weak match falls back to lining up the
    corners of the building frames, and says so.
    """
    usable = {level: plan for level, plan in plans.items() if plan["scale"] and plan["box"]}
    if not usable:
        return {}
    reference_level = 0 if 0 in usable else min(usable, key=abs)
    images = {}
    for level, plan in usable.items():
        images[level] = _alignment_image(documents[plan["document_id"]], plan["page"], plan["box"], plan["scale"])
    reference_image, _ = images[reference_level]

    result = {}
    for level, plan in usable.items():
        image, (crop_x, crop_y) = images[level]
        if level == reference_level:
            dx = dy = 0.0
            method, score = "REFERENCE", None
        else:
            dx, dy, score = phase_shift(reference_image, image)
            method = "PHASE_CORRELATION"
            if score < ALIGN_MIN_SCORE:
                dx = dy = 0.0
                method = "BOX_CORNER"
        offset = ALIGN_M_PER_PX / plan["scale"]
        result[level] = {
            "origin_px": [crop_x - dx * offset, crop_y - dy * offset],
            "method": method,
            "score": score,
            "reference_level": reference_level,
        }
    return result


def to_world(point: list[float], scale: float, origin: list[float]) -> list[float]:
    return [round((point[0] - origin[0]) * scale, 4), round((origin[1] - point[1]) * scale, 4)]


# ── Building the model ──────────────────────────────────────────────────


def detected_sources(analyses: list[PageAnalysis]) -> list[dict]:
    """Every source read on every page, with the stable key its answers are stored under."""
    items = []
    for row in analyses:
        for index, source in enumerate(row.result.get("sources") or []):
            items.append({**source, "key": source_key(row.document_id, row.page, index), "page_key": page_key(row.document_id, row.page)})
    return items


def suggested_max_current(source: dict) -> float | None:
    return source.get("current_a") or current_from_kva(source.get("kva"))


def is_included(kind: str, levels: list[int], answer: dict) -> bool:
    """Whether a detected source is calculated. An answer decides; otherwise a main feeder
    above the ground floor is left out: main feeders run in the basement and the ground
    floor, and what is drawn as a route on an upper floor is the conduit to the flats."""
    if "include" in answer:
        return bool(answer["include"])
    return not (kind in PATH_KINDS and levels and min(levels) >= 1)


def top_occupied_level(plans: dict[int, dict]) -> int:
    occupied = [level for level, plan in plans.items() if level >= 1 and plan.get("use") in CONTINUOUS_USES]
    return max(occupied) if occupied else max([level for level in plans if level >= 1], default=1)


def riser_share(level: int, top: int) -> float:
    """The part of the shaft's full current that still flows at this floor. Below the first
    floor the shaft carries everything; above, each floor's flats have been fed below it."""
    if level <= 0 or top < 1:
        return 1.0
    if level > top:
        return 1.0 / top
    return (top - level + 1) / top


def _clear_auto(db: Session, project: Project) -> None:
    for model in (ElectricalSource, Room):
        for row in db.scalars(select(model).where(model.project_id == project.id, model.detection_method == AUTO)):
            db.delete(row)
    for row in db.scalars(select(Assumption).where(Assumption.project_id == project.id, Assumption.target.like("AUTO:%"))):
        db.delete(row)
    db.flush()


def _rebase(db: Session, floor: Floor, scale: float, origin: list[float]) -> None:
    from ..routers.model import _rebase_floor_geometry

    _rebase_floor_geometry(db, floor, scale, origin)


def defaults() -> dict:
    return json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))["defaults"]


def missing_answers(project: Project, analyses: list[PageAnalysis]) -> list[dict]:
    """Nothing is asked: every value comes from the plans, or from a stated default."""
    return []


def max_current_for(source: dict, answer: dict, settings: dict) -> float | None:
    """What the person or the plan says, before anything is derived."""
    kind = answer.get("kind") or source["kind"]
    for_kind = settings["kinds"].get(kind) or {}
    return (
        answer.get("max_current_a")
        or suggested_max_current(source)
        or for_kind.get("max_current_a")
        or current_from_kva(for_kind.get("kva"))
    )


# ── Floor levels ────────────────────────────────────────────────────────


def resolve_elevations(choices: dict[int, dict], settings: dict) -> dict[int, dict]:
    """Each floor's level and floor-to-floor height, read from the plans where written.

    A floor whose level is not written is placed from the nearest one that is, at the
    typical height the written ones show; with none written, at the default heights.
    """
    base = defaults()
    read: dict[int, list[float]] = {}
    for level, choice in choices.items():
        for page in choice["pages"]:
            for floor in page["result"].get("floors") or []:
                if floor.get("level") == level and floor.get("elevation_m") is not None:
                    read.setdefault(level, []).append(float(floor["elevation_m"]))
    known = {level: sorted(values)[len(values) // 2] for level, values in read.items()}

    def typical(above: bool) -> float:
        answered = settings["floor_height_m"] if above else settings["basement_height_m"]
        if answered:
            return float(answered)
        steps = [
            (known[b] - known[a]) / (b - a)
            for a in known
            for b in known
            if b > a and (a >= 0 if above else b <= 0) and 2.4 <= (known[b] - known[a]) / (b - a) <= 6
        ]
        if steps:
            return sorted(steps)[len(steps) // 2]
        return base["floor_height_m"] if above else base["basement_height_m"]

    up, down = typical(True), typical(False)
    resolved = {}
    for level in sorted(choices):
        if level in known:
            resolved[level] = {"elevation_m": round(known[level], 3), "basis": "READ"}
            continue
        below = [k for k in known if k < level]
        above = [k for k in known if k > level]
        if below and above:
            low, high = max(below), min(above)
            value = known[low] + (known[high] - known[low]) * (level - low) / (high - low)
            resolved[level] = {"elevation_m": round(value, 3), "basis": "DERIVED"}
            continue
        anchors = sorted(known, key=lambda k: abs(k - level))
        if anchors:
            anchor = anchors[0]
            value = known[anchor]
            for step in range(anchor, level, 1 if level > anchor else -1):
                value += (up if step >= 0 else down) * (1 if level > anchor else -1)
        else:
            value = level * (up if level >= 0 else down)
        resolved[level] = {"elevation_m": round(value, 3), "basis": "DERIVED"}

    levels = sorted(resolved)
    for index, level in enumerate(levels):
        height = up if level >= 0 else down
        if index + 1 < len(levels) and levels[index + 1] == level + 1:
            gap = resolved[level + 1]["elevation_m"] - resolved[level]["elevation_m"]
            if 2.0 <= gap <= 8.0:
                height = gap
        resolved[level]["height_m"] = round(height, 3)
    return resolved


# ── Currents ────────────────────────────────────────────────────────────


def apartments_on(result: dict) -> int:
    """How many flats a floor's plan shows: by their marked letter or number, or else by kitchens."""
    rooms = [z for z in result.get("zones") or [] if z.get("kind") == "APARTMENT_ROOM"]
    units = {z["unit"] for z in rooms if z.get("unit")}
    if units:
        return len(units)
    return sum(1 for z in rooms if "מטבח" in (z.get("label") or ""))


class Currents:
    """The maximum current of each source, and in words where it came from.

    In order: an answer given through the API, the value written on the plan, then what
    the building itself implies (the transformer's rating, the flats the shaft feeds),
    then the library's default. Each derived value is reported as an assumption.
    """

    def __init__(self, settings: dict, plans: dict[int, dict], detected_kinds: dict[str, list[dict]]):
        self.settings = settings
        self.base = defaults()
        self.flat_a = self.base["apartment_current_a"]
        self.apartments = {level: apartments_on(plan["result"]) for level, plan in plans.items() if level >= 1}
        self.top = max([level for level, count in self.apartments.items() if count], default=0)
        self.top_level = max([level for level in plans if level >= 1], default=1)
        transformers = detected_kinds.get("TRANSFORMER", [])
        kvas = [t.get("kva") for t in transformers if t.get("kva")] or ([self.base["transformer_kva"]] if transformers else [])
        self.transformer_a = max((current_from_kva(kva) for kva in kvas), default=None)
        self.counts = {kind: len(items) for kind, items in detected_kinds.items()}
        self.notes: dict[str, str] = {}

    def total_flats_a(self) -> float:
        return sum(self.apartments.values()) * self.flat_a

    def riser(self, level: int, shafts_here: int) -> tuple[float, str]:
        answered = (self.settings["kinds"].get("RISER") or {}).get("max_current_a")
        if answered:
            return answered * riser_share(level, self.top_level), "הוזן, יורד מקומה לקומה"
        if self.top and self.total_flats_a():
            fed = sum(count for floor, count in self.apartments.items() if floor >= max(level, 1))
            current = max(fed, 1) * self.flat_a / max(shafts_here, 1)
            return current, f"{self.flat_a:g}A לדירה × הדירות שהפיר מזין מעל הקומה"
        default = self.base["currents_a"]["RISER"]
        return default * riser_share(level, self.top_level), "ברירת מחדל, יורד מקומה לקומה"

    def of(self, kind: str, detected: dict, answer: dict) -> tuple[float, str]:
        own = max_current_for(detected, answer, self.settings)
        if own:
            written = answer.get("max_current_a") is None and suggested_max_current(detected)
            return own, "נקרא מהתוכנית" if written else "הוזן"
        if kind == "TRANSFORMER":
            return current_from_kva(self.base["transformer_kva"]), f"שנאי {self.base['transformer_kva']:g}kVA (ברירת מחדל)"
        if kind in ("FEEDER", "BUSBAR", "DISTRIBUTION_PILLAR"):
            if self.transformer_a:
                return self.transformer_a, "זרם השנאי שמזין אותו"
            if self.total_flats_a():
                return self.total_flats_a(), f"{self.flat_a:g}A לכל דירה במבנה"
        return self.base["currents_a"][kind], "ברירת מחדל מספריית המערכת"


# ── Rooms ───────────────────────────────────────────────────────────────

STAY_KINDS = ("APARTMENT_ROOM", "OFFICE", "COMMERCIAL", "PUBLIC_ROOM")
# Hours a day someone is in each kind of space, for the guideline's 72/T + 1. A flat is
# lived in around the clock; a workplace for a working day; a passage for the guideline's
# shortest stay, an hour; a shaft, a technical room or an equipment niche not at all.
STAY_HOURS = {
    "APARTMENT_ROOM": 24.0,
    "OFFICE": 9.0,
    "COMMERCIAL": 9.0,
    "PUBLIC_ROOM": 9.0,
    "CORRIDOR": 1.0,
    "LOBBY": 1.0,
    "STAIRS": 1.0,
    "ELEVATOR": 1.0,
    "STORAGE": 1.0,
    "PARKING": 1.0,
    "SHAFT": 0.0,
    "TECHNICAL": 0.0,
}
USE_HOURS = {"RESIDENTIAL": 24.0, "MIXED": 24.0, "OFFICE": 9.0, "COMMERCIAL": 9.0, "PUBLIC": 9.0, "PARKING": 1.0, "TECHNICAL": 0.0}
ZONE_LABELS = {
    "APARTMENT_ROOM": "חדר בדירה",
    "OFFICE": "משרד",
    "COMMERCIAL": "שטח מסחרי",
    "PUBLIC_ROOM": "חדר ציבורי",
    "CORRIDOR": "מסדרון",
    "LOBBY": "לובי",
    "STAIRS": "חדר מדרגות",
    "ELEVATOR": "מעלית",
    "SHAFT": "פיר",
    "STORAGE": "מחסן",
    "TECHNICAL": "חדר טכני",
    "PARKING": "חניה",
}


def _find_rooms(document: Document, plan: dict) -> dict:
    """The rooms on one plan. Pure, so plans can be worked on side by side."""
    from . import rooms as room_finder

    key = f"{plan['denominator']}"
    if not plan["result"].get("zones") or not plan["scale"]:
        return {"key": key, "rooms": [], "footprint_px": []}
    with storage.local_copy(render_page_png(document, plan["row"].page)) as path:
        return {"key": key, **room_finder.segment(path, plan["box"], plan["scale"], plan["result"]["zones"])}


def plans_rooms(documents: dict[str, Document], plans: dict[int, dict]) -> dict[str, dict]:
    """Rooms for every plan in use, found once and kept with its reading."""
    distinct = {plan["key"]: plan for plan in plans.values()}
    found, todo = {}, []
    for key, plan in distinct.items():
        cache = plan["result"].get("rooms_cache") or {}
        if cache.get("key") == f"{plan['denominator']}":
            found[key] = cache
        else:
            todo.append(plan)
    with ThreadPoolExecutor(4) as pool:
        for plan, result in zip(todo, pool.map(lambda p: _find_rooms(documents[p["document_id"]], p), todo)):
            found[plan["key"]] = result
            plan["row"].result = {**plan["result"], "rooms_cache": result}
    return found


def _room(project, floor, plan, name, kind, polygon, holes, continuous, area, hours) -> Room:
    return Room(
        profile=OccupancyProfile(hours_per_day=hours, source_note="לפי סוג החלל"),
        project_id=project.id,
        floor_id=floor.id,
        name=name[:200],
        polygon_m=polygon,
        holes_m=holes or None,
        area_m2=round(area, 2),
        usage_type=kind,
        suggested_occupancy="CONTINUOUS_OCCUPANCY" if continuous else "NON_CONTINUOUS_OCCUPANCY",
        occupancy_classification="CONTINUOUS_OCCUPANCY" if continuous else "NON_CONTINUOUS_OCCUPANCY",
        occupancy_confirmed=True,
        confidence="MEDIUM",
        detection_method=AUTO,
        source_document_id=plan["document_id"],
        page=plan["page"],
    )


# Boards, pillars and transformers stand in a niche or an electrical room. The strip around
# one that no room claims is that space, not part of a flat.
EQUIPMENT_STRIP_M = 1.0


def build_rooms(project, floor: Floor, plan: dict, found: dict, equipment: list[tuple[str, list]] | None = None) -> list[Room]:
    """Every room the plan shows, and the rest of the floor as one more zone.

    Inside a flat, an office or a shop is prolonged occupancy; a corridor, a lobby, stairs,
    an elevator, a shaft, storage, a technical room or parking is not. What no room covers
    is counted by the floor's use: prolonged on a floor people live or work on.
    """
    scale, origin = floor.scale_m_per_px, floor.origin_px
    world = lambda points: [to_world(p, scale, origin) for p in points]
    outline = [ShapelyPolygon(world(part)).buffer(0) for part in found.get("footprint_px") or []]
    if not outline:
        x0, y0, x1, y1 = plan["box"]
        outline = [ShapelyPolygon(world([[x0, y1], [x1, y1], [x1, y0], [x0, y0]]))]
    building = unary_union(outline)
    made: list[Room] = []
    shapes = []
    for room in found.get("rooms") or []:
        polygon = world(room["polygon_px"])
        # A room that grew out through a wide opening is cut back to the building.
        shape = ShapelyPolygon(polygon).buffer(0).intersection(building)
        if shape.is_empty or shape.area < 0.4:
            continue
        if shape.geom_type == "MultiPolygon":
            shape = max(shape.geoms, key=lambda part: part.area)
        shapes.append(shape)
        label = room["label"] or ZONE_LABELS[room["kind"]]
        name = f"{label} (דירה {room['unit']})" if room.get("unit") and room["kind"] == "APARTMENT_ROOM" else label
        made.append(
            _room(project, floor, plan, name, ZONE_LABELS[room["kind"]], [list(c) for c in shape.exterior.coords[:-1]], None,
                  room["kind"] in STAY_KINDS, shape.area, STAY_HOURS[room["kind"]])
        )

    rooms_area = unary_union(shapes) if shapes else None
    for tag, corners in equipment or []:
        around = ShapelyPolygon([(corners[0][0], corners[0][1]), (corners[1][0], corners[0][1]), (corners[1][0], corners[1][1]), (corners[0][0], corners[1][1])])
        strip = around.buffer(EQUIPMENT_STRIP_M).intersection(building)
        if rooms_area is not None:
            strip = strip.difference(rooms_area)
        strip = strip.buffer(0)
        part = max(strip.geoms, key=lambda g: g.area) if hasattr(strip, "geoms") else strip
        if part.is_empty or part.geom_type != "Polygon" or part.area < 0.5:
            continue
        shapes.append(part)
        rooms_area = part if rooms_area is None else rooms_area.union(part)
        made.append(
            _room(project, floor, plan, f"סביבת ציוד חשמלי {tag}", "אזור טכני", [list(c) for c in part.exterior.coords[:-1]],
                  [[list(c) for c in ring.coords[:-1]] for ring in part.interiors], False, part.area, 0.0)
        )
    rest = building.difference(unary_union(shapes)) if shapes else building
    parts = [part for part in (rest.geoms if hasattr(rest, "geoms") else [rest]) if part.geom_type == "Polygon" and part.area >= 1.0]
    continuous = plan["use"] in CONTINUOUS_USES or plan["use"] is None
    for number, part in enumerate(sorted(parts, key=lambda p: -p.area), start=1):
        name = "שאר שטח הקומה" if len(parts) == 1 else f"שאר שטח הקומה {number}"
        holes = [[list(c) for c in ring.coords[:-1]] for ring in part.interiors]
        made.append(
            _room(project, floor, plan, name, "שטח כללי", [list(c) for c in part.exterior.coords[:-1]], holes,
                  continuous, part.area, USE_HOURS.get(plan["use"], 24.0))
        )
    return made


# ── Building the model ──────────────────────────────────────────────────


def build_model(db: Session, project: Project, user: User) -> dict:
    """Rebuilds every AUTO floor, source and zone from the stored readings."""
    library = load_library()
    base = defaults()
    settings = settings_of(project)
    analyses = list(db.scalars(select(PageAnalysis).where(PageAnalysis.project_id == project.id)))
    documents = {d.id: d for d in db.scalars(select(Document).where(Document.project_id == project.id))}
    analyses = [a for a in analyses if a.document_id in documents]
    choices = plan_choices(analyses, settings)
    scales = resolve_scales(choices, settings)
    elevations = resolve_elevations(choices, settings)

    plans = {}
    for level, choice in choices.items():
        chosen = choice["chosen"]
        row, result = chosen["row"], chosen["result"]
        page_settings = settings["pages"].get(chosen["key"]) or {}
        denominator = scales[level]["denominator"] or base["scale_denominator"]
        basis = scales[level]["basis"] if scales[level]["denominator"] else "DEFAULT"
        plans[level] = {
            "key": chosen["key"],
            "row": row,
            "result": result,
            "document_id": row.document_id,
            "page": row.page,
            "name": floor_name(level, chosen["name"]),
            "use": page_settings.get("use") or result.get("floor_use"),
            "box": result.get("building_box") or [0, 0, *(result.get("image_px") or [0, 0])],
            "scale": m_per_px(result, denominator),
            "denominator": denominator,
            "scale_basis": basis,
            "sources": merge_risers(result.get("sources") or [], m_per_px(result, denominator)),
        }
    alignment = align_floors(plans, documents)

    _clear_auto(db, project)
    existing = {
        (floor.calibration or {}).get("auto_level"): floor
        for floor in db.scalars(select(Floor).where(Floor.project_id == project.id))
        if (floor.calibration or {}).get("auto_level") is not None
    }
    for level, floor in existing.items():
        if level not in plans:
            record(db, user, project.id, "floor", floor.id, "deleted", floor.name, None, "בנייה אוטומטית")
            db.delete(floor)
    db.flush()

    floors: dict[int, Floor] = {}
    for order, level in enumerate(sorted(plans)):
        plan = plans[level]
        aligned = alignment.get(level)
        floor = existing.get(level)
        if floor is None:
            floor = Floor(project_id=project.id, name=plan["name"])
            db.add(floor)
            db.flush()
            record(db, user, project.id, "floor", floor.id, "created", None, plan["name"], "בנייה אוטומטית")
        elif plan["scale"] and aligned:
            _rebase(db, floor, plan["scale"], aligned["origin_px"])
        floor.name = plan["name"]
        floor.sort_order = order
        floor.elevation_m = elevations[level]["elevation_m"]
        floor.ceiling_height_m = elevations[level]["height_m"]
        floor.plan_document_id = plan["document_id"]
        floor.plan_page = plan["page"]
        floor.scale_m_per_px = plan["scale"]
        floor.origin_px = aligned["origin_px"] if aligned else None
        floor.calibration = {
            "auto_level": level,
            "scale_denominator": plan["denominator"],
            "scale_basis": plan["scale_basis"],
            "elevation_basis": elevations[level]["basis"],
            "alignment": {k: v for k, v in (aligned or {}).items() if k != "origin_px"},
        }
        floors[level] = floor
    db.flush()

    used_tags = set(db.scalars(select(ElectricalSource.tag).where(ElectricalSource.project_id == project.id)))
    counters: dict[str, int] = {}
    shared_tags: dict[str, str] = {}

    def next_tag(kind: str, shared_key: str | None = None) -> str:
        if shared_key and shared_key in shared_tags:
            return shared_tags[shared_key]
        prefix = TAG_PREFIX[kind]
        while True:
            counters[prefix] = counters.get(prefix, 0) + 1
            tag = f"{prefix}{counters[prefix]}"
            if tag not in used_tags:
                used_tags.add(tag)
                break
        if shared_key:
            shared_tags[shared_key] = tag
        return tag

    included: dict[int, list[tuple[dict, str, dict]]] = {}
    by_kind: dict[str, list[dict]] = {}
    for level in sorted(plans):
        plan = plans[level]
        for detected in plan["sources"]:
            key = source_key(plan["document_id"], plan["page"], detected["index"])
            answer = settings["sources"].get(key) or {}
            kind = answer.get("kind") or detected["kind"]
            if is_included(kind, choices_for_page(choices, plan["key"]), answer):
                included.setdefault(level, []).append((detected, kind, answer))
                by_kind.setdefault(kind, []).append(detected)
    currents = Currents(settings, plans, by_kind)
    load = (settings["typical_load_pct"] or base["typical_load_pct"]) / 100.0
    current_notes: dict[str, set] = {}

    created_sources = []
    risers_by_level: dict[int, list[ElectricalSource]] = {}
    for level in sorted(plans):
        plan, floor = plans[level], floors[level]
        if floor.scale_m_per_px is None or not floor.origin_px:
            continue
        shafts_here = sum(1 for _, kind, _ in included.get(level, []) if kind == "RISER")
        for detected, kind, answer in included.get(level, []):
            key = source_key(plan["document_id"], plan["page"], detected["index"])
            spec = library[kind]
            if kind == "RISER" and not (answer.get("max_current_a") or suggested_max_current(detected)):
                max_current, note = currents.riser(level, shafts_here)
            else:
                max_current, note = currents.of(kind, detected, answer)
            current_notes.setdefault(spec["label"], set()).add(note)
            base_tag = next_tag(kind, shared_key=key)
            tag = base_tag if len(choices_for_page(choices, plan["key"])) == 1 else f"{base_tag}.{level}"
            used_tags.add(tag)

            source = ElectricalSource(
                project_id=project.id,
                floor_id=floor.id,
                tag=tag,
                source_type=spec["source_type"],
                geometry={"points": []},
                confidence=detected.get("confidence", "LOW"),
                detection_method=AUTO,
                user_verified=answer.get("confirmed", detected.get("confidence") != "LOW"),
                source_document_id=plan["document_id"],
                page=plan["page"],
                notes=" · ".join(x for x in (detected.get("label"), detected.get("rating_text"), note) if x),
            )
            ensure_details(source)
            scale, origin = floor.scale_m_per_px, floor.origin_px
            if "box" in detected:
                x0, y0, x1, y1 = detected["box"]
                a, b = to_world([x0, y1], scale, origin), to_world([x1, y0], scale, origin)
                minimum = spec.get("min_box_m", 0.5)
                for axis in (0, 1):
                    if abs(b[axis] - a[axis]) < minimum:
                        middle = (a[axis] + b[axis]) / 2
                        a[axis], b[axis] = middle - minimum / 2, middle + minimum / 2
                source.geometry = {"points": [a, b]}
            elif "path" in detected:
                source.geometry = {"points": [to_world(p, scale, origin) for p in detected["path"]]}
            else:
                point = to_world(detected["point"], scale, origin)
                source.geometry = {"points": [point, list(point)], "z_values": [floor.elevation_m, floor.elevation_m + floor.ceiling_height_m]}

            if spec["mounting"] == "ceiling":
                set_field(source, "height_above_floor_m", round(floor.ceiling_height_m - spec["below_ceiling_m"], 3))
            elif spec["mounting"] == "floor":
                set_field(source, "height_above_floor_m", spec["height_above_floor_m"])
            for field in ("model_type", "box_height_m", "reference_curve", "reference_current_a", "reference_source", "arrangement", "spacing_m", "bar_width_m"):
                if field in spec:
                    set_field(source, field, spec[field])
            if detected.get("kva"):
                set_field(source, "rated_power_kva", detected["kva"])
            set_field(source, "current_a", round(max_current * load, 1))
            set_field(source, "current_basis", "ESTIMATED")
            db.add(source)
            created_sources.append(source)
            if kind == "RISER":
                risers_by_level.setdefault(level, []).append(source)

    created_sources += _continue_shafts(project, plans, floors, risers_by_level, currents, library, load, lambda: next_tag("RISER"))
    db.add_all(created_sources)
    db.flush()
    for source in created_sources:
        record(db, user, project.id, "source", source.id, "created", None, source.tag, "בנייה אוטומטית")

    zones = 0
    manual_floors = {
        room.floor_id for room in db.scalars(select(Room).where(Room.project_id == project.id, Room.detection_method != AUTO))
    }
    found_by_plan = plans_rooms(documents, plans)
    for level, floor in floors.items():
        plan = plans[level]
        if floor.id in manual_floors or floor.scale_m_per_px is None or not floor.origin_px:
            continue
        equipment = [
            (s.tag, s.geometry["points"][:2])
            for s in created_sources
            if s.floor_id == floor.id and not is_line(s.source_type) and len(s.geometry.get("points") or []) >= 2
        ]
        for room in build_rooms(project, floor, plan, found_by_plan[plan["key"]], equipment):
            db.add(room)
            zones += 1

    _record_assumptions(db, project, user, settings, library, created_sources, alignment, list(floors.values()), elevations, current_notes, load)
    invalidate_verification(db, user, project.id, "בנייה אוטומטית של המודל")
    db.flush()
    return {
        "floors": len(floors),
        "sources": len(created_sources),
        "zones": zones,
        "alignment": {str(level): {k: v for k, v in a.items() if k != "origin_px"} for level, a in alignment.items()},
    }


def _continue_shafts(project, plans, floors, risers_by_level, currents, library, load, new_tag) -> list[ElectricalSource]:
    """A shaft runs through every floor between the lowest and highest one it was seen on.
    A floor in between where no shaft was read gets the nearest floor's shafts, below first."""
    if not risers_by_level:
        return []
    spec = library["RISER"]
    seen = sorted(risers_by_level)
    added = []
    for level in sorted(plans):
        floor = floors.get(level)
        if not seen[0] < level < seen[-1] or level in risers_by_level or floor is None:
            continue
        if floor.scale_m_per_px is None or not floor.origin_px:
            continue
        below = [l for l in seen if l < level]
        source_level = below[-1] if below else min(l for l in seen if l > level)
        templates = risers_by_level[source_level]
        current, _ = currents.riser(level, len(templates))
        for template in templates:
            point = list(template.geometry["points"][0])
            riser = ElectricalSource(
                project_id=project.id,
                floor_id=floor.id,
                tag=new_tag(),
                source_type=spec["source_type"],
                geometry={"points": [point, list(point)], "z_values": [floor.elevation_m, floor.elevation_m + floor.ceiling_height_m]},
                confidence="LOW",
                detection_method=AUTO,
                user_verified=True,
                notes=f"המשך הפיר {template.tag} (הושלם אוטומטית)",
            )
            ensure_details(riser)
            for field in ("arrangement", "spacing_m"):
                set_field(riser, field, spec[field])
            set_field(riser, "current_a", round(current * load, 1))
            set_field(riser, "current_basis", "ESTIMATED")
            added.append(riser)
    return added


RISER_MERGE_M = 2.0


def merge_risers(sources: list[dict], scale: float | None) -> list[dict]:
    """Several callouts on one shaft are one riser. Each source keeps its index on the sheet,
    which is the key its answers are stored under."""
    indexed = [{**source, "index": index} for index, source in enumerate(sources)]
    if not scale:
        return indexed
    kept: list[dict] = []
    for source in indexed:
        if source["kind"] == "RISER":
            near = next(
                (k for k in kept if k["kind"] == "RISER" and math.dist(k["point"], source["point"]) * scale < RISER_MERGE_M),
                None,
            )
            if near is not None:
                near["label"] = near["label"] or source["label"]
                continue
        kept.append(source)
    return kept


def choices_for_page(choices: dict[int, dict], key: str) -> list[int]:
    return [level for level, choice in choices.items() if choice["chosen"]["key"] == key]


def _record_assumptions(db, project, user, settings, library, sources, alignment, floors, elevations, current_notes, load) -> None:
    def add(target: str, statement: str, justification: str) -> None:
        db.add(Assumption(project_id=project.id, statement=statement, justification=justification, target=f"AUTO:{target}", created_by=user.id))

    add(
        "detection",
        "הקומות, קנה המידה, החדרים ומקורות הקרינה זוהו אוטומטית מתוכניות החשמל והגרמושקה.",
        "קריאה אוטומטית של התוכניות (מודל ראייה), וקווי הקירות שבתוכנית לגבולות החדרים.",
    )
    add(
        "rooms",
        "בתוך דירה, משרד או חנות השהייה ממושכת. מסדרון, לובי, חדר מדרגות, מעלית, פיר, מחסן, חדר טכני וחניה: שהייה לא ממושכת. "
        "שטח בקומה שלא זוהה כחדר מסוים נחשב לפי שימוש הקומה: שהייה ממושכת בקומת מגורים או משרדים.",
        "כלל המערכת. שטח שלא זוהה נחשב כשהייה ממושכת, כך שטעות בזיהוי מחמירה ולא מקלה.",
    )
    add("load", f"הזרם בחישוב הוא {load * 100:g}% מהזרם המרבי של כל מקור (זרם אופייני).", "ברירת המחדל של המערכת, כנהוג בדוחות חיזוי.")
    read = [f.name for f in floors if (f.calibration or {}).get("elevation_basis") == "READ"]
    derived = [f.name for f in floors if (f.calibration or {}).get("elevation_basis") != "READ"]
    if derived:
        add(
            "heights",
            f"מפלסי הקומות {', '.join(derived)} לא נכתבו בתוכניות, והם חושבו מהמפלסים שנקראו ({', '.join(read) or 'אין'}) ומגובה קומה טיפוסי.",
            "גובה קומה טיפוסי לפי המפלסים שבתוכניות, ובהיעדרם לפי ברירת המחדל של המערכת.",
        )
    for label, notes in sorted(current_notes.items()):
        add(f"current:{label}", f"{label}: הזרם המרבי לפי {'; '.join(sorted(notes))}.", "נגזר מהתוכניות ומהמבנה; ערך שלא נכתב בתוכנית נלקח מספריית המערכת.")
    kinds = sorted({s.source_type for s in sources})
    for kind, spec in library.items():
        if spec["source_type"] in kinds and "reference_source" in spec:
            add(f"model:{kind}", f"{spec['label']}: עקומת ייחוס מספריית ברירות המחדל.", spec["reference_source"])
    add(
        "feeders",
        "קווי הזנה ראשיים נכללו במרתפים ובקומת הקרקע בלבד; קווים שזוהו בקומות העליונות הם הזנות לדירות ולא נכללו.",
        "כלל של המערכת: קווי ההזנה הראשיים עוברים במרתף ובקומת הקרקע, ומשם בפירים.",
    )
    if any(s.source_type == "RISER" for s in sources):
        add(
            "risers",
            "פיר שזוהה בקומות שמעל ומתחת לקומה הושלם גם בה, באותו מיקום. נקודות בטווח 0.5 מ׳ מכבלי הפיר (בתוך הפיר) אינן נכללות בתוצאות.",
            "פיר חשמל רציף לאורך המבנה; בתוך הפיר אין שהייה.",
        )
    inferred = [f.name for f in floors if (f.calibration or {}).get("scale_basis") in ("INFERRED", "DEFAULT")]
    if inferred:
        add("scale", f"קנה המידה של התוכניות בקומות {', '.join(inferred)} הוסק מגודל המבנה בקומות האחרות.", "קנה המידה לא נקרא מהתוכנית או לא התאים לשאר הקומות.")
    weak = [str(level) for level, a in alignment.items() if a["method"] == "BOX_CORNER"]
    if weak:
        add("alignment", f"יישור הקומות {', '.join(weak)} נעשה לפי מסגרת המבנה ולא לפי התאמת השרטוט.", "התאמת השרטוטים בין הקומות לא הייתה חד-משמעית.")
