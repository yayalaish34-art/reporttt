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


def test_current_comes_from_the_source_then_the_sheet_then_the_kind():
    settings = auto_build.settings_of(type("P", (), {"auto_settings": {"kinds": {"TRANSFORMER": {"kva": 630}}}})())
    unread = {"kind": "TRANSFORMER", "kva": None, "current_a": None}
    assert auto_build.max_current_for(unread, {}, settings) == round(630_000 / (math.sqrt(3) * 400))
    assert auto_build.max_current_for({**unread, "kva": 1000}, {}, settings) == round(1_000_000 / (math.sqrt(3) * 400))
    assert auto_build.max_current_for(unread, {"max_current_a": 800}, settings) == 800
    assert auto_build.max_current_for({"kind": "FEEDER", "kva": None, "current_a": None}, {}, settings) is None


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
    # Nothing is asked: heights, currents and the load come from the plans or stated defaults.
    assert state["missing"] == []
    api(admin, "PUT", f"{base}/auto/settings", 422, json={"kinds": {"LIGHT": {"max_current_a": 5}}})

    built = api(admin, "POST", f"{base}/auto/build")
    # A zone per floor, and the strip around the transformer as a technical area.
    assert (built["floors"], built["sources"], built["zones"]) == (2, 2, 3)
    around = [r for r in api(admin, "GET", f"{base}/rooms") if r["name"].startswith("סביבת ציוד חשמלי")]
    assert len(around) == 1 and around[0]["occupancy_classification"] == "NON_CONTINUOUS_OCCUPANCY"
    floors = {f["name"]: f for f in api(admin, "GET", f"{base}/floors")}
    assert floors["מרתף 1-"]["elevation_m"] == -3.5 and floors["קומת קרקע"]["elevation_m"] == 0
    assert floors["מרתף 1-"]["origin_px"] == pytest.approx(floors["קומת קרקע"]["origin_px"], abs=1)

    sources = {s["tag"]: s for s in api(admin, "GET", f"{base}/sources")}
    transformer_a = round(630_000 / (math.sqrt(3) * 400))
    transformer = sources["ש1"]
    assert transformer["current_a"] == pytest.approx(transformer_a * 0.6, abs=0.1)
    assert transformer["detection_method"] == "AUTO" and transformer["missing"] == []
    feeder = sources["ק1"]
    assert feeder["current_a"] == pytest.approx(transformer_a * 0.6, abs=0.1)  # fed by the transformer
    assert feeder["height_above_floor_m"] == pytest.approx(3.2)  # 3.5 m basement, 0.3 m below the ceiling
    assert feeder["user_verified"] is False  # LOW confidence until the report is issued

    assumptions = [a["statement"] for a in api(admin, "GET", f"{base}/assumptions")]
    assert any("60%" in a for a in assumptions) and any("שנאי" in a for a in assumptions)

    # A zone drawn by hand replaces the whole-floor zone on that floor, and survives a rebuild.
    ground = floors["קומת קרקע"]["id"]
    api(admin, "POST", f"{base}/rooms", 201, json={"floor_id": ground, "name": "עמדת ישיבה", "polygon_m": [[2, -2], [5, -2], [5, -5], [2, -5]]})
    rebuilt = api(admin, "POST", f"{base}/auto/build")
    assert rebuilt["zones"] == 2
    rooms = api(admin, "GET", f"{base}/rooms")
    assert sorted(r["name"] for r in rooms) == ["סביבת ציוד חשמלי ש1", "עמדת ישיבה", "שאר שטח הקומה"]

    finished = api(admin, "POST", f"{base}/auto/finish")
    assert finished["report"]["version"] == 1
    # The guideline is in force and every zone has its hours, so each one is judged.
    results = api(admin, "GET", f"{base}/runs/{finished['run']['id']}")["results"]
    automatic = [r for r in results if r["room_name"] != "עמדת ישיבה"]
    assert automatic and all(r["status"] in ("PASS", "FAIL") for r in automatic)
    assert {r["room_name"]: r["occupancy_hours"] for r in automatic}["סביבת ציוד חשמלי ש1"] == 0
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


# ── What the system decides on its own ──────────────────────────────────


def test_feeders_above_the_ground_floor_are_left_out_unless_answered():
    assert auto_build.is_included("FEEDER", [-1], {})
    assert auto_build.is_included("FEEDER", [0], {})
    assert not auto_build.is_included("FEEDER", [3, 4], {})
    assert auto_build.is_included("FEEDER", [3], {"include": True})
    assert auto_build.is_included("RISER", [5], {})
    assert not auto_build.is_included("RISER", [5], {"include": False})


def test_the_shaft_current_falls_floor_by_floor():
    top = 9
    assert auto_build.riser_share(-1, top) == 1.0
    assert auto_build.riser_share(0, top) == 1.0
    assert auto_build.riser_share(1, top) == 1.0
    assert auto_build.riser_share(5, top) == pytest.approx(5 / 9)
    assert auto_build.riser_share(9, top) == pytest.approx(1 / 9)
    assert auto_build.riser_share(10, top) == pytest.approx(1 / 9)  # the technical roof


def _tower_pdf(pages: int) -> bytes:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=landscape(A3))
    for _ in range(pages):
        pdf.setLineWidth(3)
        pdf.rect(200, 150, 600, 400)
        pdf.rect(300, 250, 120, 90)
        pdf.rect(600, 380, 150, 100)
        pdf.line(420, 300, 600, 420)
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _tower_reading(document, page):
    reading = _fake_reading(document, 1)
    box = reading["building_box"]
    level = page + 1  # floors 1 to 4
    sources = []
    if level in (1, 3):
        sources.append({"kind": "RISER", "label": "פיר חשמל", "point": [box[0] + 300, box[1] + 200], "kva": None, "current_a": None, "rating_text": None, "confidence": "MEDIUM"})
    if level == 2:
        sources.append({"kind": "FEEDER", "label": "מוביל הזנה לדירות", "path": [[box[0] + 100, box[1] + 100], [box[0] + 600, box[1] + 100]], "kva": None, "current_a": None, "rating_text": None, "confidence": "LOW"})
    return {**reading, "floors": [{"name": f"קומה {level}", "level": level}], "sources": sources}


def test_a_shaft_runs_through_floors_where_it_was_not_read(admin, monkeypatch):  # noqa: F811
    monkeypatch.setattr(plan_ai, "analyze_page", _tower_reading)
    project_id = make_project(admin)
    base = f"/api/projects/{project_id}"
    document = api(admin, "POST", f"{base}/documents", 201, files={"file": ("tower.pdf", _tower_pdf(4), "application/pdf")}, data={"document_type": "ELECTRICAL"})
    for page in range(4):
        api(admin, "POST", f"{base}/auto/analyze", json={"document_id": document["id"], "page": page})

    state = api(
        admin,
        "PUT",
        f"{base}/auto/settings",
        json={"floor_height_m": 3, "basement_height_m": 3.5, "typical_load_pct": 50, "kinds": {"RISER": {"max_current_a": 800}}},
    )
    # The upper-floor feeder is left out, so no current is asked for it.
    assert state["missing"] == []
    assert [d["included"] for d in state["detected"] if d["kind"] == "FEEDER"] == [False]

    api(admin, "POST", f"{base}/auto/build")
    floors = {f["id"]: f["name"] for f in api(admin, "GET", f"{base}/floors")}
    risers = {floors[s["floor_id"]]: s for s in api(admin, "GET", f"{base}/sources") if s["source_type"] == "RISER"}
    assert sorted(risers) == ["קומה 1", "קומה 2", "קומה 3"]  # floor 2 filled in, floor 4 is above the last one seen
    assert risers["קומה 2"]["geometry"]["points"][0] == pytest.approx(risers["קומה 1"]["geometry"]["points"][0], abs=0.05)
    # 800 A at full share, half of it at a typical load; floor 2 of 4 carries 3/4, floor 3 carries 2/4.
    assert risers["קומה 1"]["current_a"] == pytest.approx(400)
    assert risers["קומה 1"]["tag"].startswith("פ")
    assert risers["קומה 2"]["current_a"] == pytest.approx(300)
    assert risers["קומה 3"]["current_a"] == pytest.approx(200)
    assert not any(s["source_type"] == "THREE_PHASE_CABLE" for s in api(admin, "GET", f"{base}/sources"))


# ── Levels, rooms and currents from the plans ───────────────────────────


def _levels(read: dict[int, float | None]):
    settings = auto_build.settings_of(type("P", (), {"auto_settings": None})())
    rows = []
    for level, elevation in read.items():
        result = _result(level, 2000, 50)
        result["floors"][0]["elevation_m"] = elevation
        rows.append(_Row(f"d{level + 10}:0", result))
    return auto_build.resolve_elevations(auto_build.plan_choices(rows, settings), settings)


def test_floor_levels_are_read_and_the_rest_follow_the_typical_height():
    levels = _levels({-1: -4.0, 0: 0.0, 1: 3.55, 2: None, 3: 9.79, 4: None})
    # Floor 2 sits between two read levels: halfway, and floor 1's height follows from it.
    assert levels[2]["basis"] == "DERIVED" and levels[2]["elevation_m"] == pytest.approx(6.67, abs=0.01)
    assert levels[1] == {"elevation_m": 3.55, "basis": "READ", "height_m": pytest.approx(3.12, abs=0.01)}
    assert levels[-1]["height_m"] == pytest.approx(4.0)
    assert levels[4]["elevation_m"] == pytest.approx(9.79 + levels[3]["height_m"], abs=0.01)
    # Nothing written at all: the library's default heights.
    fallback = _levels({-1: None, 0: None, 2: None})
    assert fallback[-1]["elevation_m"] == -3.5 and fallback[2]["elevation_m"] == pytest.approx(6.4)


def test_rooms_follow_the_walls_and_stop_at_doorways(tmp_path):
    from PIL import Image, ImageDraw
    from app.services import rooms

    # 1:50 at 150 dpi: about 0.0085 m a pixel. Two rooms with a doorway between, and a corridor.
    m_per_px = 0.0254 / 150 * 50
    px = lambda metres: round(metres / m_per_px)
    image = Image.new("L", (px(14), px(9)), 255)
    draw = ImageDraw.Draw(image)
    wall = px(0.2)
    for x0, y0, x1, y1 in [(1, 1, 13, 1), (1, 8, 13, 8), (1, 1, 1, 8), (13, 1, 13, 8), (7, 1, 7, 5.5), (1, 5.5, 13, 5.5)]:
        draw.rectangle([px(x0), px(y0), px(x1) + wall, px(y1) + wall], fill=0)
    draw.rectangle([px(6.9), px(3), px(7.3), px(3.9)], fill=255)  # a 0.9 m doorway between the rooms
    draw.rectangle([px(3), px(5.4), px(3.9), px(5.8)], fill=255)  # and one into the corridor
    path = tmp_path / "plan.png"
    image.save(path)

    zones = [
        {"kind": "APARTMENT_ROOM", "label": "סלון", "unit": "1", "point": [px(4), px(3)]},
        {"kind": "APARTMENT_ROOM", "label": "חדר שינה", "unit": "1", "point": [px(10), px(3)]},
        {"kind": "CORRIDOR", "label": "מסדרון", "unit": None, "point": [px(7), px(6.8)]},
    ]
    found = rooms.segment(path, [px(1), px(1), px(13.2), px(8.2)], m_per_px, zones)
    areas = {room["label"]: room["area_m2"] for room in found["rooms"]}
    assert areas["סלון"] == pytest.approx(5.8 * 4.3, rel=0.15)
    assert areas["חדר שינה"] == pytest.approx(5.8 * 4.3, rel=0.15)
    assert areas["מסדרון"] == pytest.approx(11.8 * 2.3, rel=0.15)
    assert found["footprint_px"]


def test_the_shaft_carries_the_flats_above_it():
    plans = {
        level: {"result": {"zones": [{"kind": "APARTMENT_ROOM", "unit": str(n), "label": ""} for n in range(4)]}, "use": "RESIDENTIAL"}
        for level in range(1, 6)
    }
    plans[0] = {"result": {"zones": []}, "use": "MIXED"}
    settings = auto_build.settings_of(type("P", (), {"auto_settings": None})())
    currents = auto_build.Currents(settings, plans, {})
    assert currents.riser(1, 1)[0] == 20 * 25  # 4 flats on each of 5 floors, 25 A each
    assert currents.riser(4, 2)[0] == 2 * 4 * 25 / 2  # two shafts share floors 4 and 5
    assert currents.riser(0, 1)[0] == 20 * 25
