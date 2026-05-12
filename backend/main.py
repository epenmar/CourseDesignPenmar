"""FastAPI application entry point for the Canvas Curator backend.

Registers focused routers, shared middleware, and app-level request timing.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import time

from api.admin.router import router as admin_router
from api.documents import router as api_documents
from api.course_creation.router import router as course_creation_router
from api.editor.router import router as editor_router
from api.images.router import router as images_router
from api.inventory.router import router as inventory_router
from api.links.router import router as links_router
from api.modules.router import router as modules_router
from api.pdf_figures import router as pdf_figures
from api.pdf_export import router as pdf_export
from api.pending_review.router import router as pending_review_router
from api.reports import router as reports_router
from api.sync.router import router as sync_router
from api.tagflow import router as tagflow
from api.transfer.router import router as transfer_router
from routers import health, canvas, credentials, documents, sessions

logger = logging.getLogger("canvas_curator.perf")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="Canvas Curator API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(health.router)
app.include_router(admin_router)
app.include_router(canvas.router)
app.include_router(editor_router)
app.include_router(images_router)
app.include_router(inventory_router)
app.include_router(links_router)
app.include_router(modules_router)
app.include_router(pending_review_router)
app.include_router(credentials.router)
app.include_router(documents.router)
app.include_router(api_documents.router)
app.include_router(course_creation_router)
app.include_router(pdf_export.router)
app.include_router(reports_router)
app.include_router(sync_router)
app.include_router(pdf_figures.router)
app.include_router(tagflow.router)
app.include_router(transfer_router)
app.include_router(sessions.router)


@app.middleware("http")
async def add_timing_headers(request: Request, call_next):
    started = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - started) * 1000, 1)
    response.headers["X-Process-Time-Ms"] = str(duration_ms)
    if duration_ms >= 1500:
        logger.warning(
            "slow_request path=%s method=%s status=%s duration_ms=%s",
            request.url.path,
            request.method,
            response.status_code,
            duration_ms,
        )
    return response


@app.get("/")
async def root():
    return {"status": "ok", "service": "canvas-curator-api", "version": "2.0.0"}
