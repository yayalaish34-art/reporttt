from fastapi import FastAPI
from sqlalchemy import text

from elf_engine import ENGINE_VERSION

from .config import settings
from .db import SessionLocal
from .routers import auth, calculation, documents, model, projects, regulation, reports, validation

settings.assert_safe_for_deployment()

app = FastAPI(title="Galit ELF Prediction System", version=ENGINE_VERSION)

for module in (auth, projects, documents, model, calculation, regulation, reports, validation):
    app.include_router(module.router, prefix="/api")
app.include_router(projects.meta_router, prefix="/api")


@app.get("/api/health")
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "storage": "blob" if settings.uses_blob_storage else "local",
    }
