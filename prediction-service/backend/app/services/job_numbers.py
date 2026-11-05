"""The project's number in the company-wide Job Number register.

The register is kept by the reports system, so every department draws from one sequence.
A number is asked for when a report is first issued and kept after. A register that does
not answer never stops a report: the project simply has no number yet, and gets one the
next time a report is issued.
"""

import json
import logging
import urllib.error
import urllib.request

from ..config import settings
from ..models import Project, User

log = logging.getLogger(__name__)


def ensure_job_number(project: Project, user: User) -> str | None:
    if not (settings.reports_url and settings.job_numbers_token):
        return None
    body = {
        "kind": "prediction",
        "reportId": project.id,
        "customerName": project.client_name,
        "inspectorName": user.full_name or user.email,
        "preferred": project.project_number or "",
        "link": f"{settings.public_url.rstrip('/')}/project/?id={project.id}" if settings.public_url else "",
    }
    request = urllib.request.Request(
        settings.reports_url.rstrip("/") + "/api/job-numbers",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {settings.job_numbers_token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            number = str(json.load(response)["jobNumber"])
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as error:
        log.warning("Job Number register did not answer: %s", error)
        return None
    return number
