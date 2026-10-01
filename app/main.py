"""FastAPI-App: REST-API + statisches Frontend."""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import matching, pdf
from .config import settings
from .jobs import Job, JobStore
from .paperless import Paperless, PaperlessError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

STATIC = Path(__file__).parent / "static"

app = FastAPI(title="PDF Splitter")


@app.middleware("http")
async def no_cache_frontend(request, call_next):
    # Frontend-Dateien immer frisch laden, damit Updates sofort sichtbar sind
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response
paperless = Paperless(settings)
store = JobStore(settings, paperless)


def get_job(job_id: str) -> Job:
    job = store.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job nicht gefunden")
    return job


def correspondents_or_none(refresh: bool = False) -> tuple[list[dict] | None, str | None]:
    if not settings.paperless_configured:
        return None, None
    try:
        return paperless.correspondents(refresh), None
    except Exception as e:  # noqa: BLE001
        return None, str(e)


# --- Allgemein -------------------------------------------------------------
@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/config")
def config():
    return {
        "paperless_configured": settings.paperless_configured,
        "paperless_url": settings.paperless_url,
        "llm_configured": settings.llm_configured,
        "llm_model": settings.llm_model if settings.llm_configured else None,
        "llm_local": any(h in settings.llm_base_url for h in ("localhost", "127.0.0.1", "[::1]")),
        "consume_configured": settings.consume_configured,
    }


# --- Korrespondenten -------------------------------------------------------
@app.get("/api/correspondents")
def list_correspondents(refresh: bool = False):
    corr, err = correspondents_or_none(refresh)
    if err:
        raise HTTPException(502, err)
    return corr or []


class NewCorrespondent(BaseModel):
    name: str


@app.post("/api/correspondents")
def create_correspondent(body: NewCorrespondent):
    if not body.name.strip():
        raise HTTPException(400, "Name fehlt")
    try:
        return paperless.create_correspondent(body.name)
    except PaperlessError as e:
        raise HTTPException(502, str(e)) from e


@app.get("/api/match")
def match(name: str):
    corr, err = correspondents_or_none()
    if err:
        raise HTTPException(502, err)
    return matching.match(name, corr or [])


# --- Jobs ------------------------------------------------------------------
@app.get("/api/jobs")
def list_jobs():
    return sorted(
        ({k: j.state[k] for k in ("id", "filename", "created_at", "status", "progress")}
         | {"uploaded": sum(1 for d in j.state["docs"].values() if (d.get("upload") or {}).get("status") == "success"),
            "documents": len(j.state["splits"]) + 1}
         for j in store.jobs.values()),
        key=lambda x: x["created_at"], reverse=True,
    )


@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...), duplex: bool = Form(True)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Bitte eine PDF-Datei hochladen")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", dir=settings.data_dir) as tmp:
        while chunk := await file.read(1 << 20):
            tmp.write(chunk)
    try:
        pdf.page_count(Path(tmp.name))
    except Exception as e:  # noqa: BLE001
        Path(tmp.name).unlink(missing_ok=True)
        raise HTTPException(400, f"PDF kann nicht gelesen werden: {e}") from e
    job = store.create(file.filename, Path(tmp.name), duplex)
    return {"id": job.id}


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str):
    job = get_job(job_id)
    corr, err = correspondents_or_none()
    with job.lock:
        state = dict(job.state)
        docs = store.documents(job, corr)
    state.pop("docs", None)
    return state | {"documents": docs, "paperless_error": err}


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    get_job(job_id)
    store.delete(job_id)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/analyze")
def analyze(job_id: str, reset: bool = False):
    job = get_job(job_id)
    if reset:
        job.update(lambda s: [p.update(analysis=None, error=None) for p in s["pages"]])
    store.reanalyze(job)
    return {"ok": True}


@app.get("/api/jobs/{job_id}/pages/{index}.jpg")
def page_image(job_id: str, index: int, size: str = "thumb"):
    job = get_job(job_id)
    if not 0 <= index < len(job.state["pages"]):
        raise HTTPException(404)
    width = pdf.LARGE_WIDTH if size == "large" else pdf.THUMB_WIDTH
    path = job.dir / "img" / f"{size}_{index:04d}.jpg"
    if not path.exists():
        pdf.render_page(job.pdf_path, index, width, path)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


class PageEdit(BaseModel):
    deleted: bool | None = None
    rotation: int | None = None


class LayoutEdit(BaseModel):
    splits: list[int] | None = None
    pages: list[PageEdit] | None = None


@app.put("/api/jobs/{job_id}/layout")
def set_layout(job_id: str, body: LayoutEdit):
    job = get_job(job_id)
    pages = [p.model_dump(exclude_none=True) for p in body.pages] if body.pages is not None else None
    store.set_layout(job, body.splits, pages)
    return {"ok": True}


class Confirm(BaseModel):
    pages: list[int]
    confirmed: bool = True


@app.post("/api/jobs/{job_id}/confirm")
def confirm(job_id: str, body: Confirm):
    store.confirm_pages(get_job(job_id), body.pages, body.confirmed)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/use-suggestions")
def use_suggestions(job_id: str):
    store.use_suggestions(get_job(job_id))
    return {"ok": True}


class DocMeta(BaseModel):
    title: str | None = None
    date: str | None = None
    correspondent_id: int | None = None


@app.put("/api/jobs/{job_id}/documents/{start}")
def set_doc(job_id: str, start: int, body: DocMeta):
    store.set_doc_meta(get_job(job_id), start, body.model_dump(exclude_unset=True))
    return {"ok": True}


@app.get("/api/jobs/{job_id}/documents/{start}.pdf")
def doc_pdf(job_id: str, start: int):
    job = get_job(job_id)
    try:
        out = store.export_doc(job, store.find_doc(job, start))
    except (KeyError, ValueError) as e:
        raise HTTPException(404, str(e)) from e
    return FileResponse(out, media_type="application/pdf")


@app.post("/api/jobs/{job_id}/documents/{start}/upload")
def upload_doc(job_id: str, start: int, target: str = "paperless"):
    job = get_job(job_id)
    try:
        store.upload(job, start, target)
    except (KeyError, ValueError, PaperlessError) as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC), name="static")
