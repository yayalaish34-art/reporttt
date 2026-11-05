from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from elf_engine import ENGINE_VERSION

from .config import settings
from .db import SessionLocal
from .routers import auth, auto, calculation, crm, documents, model, projects, regulation, reports, scene, validation

settings.assert_safe_for_deployment()

app = FastAPI(title="Galit ELF Prediction System", version=ENGINE_VERSION)

for module in (auth, projects, documents, model, calculation, regulation, reports, validation, auto, crm, scene):
    app.include_router(module.router, prefix="/api")
app.include_router(projects.meta_router, prefix="/api")
app.include_router(regulation.document_router, prefix="/api")


@app.get("/api/health")
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "storage": "blob" if settings.uses_blob_storage else "local",
    }


# The screens, built to plain files, served last so every /api route above wins.
if settings.web_dist and Path(settings.web_dist).is_dir():
    app.mount("/", StaticFiles(directory=settings.web_dist, html=True), name="web")
