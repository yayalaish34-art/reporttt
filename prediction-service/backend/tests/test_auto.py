"""The automatic flow: reading checks, tiling, scales, alignment, and build-to-report through the API.

The vision model itself is replaced by fixed answers. What is tested is everything around it:
that a bad answer is refused, that tiles never count a source twice, and that the model built
from the answers is the one the strict engine then calculates.
"""

import io
import math

import numpy as np
import pytest
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas

from app.services import auto_build, plan_ai

from test_api_flow import admin, api, app_client, make_project  # noqa: F401  (fixtures)


# ── What comes back from the model is checked ───────────────────────────


def test_clean_sources_keeps_only_usable_positions():
    raw = {
        "sources": [
            {"kind": "TRANSFORMER", "box": [100, 100, 200, 200], "kva": 630, "confidence": "HIGH"},
            {"kind": "TRANSFORMER", "box": [100, 100, 100, 100]},  # no area, no point
            {"kind": "FEEDER", "path": [[0, 0]]},  # one point is not a route
            {"kind": "FEEDER", "path": [[0, 0], [500, 0], ["x", 1]]},
            {"kind": "RISER", "box": [10, 10, 30, 30]},
            {"kind": "LIGHT", "box": [0, 0, 10, 10]},
            {"kind": "METER_BOARD", "box": [0, 0, 5000, 10], "current_a": -5, "confidence": "SURE"},
        ]
    }
    sources = plan_ai.clean_sources(raw)
    assert [s["kind"] for s in sources] == ["TRANSFORMER", "FEEDER", "RISER", "METER_BOARD"]
    assert sources[0]["kva"] == 630
    assert sources[1]["path"] == [[0, 0], [500, 0]]
    assert sources[2]["point"] == [20, 20]
    board = sources[3]
    assert board["box"] == [0, 0, 1000, 10]  # clamped to the image
    assert board["current_a"] is None and board["confidence"] == "LOW"


def test_scale_is_read_only_from_a_usual_drawing_scale():
    assert plan_ai.scale_denominator("1:50") == 50
    assert plan_ai.scale_denominator(None, "קנ\"מ 1 : 100") == 100
    assert plan_ai.scale_denominator("1:37", "ת.ז 11:500") is None


# ── Tiles ───────────────────────────────────────────────────────────────


def test_tile_cores_cover_the_page_exactly_once():
    tiles = plan_ai.tile_grid(8000, 3600)
    assert len(tiles) == 8
    area = sum((t["core"][2] - t["core"][0]) * (t["core"][3] - t["core"][1]) for t in tiles)
    assert area == 8000 * 3600
    for tile in tiles:
        x0, y0, x1, y1 = tile["crop"]
        c0, d0, c1, d1 = tile["core"]
        assert x0 <= c0 and y0 <= d0 and x1 >= c1 and y1 >= d1


def test_a_feeder_seen_by_two_tiles_is_counted_once():
    tiles = plan_ai.tile_grid(4400, 2200)  # two tiles side by side, overlapping in the middle
    left, right = tiles
    page_path = [[1000.0, 1000.0], [3500.0, 1000.0]]

    def as_tile(tile):
        x0, y0, x1, y1 = tile["crop"]
        return [[(x - x0) / (x1 - x0) * 1000, (y - y0) / (y1 - y0) * 1000] for x, y in page_path]

    pieces = []
    for tile in (left, right):
        detected = [{"kind": "FEEDER", "label": "", "path": as_tile(tile), "confidence": "HIGH"}]
        pieces += plan_ai.sources_in_core(detected, tile)
    total = sum(math.dist(p["path"][0], p["path"][-1]) for p in pieces)
    assert total == pytest.approx(2500, abs=2)


def test_equipment_on_a_tile_edge_belongs_to_one_tile():
    tiles = plan_ai.tile_grid(4400, 2200)
    kept = []
    for tile in tiles:
        x0, y0, x1, y1 = tile["crop"]
        box = [(2150 - x0) / (x1 - x0) * 1000, 400 / (y1 - y0) * 1000, (2250 - x0) / (x1 - x0) * 1000, 500 / (y1 - y0) * 1000]
        kept += plan_ai.sources_in_core([{"kind": "TRANSFORMER", "label": "", "box": box, "confidence": "HIGH"}], tile)
    assert len(kept) == 1


# ── Scales, risers, alignment ───────────────────────────────────────────


class _Row:
    def __init__(self, key, result):
        self.document_id, page = key.split(":")
        self.page = int(page)
        self.result = result
        self.created_at = 0


def _result(level, width_px, denominator, kind="ELECTRICAL", name=None):
    return {
        "sheet_kind": kind,
        "floors": [{"name": name or f"קומה {level}", "level": level}],
        "scale_denominator": denominator,
        "building_box": [0, 0, width_px, width_px / 2],
        "render_scale": 150 / 72,
        "image_px": [width_px, width_px / 2],
        "sources": [],
    }


def test_a_scale_that_disagrees_with_the_other_floors_is_inferred_again():
    settings = auto_build.settings_of(type("P", (), {"auto_settings": None})())
    # At 1:50, 2000 px at 150 dpi is about 17 m. Floor 3 claims 1:100, which would make it twice the size.
    rows = [_Row(f"d{level}:0", _result(level, 2000, 50 if level != 3 else 100)) for level in range(4)]
    rows.append(_Row("d9:0", _result(4, 2000, None)))
    scales = auto_build.resolve_scales(auto_build.plan_choices(rows, settings), settings)
    assert scales[0] == {"denominator": 50, "basis": "READ"}
    assert scales[3] == {"denominator": 50, "basis": "INFERRED"}
    assert scales[4] == {"denominator": 50, "basis": "INFERRED"}

    settings["pages"]["d3:0"] = {"scale_denominator": 100}
    assert auto_build.resolve_scales(auto_build.plan_choices(rows, settings), settings)[3]["basis"] == "USER"


def test_a_technical_roof_sits_above_the_top_floor():
    settings = auto_build.settings_of(type("P", (), {"auto_settings": None})())
    rows = [_Row("a:0", _result(5, 2000, 50)), _Row("b:0", _result(7, 2000, 50, name="קומת גג טכני"))]
    assert sorted(auto_build.plan_choices(rows, settings)) == [5, 6]


def test_callouts_on_one_shaft_are_one_riser():
    sources = [
        {"kind": "RISER", "label": "פיר", "point": [100, 100]},
        {"kind": "RISER", "label": "", "point": [130, 100]},  # 30 px at 0.02 m/px = 0.6 m
        {"kind": "RISER", "label": "", "point": [600, 100]},
    ]
    merged = auto_build.merge_risers(sources, 0.02)
    assert [s["index"] for s in merged] == [0, 2]


def _two_buildings(offset=(0, 0)):
    """Two identical buildings side by side, the case that fools a plain correlation."""
    image = np.zeros((400, 700), np.float32)
    rng = np.random.default_rng(1)
    building = (rng.random((200, 220)) > 0.93).astype(np.float32)
    building[0, :] = building[-1, :] = building[:, 0] = building[:, -1] = 1
    for left in (60, 380):
        y, x = 100 + offset[1], left + offset[0]
        image[y : y + 200, x : x + 220] = np.maximum(image[y : y + 200, x : x + 220], building)
    image[5, :] = image[-5, :] = 1  # a sheet frame
    return image


def test_alignment_finds_the_shift_between_two_floors():
    dx, dy, score = auto_build.phase_shift(_two_buildings(), _two_buildings(offset=(-23, 17)))
    assert (dx, dy) == (23, -17)
    assert score > auto_build.ALIGN_MIN_SCORE


# ── Through the API ─────────────────────────────────────────────────────


def _sheet_pdf() -> bytes:
    """The same building outline on every page, so the floors can be aligned."""
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=landscape(A3))
    for _ in range(2):
        pdf.setLineWidth(3)
        pdf.rect(200, 150, 600, 400)
        pdf.rect(300, 250, 120, 90)
        pdf.rect(600, 380, 150, 100)
        pdf.line(420, 300, 600, 420)
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _fake_reading(document, page):
    width, height = 2480, 1754  # A3 landscape at 150 dpi
    box = [200 / 1190.55 * width, (1 - 550 / 841.89) * height, 800 / 1190.55 * width, (1 - 150 / 841.89) * height]
    common = {
        "sheet_kind": "ELECTRICAL",
        "scale_text": "1:100",
        "scale_denominator": 100,
        "building_box": box,
        "page_size_pt": [1190.55, 841.89],
        "render_scale": 150 / 72,
        "image_px": [width, height],
        "notes": "",
        "tiles": 2,
        "model": "fake",
    }
    if page == 0:
        return {
            **common,
            "floors": [{"name": "מרתף 1-", "level": -1}],
            "floor_use": "PARKING",
            "sources": [
                {"kind": "TRANSFORMER", "label": "חדר שנאים", "box": [box[0] + 200, box[1] + 300, box[0] + 400, box[1] + 450], "kva": 630, "current_a": None, "rating_text": "630KVA", "confidence": "HIGH"},
                {"kind": "FEEDER", "label": "קו הזנה ראשי", "path": [[box[0] + 400, box[1] + 380], [box[0] + 900, box[1] + 380]], "kva": None, "current_a": None, "rating_text": None, "confidence": "LOW"},
            ],
        }
    return {**common, "floors": [{"name": "קומת קרקע", "level": 0}], "floor_use": "RESIDENTIAL", "sources": []}


def test_automatic_flow_from_plans_to_report(admin, monkeypatch):  # noqa: F811
    monkeypatch.setattr(plan_ai, "analyze_page", _fake_reading)
    project_id = make_project(admin)
    base = f"/api/projects/{project_id}"
    document = api(admin, "POST", f"{base}/documents", 201, files={"file": ("plans.pdf", _sheet_pdf(), "application/pdf")}, data={"document_type": "ELECTRICAL"})

    for page in (0, 1):
        api(admin, "POST", f"{base}/auto/analyze", json={"document_id": document["id"], "page": page})

    state = api(admin, "GET", f"{base}/auto")
    assert [f["level"] for f in state["floors"]] == [-1, 0]
    assert state["floors"][0]["building_size_m"] == [pytest.approx(21.2, abs=0.1), pytest.approx(14.1, abs=0.1)]
    missing = {m["field"] for m in state["missing"]}
    assert missing == {"floor_height_m", "basement_height_m", "typical_load_pct", "kinds.FEEDER.max_current_a"}
    api(admin, "POST", f"{base}/auto/build", 409)

    api(admin, "PUT", f"{base}/auto/settings", 422, json={"kinds": {"LIGHT": {"max_current_a": 5}}})
    state = api(
        admin,
        "PUT",
        f"{base}/auto/settings",
        json={"floor_height_m": 3.2, "basement_height_m": 3.5, "typical_load_pct": 60, "kinds": {"FEEDER": {"max_current_a": 600}}},
    )
    assert state["missing"] == []

    built = api(admin, "POST", f"{base}/auto/build")
    assert (built["floors"], built["sources"], built["zones"]) == (2, 2, 2)
    floors = {f["name"]: f for f in api(admin, "GET", f"{base}/floors")}
    assert floors["מרתף 1-"]["elevation_m"] == -3.5 and floors["קומת קרקע"]["elevation_m"] == 0
    assert floors["מרתף 1-"]["origin_px"] == pytest.approx(floors["קומת קרקע"]["origin_px"], abs=1)

    sources = {s["tag"]: s for s in api(admin, "GET", f"{base}/sources")}
    transformer = sources["T1"]
    assert transformer["current_a"] == pytest.approx(round(630_000 / (math.sqrt(3) * 400)) * 0.6, abs=0.1)
    assert transformer["detection_method"] == "AUTO" and transformer["missing"] == []
    assert sources["F1"]["height_above_floor_m"] == pytest.approx(3.2)  # 3.5 m basement, 0.3 m below the ceiling
    assert sources["F1"]["user_verified"] is False  # LOW confidence waits for the engineer

    assumptions = [a["statement"] for a in api(admin, "GET", f"{base}/assumptions")]
    assert any("60%" in a for a in assumptions) and any("שנאי" in a for a in assumptions)

    # A zone drawn by hand replaces the whole-floor zone on that floor, and survives a rebuild.
    ground = floors["קומת קרקע"]["id"]
    api(admin, "POST", f"{base}/rooms", 201, json={"floor_id": ground, "name": "עמדת ישיבה", "polygon_m": [[2, -2], [5, -2], [5, -5], [2, -5]]})
    rebuilt = api(admin, "POST", f"{base}/auto/build")
    assert rebuilt["zones"] == 1
    rooms = api(admin, "GET", f"{base}/rooms")
    assert sorted(r["name"] for r in rooms) == ["מרתף 1- (כל הקומה)", "עמדת ישיבה"]

    finished = api(admin, "POST", f"{base}/auto/finish")
    assert finished["report"]["version"] == 1
    assert all(s["user_verified"] for s in api(admin, "GET", f"{base}/sources"))
    assert api(admin, "GET", f"{base}")["model_verified"] is True


def test_reading_without_a_key_says_so(admin, monkeypatch):  # noqa: F811
    from app.config import settings

    monkeypatch.setattr(settings, "openai_api_key", None)
    project_id = make_project(admin)
    base = f"/api/projects/{project_id}"
    document = api(admin, "POST", f"{base}/documents", 201, files={"file": ("plans.pdf", _sheet_pdf(), "application/pdf")}, data={"document_type": "ELECTRICAL"})
    response = admin.post(f"{base}/auto/analyze", json={"document_id": document["id"], "page": 0})
    assert response.status_code == 502 and "OPENAI_API_KEY" in response.json()["detail"]
    assert api(admin, "GET", f"{base}/auto")["ai_available"] is False
