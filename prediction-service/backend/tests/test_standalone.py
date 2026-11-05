"""The pieces that make the engine a system of its own: CRM rows, the Job Number call, the screens."""

import json
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

from app.config import settings
from app.models import Project, User
from app.routers.crm import _customer
from app.services.job_numbers import ensure_job_number


def _row(**overrides):
    row = {
        "id": "c1",
        "name": "קופמן יזמות",
        "contactName": "שלמה קופמן",
        "type": "COMPANY",
        "address": "גד מכנס 5",
        "city": "פתח תקווה",
        "phone": "054-0000000",
        "email": "office@example.com",
        "updatedAt": datetime(2026, 11, 1),
    }
    return {**row, **overrides}


def test_a_crm_company_keeps_both_names():
    customer = _customer(_row())
    assert customer["kind"] == "company"
    assert (customer["contactName"], customer["companyName"]) == ("שלמה קופמן", "קופמן יזמות")
    assert customer["addressLine"] == "גד מכנס 5"


def test_a_sole_trader_and_a_placeholder_address_read_as_a_person():
    customer = _customer(_row(contactName="קופמן יזמות", address="פתח תקווה", email="x@legacy.import.local"))
    assert customer["kind"] == "private"
    assert (customer["contactName"], customer["companyName"]) == ("קופמן יזמות", "")
    assert customer["addressLine"] == "" and customer["email"] == ""


def test_the_job_number_comes_from_the_reports_register(monkeypatch):
    seen = {}

    class Register(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["auth"] = self.headers["Authorization"]
            seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            payload = json.dumps({"jobNumber": 901}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Register)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    project = Project(id="p1", client_name="קופמן", project_number="")
    user = User(email="a@example.com", full_name="גלית")
    try:
        assert ensure_job_number(project, user) is None  # not configured: no number, no failure
        monkeypatch.setattr(settings, "reports_url", f"http://127.0.0.1:{server.server_port}")
        monkeypatch.setattr(settings, "job_numbers_token", "secret")
        monkeypatch.setattr(settings, "public_url", "https://elf.example")
        assert ensure_job_number(project, user) == "901"
        assert seen["auth"] == "Bearer secret"
        assert seen["body"]["kind"] == "prediction" and seen["body"]["link"] == "https://elf.example/project/?id=p1"
        monkeypatch.setattr(settings, "reports_url", "http://127.0.0.1:9")  # nothing listens
        assert ensure_job_number(project, user) is None
    finally:
        server.shutdown()
