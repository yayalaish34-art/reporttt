"""The MVP 1 acceptance path through the real API, against a throwaway database."""

import io
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


@pytest.fixture(scope="module")
def app_client():
    from app import models  # noqa: F401  (registers the tables on Base)
    from app.config import settings
    from app.db import Base, engine

    assert engine.url.database.endswith(("elf_test.db", "elf_test")), "tests must not run on a real database"
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    settings.elf_admin_email = "admin@example.com"
    settings.elf_admin_password = "admin-password-123"

    from app.bootstrap import bootstrap
    from app.main import app

    bootstrap()
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="module")
def admin(app_client):
    response = app_client.post("/api/auth/login", json={"email": "admin@example.com", "password": "admin-password-123"})
    assert response.status_code == 200
    return app_client


def plan_pdf() -> bytes:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.rect(50, 50, 400, 300)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def make_project(client) -> str:
    response = client.post(
        "/api/projects",
        json={
            "client_name": "לקוח",
            "project_name": "בניין בדיקה",
            "address": "רחוב 1",
            "building_type": "Office",
            "project_date": "2026-11-01",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def api(client, method, path, expect=200, **kwargs):
    response = client.request(method, path, **kwargs)
    assert response.status_code == expect, f"{method} {path}: {response.status_code} {response.text}"
    return response.json()


def build_model(client, project_id):
    """One office above a parking floor with a feeder in its ceiling."""
    document = api(
        client,
        "POST",
        f"/api/projects/{project_id}/documents",
        201,
        data={"document_type": "ARCHITECTURAL"},
        files={"file": ("plan.pdf", plan_pdf(), "application/pdf")},
    )
    base = f"/api/projects/{project_id}"
    office = api(client, "POST", f"{base}/floors", 201, json={"name": "1", "sort_order": 1, "plan_document_id": document["id"]})
    parking = api(client, "POST", f"{base}/floors", 201, json={"name": "P", "sort_order": 0, "plan_document_id": document["id"]})
    for floor in (office, parking):
        api(client, "POST", f"{base}/floors/{floor['id']}/calibrate", json={"p1": [100, 100], "p2": [300, 100], "distance_m": 10})
        api(client, "POST", f"{base}/floors/{floor['id']}/origin", json={"origin_px": [100, 500]})
    room = api(
        client,
        "POST",
        f"{base}/rooms",
        201,
        json={"floor_id": office["id"], "name": "משרד 101", "polygon_m": [[0, 0], [4, 0], [4, 3], [0, 3]]},
    )
    feeder = api(
        client,
        "POST",
        f"{base}/sources",
        201,
        json={"floor_id": parking["id"], "tag": "Cable-01", "source_type": "THREE_PHASE_CABLE", "points": [[-5, 1.5], [10, 1.5]]},
    )
    return {"base": base, "office": office, "parking": parking, "room": room, "feeder": feeder, "document": document}


def complete_feeder(client, model, arrangement="FLAT_HORIZONTAL", spacing=0.1):
    base, feeder = model["base"], model["feeder"]
    answers = [
        ("floor", model["office"]["id"], "elevation_m", 3.0),
        ("floor", model["parking"]["id"], "elevation_m", 0.0),
        ("source", feeder["id"], "height_above_floor_m", 2.8),
        ("source", feeder["id"], "current_a", 400),
        ("source", feeder["id"], "current_basis", "DESIGN"),
        ("source", feeder["id"], "arrangement", arrangement),
        ("source", feeder["id"], "spacing_m", spacing),
    ]
    for target, target_id, field, value in answers:
        api(client, "POST", f"{base}/answers", json={"target_type": target, "target_id": target_id, "field": field, "value": value})


ACTIVE_RULE = {
    "authority": "fixture",
    "instrument_type": "GUIDELINE",
    "document_name": "Fixture document",
    "document_version": "1",
    "effective_date": "2020-01-01",
    "source_url": "https://example.com/doc",
    "occupancy_type": "CONTINUOUS_OCCUPANCY",
    "building_types": ["Office"],
    "threshold": 5.0,
    "threshold_type": "INSTANTANEOUS_MAX",
}


def test_requires_login(app_client):
    app_client.cookies.clear()
    assert app_client.get("/api/projects").status_code == 401


def test_candidate_rules_load_inactive_and_cannot_activate_without_a_source(admin):
    rules = api(admin, "GET", "/api/regulation/rules")
    assert len(rules) == 4
    assert all(rule["active"] is False and rule["verified_at"] is None for rule in rules)
    response = admin.post(f"/api/regulation/rules/{rules[0]['id']}/activation", json={"active": True, "reason": "x"})
    assert response.status_code == 409
    assert "source_url" in response.json()["detail"]["missing"]


def test_questions_are_dynamic(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    questions = api(admin, "GET", f"{model['base']}/questions")
    fields = {q["field"] for q in questions}
    assert {"elevation_m", "current_a", "current_basis", "arrangement", "spacing_m", "height_above_floor_m"} <= fields
    assert "occupancy_classification" in fields
    # No transformer and no busbar in this project: nothing asked about them.
    assert not fields & {"reference_curve", "box_height_m", "bar_width_m", "decay_exponent"}

    api(
        admin,
        "POST",
        f"{model['base']}/answers",
        json={"target_type": "source", "target_id": model["feeder"]["id"], "field": "current_a", "value": 400},
    )
    assert "current_a" not in {q["field"] for q in api(admin, "GET", f"{model['base']}/questions")}

    api(
        admin,
        "POST",
        f"{model['base']}/sources",
        201,
        json={"floor_id": model["parking"]["id"], "tag": "TR-01", "source_type": "TRANSFORMER", "points": [[0, 0], [2, 2]]},
    )
    fields = {q["field"] for q in api(admin, "GET", f"{model['base']}/questions")}
    assert {"reference_curve", "box_height_m", "reference_source"} <= fields


def test_room_gets_a_suggestion_not_a_decision(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    assert model["room"]["suggested_occupancy"] == "CONTINUOUS_OCCUPANCY"
    assert model["room"]["occupancy_classification"] == "UNKNOWN"
    assert model["room"]["occupancy_confirmed"] is False
    assert model["room"]["hours_per_day"] is None


def test_full_flow_from_empty_project_to_issued_report(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    base, feeder = model["base"], model["feeder"]

    readiness = api(admin, "GET", f"{base}/readiness")
    assert readiness["ready"] is False
    codes = {b["code"] for b in readiness["blockers"]}
    assert {"FLOOR_ELEVATION", "SOURCE_CURRENT_A", "ROOM_OCCUPANCY", "MODEL_NOT_VERIFIED"} <= codes

    # No current: the calculation refuses rather than guess.
    scenario = api(admin, "POST", f"{base}/scenarios", 201, json={"name": "Normal", "uncertainty_pct": 20})
    run_body = {"scenario_id": scenario["id"], "grid_step_m": 0.5, "heights_m": [1.0]}
    assert admin.post(f"{base}/runs", json=run_body).status_code == 422

    complete_feeder(admin, model)
    api(
        admin,
        "POST",
        f"{base}/answers",
        json={"target_type": "room", "target_id": model["room"]["id"], "field": "occupancy_classification", "value": "CONTINUOUS_OCCUPANCY"},
    )
    api(admin, "POST", f"{base}/verify-model", json={"verified": True})

    # Everything is known except a rule. Results exist, but no status may be claimed.
    run = api(admin, "POST", f"{base}/runs", 201, json=run_body)
    assert run["is_final"] is False
    assert any(b["code"] == "REGULATION_RULE" for b in run["blockers"])
    result = api(admin, "GET", f"{base}/runs/{run['id']}")["results"][0]
    assert result["status"] == "REGULATION_REVIEW_REQUIRED"
    assert result["max_mg"] > 0
    assert result["dominant_source_tag"] == "Cable-01"

    # Cable at z=2.8; the floor above calculates at z=3+1=4, so the source is below the room.
    assert result["max_point"][2] == pytest.approx(4.0)
    assert result["dominant_distance_m"] == pytest.approx(1.2, abs=0.3)
    assert result["sensitivity"]["worst_case_mg"] == pytest.approx(1.2 * result["sensitivity"]["expected_mg"])
    assert result["sensitivity"]["lower_mg"] == pytest.approx(0.8 * result["sensitivity"]["expected_mg"])

    draft = api(admin, "POST", f"{base}/reports", 201, json={"run_id": run["id"]})
    assert draft["is_final"] is False and draft["status"] == "DRAFT"
    assert admin.get(f"{base}/reports/{draft['id']}/file").content[:5] == b"%PDF-"
    api(admin, "POST", f"{base}/reports/{draft['id']}/transition", json={"status": "UNDER_REVIEW"})
    refused = admin.post(f"{base}/reports/{draft['id']}/transition", json={"status": "APPROVED"})
    assert refused.status_code == 409
    assert "Cannot issue final prediction report" in refused.json()["detail"]["message"]
    assert any("אין כלל" in item for item in refused.json()["detail"]["missing"])

    # A rule enters through its full source details.
    rule = api(admin, "POST", "/api/regulation/rules", 201, json=ACTIVE_RULE)
    api(admin, "POST", f"/api/regulation/rules/{rule['id']}/activation", json={"active": True, "reason": "checked against source"})
    try:
        final_run = api(admin, "POST", f"{base}/runs", 201, json=run_body)
        assert final_run["is_final"] is True, final_run["blockers"]
        final = api(admin, "GET", f"{base}/runs/{final_run['id']}")["results"][0]
        assert final["status"] == ("FAIL" if final["max_mg"] > 5.0 else "PASS")
        assert final["rule_checks"][0]["rule_id"] == rule["id"]

        trace = api(admin, "GET", f"{base}/results/{final['id']}/trace")
        assert trace["engine_version"] and trace["input_hash"]
        assert trace["sources"][0]["current_basis"] == "DESIGN"
        assert "Biot" in trace["sources"][0]["formula"]
        assert trace["regulation_checks"][0]["document_name"] == "Fixture document"

        # An engineer cannot sign off.
        report = api(admin, "POST", f"{base}/reports", 201, json={"run_id": final_run["id"]})
        assert report["is_final"] is True
        api(admin, "POST", "/api/auth/users", 201, json={"email": "eng@example.com", "password": "engineer-password", "role": "ENGINEER"})
        api(admin, "POST", f"{base}/reports/{report['id']}/transition", json={"status": "UNDER_REVIEW"})
        cookies = dict(admin.cookies)
        admin.cookies.clear()
        api(admin, "POST", "/api/auth/login", json={"email": "eng@example.com", "password": "engineer-password"})
        assert admin.post(f"{base}/reports/{report['id']}/transition", json={"status": "APPROVED"}).status_code == 403
        assert admin.post(f"/api/regulation/rules/{rule['id']}/activation", json={"active": False, "reason": "x"}).status_code == 403
        admin.cookies.clear()
        admin.cookies.update(cookies)

        approved = api(admin, "POST", f"{base}/reports/{report['id']}/transition", json={"status": "APPROVED"})
        assert approved["status"] == "APPROVED" and approved["approved_by"]
        issued = api(admin, "POST", f"{base}/reports/{report['id']}/transition", json={"status": "ISSUED"})
        assert issued["status"] == "ISSUED"
        assert admin.post(f"{base}/reports/{report['id']}/transition", json={"status": "DRAFT"}).status_code == 409

        # Editing the model voids the verification and leaves a trail.
        api(
            admin,
            "POST",
            f"{base}/answers",
            json={"target_type": "source", "target_id": feeder["id"], "field": "current_a", "value": 500, "reason": "עדכון מתכנן"},
        )
        assert api(admin, "GET", f"/api/projects/{project_id}")["model_verified"] is False
        log = api(admin, "GET", f"{base}/audit")
        entry = next(row for row in log if row["field"] == "current_a" and float(row["new_value"]) == 500)
        assert float(entry["old_value"]) == 400
        assert entry["reason"] == "עדכון מתכנן" and entry["user_email"] == "admin@example.com"

        # A re-verified model makes the earlier run stale, so it can no longer be finalized.
        api(admin, "POST", f"{base}/verify-model", json={"verified": True})
        stale = api(admin, "POST", f"{base}/reports", 201, json={"run_id": final_run["id"]})
        assert stale["is_final"] is False
        assert any(b["code"] == "RUN_STALE" for b in stale["blockers"])
    finally:
        api(admin, "POST", f"/api/regulation/rules/{rule['id']}/activation", json={"active": False, "reason": "test cleanup"})


def test_mitigation_scenario_shows_before_and_after(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    base, feeder = model["base"], model["feeder"]
    complete_feeder(admin, model)

    normal = api(admin, "POST", f"{base}/scenarios", 201, json={"name": "Normal"})
    # A shielding factor with no stated source is refused.
    bad = admin.post(f"{base}/scenarios", json={"name": "x", "source_overrides": {feeder["id"]: {"attenuation_factor": 0.5}}})
    assert bad.status_code == 422
    mitigated = api(
        admin,
        "POST",
        f"{base}/scenarios",
        201,
        json={
            "name": "After shielding",
            "kind": "POST_MITIGATION",
            "source_overrides": {feeder["id"]: {"attenuation_factor": 0.25, "attenuation_source": "fixture measurement"}},
        },
    )
    body = {"grid_step_m": 1.0, "heights_m": [1.0]}
    before = api(admin, "POST", f"{base}/runs", 201, json={**body, "scenario_id": normal["id"]})
    after = api(admin, "POST", f"{base}/runs", 201, json={**body, "scenario_id": mitigated["id"]})
    rows = api(admin, "GET", f"{base}/runs/{before['id']}/compare/{after['id']}")
    assert rows[0]["reduction_pct"] == pytest.approx(75.0)
    report = api(admin, "POST", f"{base}/reports", 201, json={"run_id": before["id"], "comparison_run_id": after["id"]})
    assert admin.get(f"{base}/reports/{report['id']}/file").content[:5] == b"%PDF-"


def test_recalibration_keeps_drawn_geometry_on_the_plan(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    base = model["base"]
    # Doubling the scale: the same pixels are twice as many metres.
    api(admin, "POST", f"{base}/floors/{model['office']['id']}/calibrate", json={"p1": [100, 100], "p2": [300, 100], "distance_m": 20})
    room = next(r for r in api(admin, "GET", f"{base}/rooms") if r["id"] == model["room"]["id"])
    assert room["polygon_m"][1] == pytest.approx([8.0, 0.0])
    assert room["area_m2"] == pytest.approx(48.0)


def test_field_measurement_is_converted_and_compared(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    base = model["base"]
    complete_feeder(admin, model, "TREFOIL", 0.05)
    scenario = api(admin, "POST", f"{base}/scenarios", 201, json={"name": "Normal"})
    run = api(admin, "POST", f"{base}/runs", 201, json={"scenario_id": scenario["id"], "grid_step_m": 1, "heights_m": [1.0]})
    entry = api(
        admin,
        "POST",
        f"{base}/validation",
        201,
        json={"run_id": run["id"], "x": 2, "y": 1, "z": 4, "value": 0.5, "unit": "µT", "measured_at": date(2026, 1, 1).isoformat()},
    )
    assert entry["measurement"]["original_value"] == 0.5
    assert entry["measurement"]["original_unit"] == "µT"
    assert entry["measurement"]["measured_mg"] == 5.0
    predicted = entry["validation"]["predicted_mg"]
    assert entry["validation"]["absolute_error"] == pytest.approx(abs(predicted - 5.0))
    assert entry["validation"]["percentage_error"] == pytest.approx(abs(predicted - 5.0) / 5.0 * 100)


def test_upload_rules(admin):
    project_id = make_project(admin)
    base = f"/api/projects/{project_id}/documents"

    def upload(name, data, kind="ARCHITECTURAL"):
        return admin.post(base, data={"document_type": kind}, files={"file": (name, data)})

    assert upload("evil.exe", b"x").status_code == 422
    assert upload("bad.pdf", b"not a pdf").status_code == 422
    first = upload("../../plan.pdf", plan_pdf()).json()
    assert first["file_name"] == "plan.pdf" and first["revision"] == 1
    second = upload("plan.pdf", plan_pdf()).json()
    assert second["revision"] == 2
    statuses = {row["revision"]: row["status"] for row in admin.get(base).json()}
    assert statuses == {1: "SUPERSEDED", 2: "CURRENT"}
    assert admin.get(f"{base}/{second['id']}/pages/0.png").headers["content-type"] == "image/png"
    assert admin.get(f"{base}/{second['id']}/pages/9.png").status_code == 404

    buffer = io.BytesIO()
    Image.new("RGB", (100, 80), "white").save(buffer, "JPEG")
    image = upload("plan.jpg", buffer.getvalue()).json()
    assert admin.get(f"{base}/{image['id']}/pages/0.png").status_code == 200
    dxf = upload("plan.dxf", b"0\nEOF\n").json()
    assert dxf["viewable"] is False
    assert admin.get(f"{base}/{dxf['id']}/pages/0.png").status_code == 422


def test_direct_upload_is_registered_only_after_every_check(admin):
    """The deployed path: the browser puts the file in storage, then asks to record it."""
    from app import storage

    project_id = make_project(admin)
    other_project = make_project(admin)
    base = f"/api/projects/{project_id}/documents"

    def pathname(extension="pdf", project=project_id):
        return f"uploads/{project}/{uuid.uuid4()}.{extension}"

    def register(path, file_name="תוכנית קומה 1.pdf", document_type="ARCHITECTURAL"):
        return admin.post(f"{base}/register", json={"pathname": path, "file_name": file_name, "document_type": document_type})

    permit = api(admin, "POST", f"{base}/upload-permit", json={"pathname": pathname()})
    assert permit == {"content_type": "application/pdf", "max_bytes": 100 * 1024 * 1024}
    for bad in (
        "uploads/not-a-project/x.pdf",
        pathname("exe"),
        pathname(project=other_project),
        "../" + pathname(),
        pathname() + "/../../secrets.pdf",
    ):
        assert admin.post(f"{base}/upload-permit", json={"pathname": bad}).status_code == 422, bad

    # Nothing arrived in storage.
    assert register(pathname()).status_code == 422

    good = pathname()
    uploaded = plan_pdf()
    storage.save_as(good, uploaded)
    assert register(good, "plan.exe").status_code == 422
    assert register(good, document_type="NOT_A_TYPE").status_code == 422
    assert register(good, "photo.png").status_code == 422

    created = register(good)
    assert created.status_code == 201, created.text
    assert created.json()["file_name"] == "תוכנית קומה 1.pdf"
    assert created.json()["file_type"] == "pdf"
    assert register(good).status_code == 409

    # The file came from the browser, so it is opened before it is believed.
    corrupt = pathname()
    storage.save_as(corrupt, b"not a pdf")
    assert register(corrupt).status_code == 422
    assert storage.size(corrupt) is None

    corrupt_image = pathname("png")
    storage.save_as(corrupt_image, b"not an image")
    assert register(corrupt_image, "photo.png").status_code == 422

    # The name is sent in the header encoded, and survives on the way back.
    download = admin.get(f"{base}/{created.json()['id']}/file")
    assert download.content == uploaded
    assert "filename*=UTF-8''" in download.headers["content-disposition"]
    assert download.headers["x-content-type-options"] == "nosniff"
    page = admin.get(f"{base}/{created.json()['id']}/pages/0.png")
    assert page.content[:4] == b"\x89PNG"
    assert "private" in page.headers["cache-control"]


def test_grid_points_are_stored_and_served_per_floor_and_height(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    base = model["base"]
    complete_feeder(admin, model)
    scenario = api(admin, "POST", f"{base}/scenarios", 201, json={"name": "Normal"})
    run = api(admin, "POST", f"{base}/runs", 201, json={"scenario_id": scenario["id"], "grid_step_m": 1, "heights_m": [1.0, 1.5]})
    result = next(r for r in api(admin, "GET", f"{base}/runs/{run['id']}")["results"] if r["height_m"] == 1.0)

    grid = api(admin, "GET", f"{base}/runs/{run['id']}/points", params={"floor_id": model["office"]["id"], "height_m": 1.0})
    # A 4 x 3 m room on a 1 m grid.
    assert grid["step_m"] == 1
    assert len(grid["points"]) == 12
    assert max(point[2] for point in grid["points"]) == pytest.approx(result["max_mg"], abs=1e-5)
    empty = api(admin, "GET", f"{base}/runs/{run['id']}/points", params={"floor_id": model["parking"]["id"], "height_m": 1.0})
    assert empty["points"] == []


def test_replaced_report_file_is_removed_from_storage(admin):
    from app import models, storage
    from app.db import SessionLocal

    project_id = make_project(admin)
    model = build_model(admin, project_id)
    base = model["base"]
    complete_feeder(admin, model)
    scenario = api(admin, "POST", f"{base}/scenarios", 201, json={"name": "Normal"})
    run = api(admin, "POST", f"{base}/runs", 201, json={"scenario_id": scenario["id"], "grid_step_m": 1, "heights_m": [1.0]})
    report = api(admin, "POST", f"{base}/reports", 201, json={"run_id": run["id"]})

    def stored_key():
        with SessionLocal() as db:
            return db.get(models.ReportVersion, report["id"]).storage_key

    first_key = stored_key()
    api(admin, "POST", f"{base}/reports/{report['id']}/transition", json={"status": "UNDER_REVIEW"})
    assert stored_key() != first_key
    assert storage.size(first_key) is None
    assert admin.get(f"{base}/reports/{report['id']}/file").content[:5] == b"%PDF-"


def test_bootstrap_is_safe_to_repeat(admin):
    from sqlalchemy import func, select

    from app.bootstrap import bootstrap
    from app.db import SessionLocal
    from app.models import RegulationRule, User

    def counts():
        with SessionLocal() as db:
            return (
                db.scalar(select(func.count()).select_from(RegulationRule)),
                db.scalar(select(func.count()).select_from(User).where(User.role == "ADMIN")),
            )

    before = counts()
    bootstrap()
    assert counts() == before


def test_project_rows_cannot_be_reached_through_another_project(admin):
    one, two = make_project(admin), make_project(admin)
    model = build_model(admin, one)
    response = admin.patch(f"/api/projects/{two}/rooms/{model['room']['id']}", json={"name": "x"})
    assert response.status_code == 404


def test_numerical_transformer_model_is_refused(admin):
    project_id = make_project(admin)
    model = build_model(admin, project_id)
    source = api(
        admin,
        "POST",
        f"{model['base']}/sources",
        201,
        json={"floor_id": model["parking"]["id"], "tag": "TR-01", "source_type": "TRANSFORMER", "points": [[0, 0], [2, 2]]},
    )
    response = admin.patch(f"{model['base']}/sources/{source['id']}", json={"model_type": "TRANSFORMER_NUMERICAL"})
    assert response.status_code == 422


def test_project_keeps_the_crm_customer_and_a_type_change_voids_the_run(admin):
    created = api(
        admin,
        "POST",
        "/api/projects",
        201,
        json={
            "client_name": "חברה לדוגמה",
            "customer_id": "crm-123",
            "contact_phone": "050-0000000",
            "contact_email": "a@example.com",
            "project_name": "מבנה",
            "building_type": "Office",
        },
    )
    assert created["customer_id"] == "crm-123" and created["contact_phone"] == "050-0000000"
    assert admin.patch(f"/api/projects/{created['id']}", json={"building_type": "Castle"}).status_code == 422

    model = build_model(admin, created["id"])
    complete_feeder(admin, model)
    scenario = api(admin, "POST", f"{model['base']}/scenarios", 201, json={"name": "Normal"})
    run = api(admin, "POST", f"{model['base']}/runs", 201, json={"scenario_id": scenario["id"], "grid_step_m": 1, "heights_m": [1.0]})
    api(admin, "PATCH", f"/api/projects/{created['id']}", json={"building_type": "School"})
    report = api(admin, "POST", f"{model['base']}/reports", 201, json={"run_id": run["id"]})
    assert any("סוג המבנה" in b["message"] for b in report["blockers"])
