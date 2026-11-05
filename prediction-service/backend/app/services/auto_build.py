"""Turns what was read off the plans, plus the answers to a few questions, into the model.

Deterministic: the same analyses and answers always give the same floors, sources and
zones, so the model can be rebuilt whenever an answer changes. Everything built here is
marked AUTO, and every value that did not come from the plans or from the person is
recorded as an ENGINEERING_ASSUMPTION. What the person drew by hand is kept.
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..audit import invalidate_verification, record
from .plan_ai import PATH_KINDS
from ..models import Assumption, Document, ElectricalSource, Floor, PageAnalysis, Project, Room, User
from .source_model import ensure_details, set_field
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

TAG_PREFIX = {
    "TRANSFORMER": "T",
    "METER_BOARD": "MB",
    "DISTRIBUTION_PILLAR": "P",
    "MAIN_BOARD": "LB",
    "EV_CHARGING": "EV",
    "GENERATOR": "G",
    "PV_INVERTER": "PV",
    "FEEDER": "F",
    "BUSBAR": "BB",
    "RISER": "R",
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


def elevation(level: int, settings: dict) -> float | None:
    height = settings["basement_height_m"] if level < 0 else settings["floor_height_m"]
    return None if height is None else round(level * height, 3)


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


def missing_answers(project: Project, analyses: list[PageAnalysis]) -> list[dict]:
    """The questions still open. Building refuses until there are none."""
    settings = settings_of(project)
    missing = []
    for field, label in (
        ("floor_height_m", "גובה קומה טיפוסית"),
        ("basement_height_m", "גובה קומת מרתף"),
        ("typical_load_pct", "אחוז העמסה אופייני"),
    ):
        if settings[field] is None:
            missing.append({"field": field, "message": f"חסר: {label}"})
    choices = plan_choices(analyses, settings)
    scales = resolve_scales(choices, settings)
    for level, choice in choices.items():
        if not scales[level]["denominator"]:
            chosen = choice["chosen"]
            missing.append({"field": f"pages.{chosen['key']}.scale_denominator", "message": f"חסר קנה מידה לתוכנית של {floor_name(level, chosen['name'])}"})
    used_pages = {choice["chosen"]["key"] for choice in choices.values()}
    library = load_library()
    asked = set()
    for source in detected_sources(analyses):
        answer = settings["sources"].get(source["key"]) or {}
        kind = answer.get("kind") or source["kind"]
        if source["page_key"] not in used_pages or not is_included(kind, choices_for_page(choices, source["page_key"]), answer):
            continue
        if max_current_for(source, answer, settings) is None and kind not in asked:
            asked.add(kind)
            missing.append({"field": f"kinds.{kind}.max_current_a", "message": f"חסר זרם מרבי: {library[kind]['label']}"})
    return missing


def max_current_for(source: dict, answer: dict, settings: dict) -> float | None:
    """The source's own answer, then what its sheet says, then the answer for its kind
    (a current, or for a transformer its rating in kVA)."""
    kind = answer.get("kind") or source["kind"]
    for_kind = settings["kinds"].get(kind) or {}
    return (
        answer.get("max_current_a")
        or suggested_max_current(source)
        or for_kind.get("max_current_a")
        or current_from_kva(for_kind.get("kva"))
    )


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


def build_model(db: Session, project: Project, user: User) -> dict:
    """Rebuilds every AUTO floor, source and zone from the stored analyses and answers."""
    library = load_library()
    settings = settings_of(project)
    analyses = list(db.scalars(select(PageAnalysis).where(PageAnalysis.project_id == project.id)))
    documents = {d.id: d for d in db.scalars(select(Document).where(Document.project_id == project.id))}
    analyses = [a for a in analyses if a.document_id in documents]
    choices = plan_choices(analyses, settings)
    scales = resolve_scales(choices, settings)

    plans = {}
    for level, choice in choices.items():
        chosen = choice["chosen"]
        row, result = chosen["row"], chosen["result"]
        page_settings = settings["pages"].get(chosen["key"]) or {}
        denominator = scales[level]["denominator"]
        plans[level] = {
            "key": chosen["key"],
            "document_id": row.document_id,
            "page": row.page,
            "name": floor_name(level, chosen["name"]),
            "use": page_settings.get("use") or result.get("floor_use"),
            "box": result.get("building_box") or [0, 0, *(result.get("image_px") or [0, 0])],
            "scale": m_per_px(result, denominator),
            "denominator": denominator,
            "scale_basis": scales[level]["basis"],
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
        floor.elevation_m = elevation(level, settings)
        floor.ceiling_height_m = settings["basement_height_m"] if level < 0 else settings["floor_height_m"]
        floor.plan_document_id = plan["document_id"]
        floor.plan_page = plan["page"]
        floor.scale_m_per_px = plan["scale"]
        floor.origin_px = aligned["origin_px"] if aligned else None
        floor.calibration = {
            "auto_level": level,
            "scale_denominator": plan["denominator"],
            "scale_basis": plan["scale_basis"],
            "alignment": {k: v for k, v in (aligned or {}).items() if k != "origin_px"},
        }
        floors[level] = floor
    db.flush()

    counters: dict[str, int] = {}
    created_sources = []
    used_tags = set(db.scalars(select(ElectricalSource.tag).where(ElectricalSource.project_id == project.id)))
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

    load = (settings["typical_load_pct"] or 0) / 100.0
    top = top_occupied_level(plans)
    risers_by_level: dict[int, list[ElectricalSource]] = {}
    for level in sorted(plans):
        plan, floor = plans[level], floors[level]
        if floor.scale_m_per_px is None or not floor.origin_px:
            continue
        document_id, page = plan["document_id"], plan["page"]
        for detected in plan["sources"]:
            key = source_key(document_id, page, detected["index"])
            answer = settings["sources"].get(key) or {}
            kind = answer.get("kind") or detected["kind"]
            if not is_included(kind, choices_for_page(choices, plan["key"]), answer):
                continue
            spec = library[kind]
            max_current = max_current_for(detected, answer, settings)
            own_current = answer.get("max_current_a") or suggested_max_current(detected)
            if kind == "RISER" and max_current is not None and not own_current:
                max_current *= riser_share(level, top)
            # A sheet that covers several floors carries the same equipment on each: one tag per floor.
            base_tag = next_tag(kind, shared_key=key)
            tag = base_tag if len(choices_for_page(choices, plan["key"])) == 1 else f"{base_tag}.{level}"
            if tag in used_tags and tag != base_tag:
                tag = f"{tag}b"
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
                source_document_id=document_id,
                page=page,
                notes=" · ".join(x for x in (detected.get("label"), detected.get("rating_text")) if x),
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
                bottom = floor.elevation_m
                ceiling = None if bottom is None or floor.ceiling_height_m is None else bottom + floor.ceiling_height_m
                source.geometry = {"points": [point, list(point)], "z_values": None if ceiling is None else [bottom, ceiling]}

            if spec["mounting"] == "ceiling" and floor.ceiling_height_m is not None:
                set_field(source, "height_above_floor_m", round(floor.ceiling_height_m - spec["below_ceiling_m"], 3))
            elif spec["mounting"] == "floor":
                set_field(source, "height_above_floor_m", spec["height_above_floor_m"])
            for field in ("model_type", "box_height_m", "reference_curve", "reference_current_a", "reference_source", "arrangement", "spacing_m", "bar_width_m"):
                if field in spec:
                    set_field(source, field, spec[field])
            if detected.get("kva"):
                set_field(source, "rated_power_kva", detected["kva"])
            if max_current is not None and load:
                set_field(source, "current_a", round(max_current * load, 1))
                set_field(source, "current_basis", "ESTIMATED")
            db.add(source)
            created_sources.append(source)
            if kind == "RISER":
                risers_by_level.setdefault(level, []).append(source)

    created_sources += _continue_shafts(
        project, plans, floors, risers_by_level, settings, library, top, load, lambda: next_tag("RISER")
    )
    db.add_all(created_sources)
    db.flush()

    for source in created_sources:
        record(db, user, project.id, "source", source.id, "created", None, source.tag, "בנייה אוטומטית")

    zones = 0
    manual_floors = {
        room.floor_id for room in db.scalars(select(Room).where(Room.project_id == project.id, Room.detection_method != AUTO))
    }
    for level, floor in floors.items():
        plan = plans[level]
        if floor.id in manual_floors or floor.scale_m_per_px is None or not floor.origin_px:
            continue
        x0, y0, x1, y1 = plan["box"]
        corners = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]]
        polygon = [to_world(p, floor.scale_m_per_px, floor.origin_px) for p in corners]
        continuous = plan["use"] in CONTINUOUS_USES
        area = abs(polygon[1][0] - polygon[0][0]) * abs(polygon[2][1] - polygon[1][1])
        db.add(
            Room(
                project_id=project.id,
                floor_id=floor.id,
                name=f"{floor.name} (כל הקומה)",
                polygon_m=polygon,
                area_m2=area,
                usage_type=plan["use"] or "",
                suggested_occupancy="CONTINUOUS_OCCUPANCY" if continuous else "NON_CONTINUOUS_OCCUPANCY",
                occupancy_classification="CONTINUOUS_OCCUPANCY" if continuous else "NON_CONTINUOUS_OCCUPANCY",
                occupancy_confirmed=True,
                confidence="MEDIUM",
                detection_method=AUTO,
                source_document_id=plan["document_id"],
                page=plan["page"],
            )
        )
        zones += 1

    _record_assumptions(db, project, user, settings, library, created_sources, alignment, list(floors.values()))
    invalidate_verification(db, user, project.id, "בנייה אוטומטית של המודל")
    db.flush()
    return {
        "floors": len(floors),
        "sources": len(created_sources),
        "zones": zones,
        "alignment": {str(level): {k: v for k, v in a.items() if k != "origin_px"} for level, a in alignment.items()},
    }


def _continue_shafts(project, plans, floors, risers_by_level, settings, library, top, load, new_tag) -> list[ElectricalSource]:
    """A shaft runs through every floor between the lowest and highest one it was seen on.
    A floor in between where no shaft was read gets the nearest floor's shafts, below first."""
    if not risers_by_level:
        return []
    spec = library["RISER"]
    kind_current = (settings["kinds"].get("RISER") or {}).get("max_current_a")
    seen = sorted(risers_by_level)
    added = []
    for level in sorted(plans):
        floor = floors.get(level)
        if not seen[0] < level < seen[-1] or level in risers_by_level or floor is None:
            continue
        if floor.scale_m_per_px is None or not floor.origin_px or floor.elevation_m is None or floor.ceiling_height_m is None:
            continue
        below = [l for l in seen if l < level]
        source_level = below[-1] if below else min(l for l in seen if l > level)
        for template in risers_by_level[source_level]:
            if kind_current:
                current = kind_current * riser_share(level, top) * load
            elif template.current_a is not None:
                current = template.current_a * riser_share(level, top) / riser_share(source_level, top)
            else:
                continue
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
            set_field(riser, "current_a", round(current, 1))
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


def _record_assumptions(db, project, user, settings, library, sources, alignment, floors) -> None:
    def add(target: str, statement: str, justification: str) -> None:
        db.add(Assumption(project_id=project.id, statement=statement, justification=justification, target=f"AUTO:{target}", created_by=user.id))

    add(
        "detection",
        "מיקום המקורות, הקומות וקנה המידה זוהו אוטומטית מתוכניות החשמל ואושרו על ידי המהנדס.",
        "זיהוי אוטומטי (מודל ראייה) מתוך תוכניות החשמל שהועלו.",
    )
    add("load", f"הזרם בחישוב הוא {settings['typical_load_pct']:g}% מהזרם המרבי של כל מקור (זרם אופייני).", "תשובת המהנדס בשאלון.")
    add(
        "heights",
        f"גובה קומה טיפוסית {settings['floor_height_m']:g} מ׳, גובה קומת מרתף {settings['basement_height_m']:g} מ׳; קווי הזנה מתחת לתקרה.",
        "תשובת המהנדס בשאלון; מיקום קווי ההזנה לפי ספריית ברירות המחדל.",
    )
    kinds = sorted({s.source_type for s in sources})
    for kind, spec in library.items():
        if spec["source_type"] in kinds and "reference_source" in spec:
            add(f"model:{kind}", f"{spec['label']}: עקומת ייחוס מספריית ברירות המחדל.", spec["reference_source"])
    inferred = [str(f.calibration.get("auto_level")) for f in floors if (f.calibration or {}).get("scale_basis") == "INFERRED"]
    if inferred:
        add("scale", f"קנה המידה של התוכניות בקומות {', '.join(inferred)} הוסק מגודל המבנה בקומות האחרות.", "קנה המידה לא נקרא מהתוכנית או לא התאים לשאר הקומות.")
    add(
        "feeders",
        "קווי הזנה ראשיים נכללו במרתפים ובקומת הקרקע בלבד; קווים שזוהו בקומות העליונות הם הזנות לדירות ולא נכללו.",
        "כלל של המערכת: קווי ההזנה הראשיים עוברים במרתף ובקומת הקרקע, ומשם בפירים.",
    )
    if any(s.source_type == "RISER" for s in sources):
        add(
            "risers",
            "הזרם בפיר ההזנה יורד מקומה לקומה: מלוא הזרם עד קומה 1, ובכל קומה מעליה חלק יחסי לקומות שמעליה. "
            "פיר שזוהה בקומות שמעל ומתחת לקומה הושלם גם בה, באותו מיקום.",
            "כל קומה מזינה את הדירות שבה מהפיר, כך שהזרם בפיר קטן ככל שעולים.",
        )
    weak = [str(level) for level, a in alignment.items() if a["method"] == "BOX_CORNER"]
    if weak:
        add("alignment", f"יישור הקומות {', '.join(weak)} נעשה לפי מסגרת המבנה ולא לפי התאמת השרטוט.", "התאמת השרטוטים בין הקומות לא הייתה חד-משמעית.")
