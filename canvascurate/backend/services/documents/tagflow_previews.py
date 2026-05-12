"""TagFlow preview rendering and background job orchestration.

Owns PDF page preview rendering, tagged overlay asset generation, and the
durable job wrapper that keeps TagFlow preview metadata in document remediation
state.
"""

from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks
from PIL import Image, ImageDraw, ImageOps

from r2_storage import download_bytes, is_r2_configured, upload_bytes
from services.document_records import get_owned_session, update_document_remediation_metadata, write_platform_event
from services.documents.assets import document_tagflow_preview_storage_key, load_document_pdf_bytes
from services.documents.inventory import get_session_document_row
from services.job_dispatch import dispatch_background_task
from services.job_queue import enqueue_background_job, env_int
from supabase_client import get_supabase


logger = logging.getLogger(__name__)


def render_pdf_page_preview_image(data: bytes, page_number: int) -> Image.Image:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required for PDF preview rendering") from exc

    with fitz.open(stream=data, filetype="pdf") as pdf:
        if page_number < 1 or page_number > pdf.page_count:
            raise ValueError(f"Page {page_number} is outside the PDF page range")
        page = pdf.load_page(page_number - 1)
        pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
        image = Image.open(io.BytesIO(pix.tobytes("png")))
        image.load()
        return ImageOps.contain(image.convert("RGB"), (900, 1200), Image.Resampling.LANCZOS)


def encode_webp_preview(image: Image.Image) -> tuple[bytes, int, int]:
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=86, method=6)
    width, height = image.size
    return output.getvalue(), width, height


def render_pdf_page_preview_bytes(data: bytes, page_number: int) -> tuple[bytes, int, int]:
    return encode_webp_preview(render_pdf_page_preview_image(data, page_number))


def draw_tagflow_zones_on_preview(image: Image.Image, zones: list[dict[str, Any]]) -> Image.Image:
    tag_colors = {
        "heading": ((59, 130, 246, 40), (59, 130, 246, 180)),
        "text": ((107, 114, 128, 25), (107, 114, 128, 120)),
        "list": ((34, 197, 94, 30), (34, 197, 94, 160)),
        "table": ((139, 92, 246, 40), (139, 92, 246, 180)),
        "image": ((249, 115, 22, 40), (249, 115, 22, 180)),
        "artifact": ((156, 163, 175, 20), (156, 163, 175, 120)),
    }
    tag_to_zone_type = {
        "H1": "heading",
        "H2": "heading",
        "H3": "heading",
        "H4": "heading",
        "H5": "heading",
        "H6": "heading",
        "P": "text",
        "Span": "text",
        "L": "list",
        "LI": "list",
        "Table": "table",
        "TH": "table",
        "TD": "table",
        "TR": "table",
        "Figure": "image",
        "Artifact": "artifact",
    }
    image = image.convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")
    image_width, image_height = image.size
    line_width = max(2, round(image_width / 360))
    for index, zone in enumerate(sorted(zones, key=lambda item: int(item.get("reading_order") or 0)), start=1):
        bounds = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
        x = max(0, min(image_width, float(bounds.get("x") or 0) / 100 * image_width))
        y = max(0, min(image_height, float(bounds.get("y") or 0) / 100 * image_height))
        width = max(1, min(image_width - x, float(bounds.get("width") or 0) / 100 * image_width))
        height = max(1, min(image_height - y, float(bounds.get("height") or 0) / 100 * image_height))
        rect = (x, y, x + width, y + height)
        tag = str(zone.get("tag") or "P")
        fill, border = tag_colors[tag_to_zone_type.get(tag, "text")]
        draw.rectangle(rect, fill=fill, outline=border, width=line_width)
        label_tag = "Decorative" if tag == "Artifact" else ("List" if tag == "L" else tag)
        label = f"{index}. {label_tag}"
        label_rect = (x, max(0, y - 18), min(image_width, x + max(38, len(label) * 7)), max(16, y))
        draw.rounded_rectangle(label_rect, radius=4, fill=border, outline=border, width=1)
        draw.text((label_rect[0] + 4, label_rect[1] + 3), label, fill=(255, 255, 255, 255))
    return image.convert("RGB")


def render_tagged_pdf_page_preview_bytes(data: bytes, page_number: int, zones: list[dict[str, Any]]) -> tuple[bytes, int, int]:
    image = draw_tagflow_zones_on_preview(render_pdf_page_preview_image(data, page_number), zones)
    return encode_webp_preview(image.convert("RGB"))


def render_tagged_preview_from_asset(asset: dict[str, Any], zones: list[dict[str, Any]]) -> tuple[bytes, int, int]:
    if not asset.get("r2_key"):
        raise ValueError("Original preview asset is missing its storage key")
    payload, _ = download_bytes(str(asset["r2_key"]))
    image = Image.open(io.BytesIO(payload))
    image.load()
    return encode_webp_preview(draw_tagflow_zones_on_preview(image, zones))


def representative_preview_pages(remediation: dict[str, Any]) -> list[dict[str, Any]]:
    structure_preview = remediation.get("structure_preview") if isinstance(remediation.get("structure_preview"), dict) else {}
    return [
        page for page in (structure_preview.get("representative_pages") or [])
        if isinstance(page, dict) and isinstance(page.get("page_number"), int)
    ]


def tagflow_preview_pages_for_generation(
    remediation: dict[str, Any],
    *,
    requested_page_numbers: set[int] | None = None,
    representative_only: bool = True,
) -> list[dict[str, Any]]:
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    preview_generation = tagflow_state.get("preview_generation") if isinstance(tagflow_state.get("preview_generation"), dict) else {}
    stale_page_numbers = {
        int(page_number)
        for page_number in preview_generation.get("stale_page_numbers", [])
        if isinstance(page_number, int) or str(page_number).isdigit()
    }
    representative_by_number = {
        int(page["page_number"]): page
        for page in representative_preview_pages(remediation)
    }
    state_pages = [
        page for page in (tagflow_state.get("pages") or [])
        if isinstance(page, dict) and (isinstance(page.get("page_number"), int) or str(page.get("page_number")).isdigit())
    ]
    page_count = int((tagflow_state.get("summary") or {}).get("page_count") or len(state_pages) or 0)
    if requested_page_numbers:
        invalid_pages = [page_number for page_number in requested_page_numbers if page_number < 1 or (page_count and page_number > page_count)]
        if invalid_pages:
            raise ValueError(f"Requested TagFlow preview page is outside the document range: {invalid_pages[0]}")

    pages: list[dict[str, Any]] = []
    for state_page in state_pages:
        page_number = int(state_page.get("page_number") or 0)
        if requested_page_numbers and page_number not in requested_page_numbers:
            continue
        representative_page = representative_by_number.get(page_number)
        original_asset = (
            representative_page.get("original_asset")
            if isinstance(representative_page, dict) and isinstance(representative_page.get("original_asset"), dict)
            else state_page.get("original_asset") if isinstance(state_page.get("original_asset"), dict) else {}
        )
        if page_number not in stale_page_numbers and original_asset.get("status") == "generated":
            continue
        pages.append({
            **(representative_page or {}),
            "page_number": page_number,
            "label": (representative_page or {}).get("label") or f"Page {page_number}",
            "selection_reason": (representative_page or {}).get("selection_reason") or "full_document_page",
            "status": (representative_page or {}).get("status") or "metadata_only",
            "original_asset": original_asset or {"status": "pending", "url": None},
            "tagged_asset": (representative_page or {}).get("tagged_asset") if isinstance((representative_page or {}).get("tagged_asset"), dict) else state_page.get("tagged_asset") if isinstance(state_page.get("tagged_asset"), dict) else {"status": "pending", "url": None},
            "is_representative": bool(state_page.get("is_representative")),
        })

    if not requested_page_numbers and representative_only:
        return [
            page for page in pages
            if page.get("is_representative")
        ]
    return pages


def tagflow_preview_pages_needing_generation(remediation: dict[str, Any]) -> list[dict[str, Any]]:
    return tagflow_preview_pages_for_generation(remediation)


def mark_tagflow_preview_generation_status(
    remediation: dict[str, Any],
    *,
    pages: list[dict[str, Any]],
    job_id: str,
    status: str,
    timestamp: str,
) -> dict[str, Any]:
    page_numbers = {int(page["page_number"]) for page in pages}
    structure_preview = remediation.get("structure_preview") if isinstance(remediation.get("structure_preview"), dict) else {}
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    representative_pages: list[dict[str, Any]] = []
    for page in structure_preview.get("representative_pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        if page_number in page_numbers:
            original_asset = page.get("original_asset") if isinstance(page.get("original_asset"), dict) else {}
            original_generated = original_asset.get("status") == "generated"
            page = {
                **page,
                "original_asset": {
                    **original_asset,
                    "status": "generated" if original_generated else status,
                    "generation_status": "generated" if original_generated else status,
                    f"{status}_at": timestamp,
                },
            }
        representative_pages.append(page)

    next_pages: list[dict[str, Any]] = []
    for page in tagflow_state.get("pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        if page_number in page_numbers:
            original_asset = page.get("original_asset") if isinstance(page.get("original_asset"), dict) else {}
            original_generated = original_asset.get("status") == "generated"
            page = {
                **page,
                "preview_asset_status": status,
                "original_asset": {
                    **original_asset,
                    "status": "generated" if original_generated else status,
                    "generation_status": "generated" if original_generated else status,
                    f"{status}_at": timestamp,
                },
            }
        next_pages.append(page)

    preview_generation = tagflow_state.get("preview_generation") if isinstance(tagflow_state.get("preview_generation"), dict) else {}
    return {
        **remediation,
        "structure_preview": {
            **structure_preview,
            "representative_pages": representative_pages,
            "asset_generation": {
                **(structure_preview.get("asset_generation") if isinstance(structure_preview.get("asset_generation"), dict) else {}),
                "status": status,
                "job_type": "document_structure_preview",
                "job_id": job_id,
                f"{status}_at": timestamp,
                "page_numbers": sorted(page_numbers),
            },
        },
        "tagflow_state": {
            **tagflow_state,
            "pages": next_pages,
            "preview_generation": {
                **preview_generation,
                "status": status,
                "job_id": job_id,
                f"{status}_at": timestamp,
                "page_numbers": sorted(page_numbers),
            },
        },
    }


def apply_tagflow_preview_assets(
    remediation: dict[str, Any],
    *,
    job_id: str,
    generated_assets: dict[int, dict[str, Any]],
    failed_pages: list[dict[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    structure_preview = remediation.get("structure_preview") if isinstance(remediation.get("structure_preview"), dict) else {}
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    failed_page_numbers = {int(page.get("page_number") or 0) for page in failed_pages}
    representative_pages: list[dict[str, Any]] = []
    for page in structure_preview.get("representative_pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        generated = generated_assets.get(page_number)
        if generated:
            original_asset = generated.get("original_asset") if isinstance(generated.get("original_asset"), dict) else generated
            tagged_asset = generated.get("tagged_asset") if isinstance(generated.get("tagged_asset"), dict) else None
            existing_tagged_asset = page.get("tagged_asset") if isinstance(page.get("tagged_asset"), dict) else {}
            page = {
                **page,
                "status": "asset_generated",
                "original_asset": {
                    **original_asset,
                    "stale": False,
                    "generation_status": "generated",
                },
                "tagged_asset": {
                    **(tagged_asset or existing_tagged_asset),
                    "status": "generated" if tagged_asset else "pending_working_state",
                    "source": "tagflow_working_state",
                    "generated_at": tagged_asset.get("generated_at") if tagged_asset else None,
                },
            }
        elif page_number in failed_page_numbers:
            existing_original_asset = page.get("original_asset") if isinstance(page.get("original_asset"), dict) else {}
            page = {
                **page,
                "status": "asset_failed",
                "original_asset": {
                    **existing_original_asset,
                    "status": "generated" if existing_original_asset.get("status") == "generated" else "failed",
                },
            }
        representative_pages.append(page)

    generated_page_numbers = sorted(generated_assets)
    status = "generated"
    if failed_pages and generated_assets:
        status = "partial"
    elif failed_pages and not generated_assets:
        status = "failed"

    next_pages: list[dict[str, Any]] = []
    for page in tagflow_state.get("pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        if page_number in generated_assets:
            generated = generated_assets[page_number]
            original_asset = generated.get("original_asset") if isinstance(generated.get("original_asset"), dict) else generated
            tagged_asset = generated.get("tagged_asset") if isinstance(generated.get("tagged_asset"), dict) else None
            existing_tagged_asset = page.get("tagged_asset") if isinstance(page.get("tagged_asset"), dict) else {}
            page = {
                **page,
                "preview_asset_status": "generated",
                "stale_preview": False,
                "original_asset": {
                    **original_asset,
                    "stale": False,
                    "generation_status": "generated",
                },
                "tagged_asset": {
                    **(tagged_asset or existing_tagged_asset),
                    "status": "generated" if tagged_asset else "pending_working_state",
                    "source": "tagflow_working_state",
                    "generated_at": tagged_asset.get("generated_at") if tagged_asset else None,
                },
            }
        elif page_number in failed_page_numbers:
            existing_original_asset = page.get("original_asset") if isinstance(page.get("original_asset"), dict) else {}
            page = {
                **page,
                "preview_asset_status": "failed",
                "original_asset": {
                    **existing_original_asset,
                    "status": "generated" if existing_original_asset.get("status") == "generated" else "failed",
                },
            }
        next_pages.append(page)

    preview_generation = tagflow_state.get("preview_generation") if isinstance(tagflow_state.get("preview_generation"), dict) else {}
    next_structure_preview = {
        **structure_preview,
        "status": "assets_generated" if status == "generated" else f"assets_{status}",
        "representative_pages": representative_pages,
        "asset_generation": {
            **(structure_preview.get("asset_generation") if isinstance(structure_preview.get("asset_generation"), dict) else {}),
            "status": status,
            "job_type": "document_structure_preview",
            "job_id": job_id,
            "generated_at": generated_at,
            "generated_page_numbers": generated_page_numbers,
            "failed_page_numbers": sorted(failed_page_numbers),
            "source_tagflow_version": tagflow_state.get("version") or 1,
        },
    }
    next_tagflow_state = {
        **tagflow_state,
        "pages": next_pages,
        "preview_generation": {
            **preview_generation,
            "status": status,
            "job_id": job_id,
            "generated_page_numbers": generated_page_numbers,
            "failed_page_numbers": sorted(failed_page_numbers),
            "source_tagflow_version": tagflow_state.get("version") or 1,
            "stale_page_numbers": [
                page_number for page_number in preview_generation.get("stale_page_numbers", [])
                if page_number not in generated_assets
            ],
            "last_generated_at": generated_at if generated_assets else preview_generation.get("last_generated_at"),
        },
    }
    return {
        **remediation,
        "structure_preview": next_structure_preview,
        "tagflow_state": next_tagflow_state,
    }


def queue_document_structure_preview_job(
    supabase,
    *,
    session_id: str,
    user_id: str,
    row: dict[str, Any],
    page_numbers: list[int] | None = None,
    background_tasks: BackgroundTasks | None = None,
    run_inline: bool = False,
    representative_only: bool = True,
    max_pages_per_job: int | None = None,
) -> str:
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    if not remediation:
        raise ValueError("Run PDF review before generating TagFlow previews")
    requested_page_numbers = {
        int(page_number)
        for page_number in page_numbers or []
        if isinstance(page_number, int) or str(page_number).isdigit()
    } or None
    pages = tagflow_preview_pages_for_generation(
        remediation,
        requested_page_numbers=requested_page_numbers,
        representative_only=representative_only,
    )
    if max_pages_per_job is None:
        max_pages_per_job = int(os.getenv("TAGFLOW_PREVIEW_MAX_PAGES_PER_JOB", "12") or "12")
    if max_pages_per_job > 0 and len(pages) > max_pages_per_job:
        pages = pages[:max_pages_per_job]
    if not pages:
        raise ValueError("No TagFlow preview pages need generation")

    job_payload = {
        "session_id": session_id,
        "document_id": row["id"],
        "canvas_file_id": row.get("canvas_id"),
        "filename": row.get("filename"),
        "page_numbers": [page["page_number"] for page in pages],
        "page_scope": "selected" if requested_page_numbers else "representative" if representative_only else "all",
        "page_limit": max_pages_per_job if max_pages_per_job > 0 else None,
    }
    enqueued = enqueue_background_job(
        supabase,
        user_id=user_id,
        session_id=session_id,
        job_type="document_structure_preview",
        payload=job_payload,
        duplicate_fields=("document_id",),
        max_active_job_type_per_user=env_int("TAGFLOW_PREVIEW_MAX_ACTIVE_JOBS_PER_USER", 4),
    )
    job_id = enqueued.job["id"]
    if not enqueued.created:
        return job_id
    queued_at = datetime.now(timezone.utc).isoformat()
    queued_remediation = mark_tagflow_preview_generation_status(
        remediation,
        pages=pages,
        job_id=job_id,
        status="queued",
        timestamp=queued_at,
    )
    update_document_remediation_metadata(
        supabase,
        session_id=session_id,
        user_id=user_id,
        document_id=row["id"],
        remediation_plan=queued_remediation,
        updated_at=queued_at,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_structure_preview_queued",
        properties={
            "job_id": job_id,
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "page_count": len(pages),
        },
    )
    if run_inline:
        run_document_structure_preview_job(job_id, session_id, user_id, row["id"])
    elif background_tasks is not None:
        dispatch_background_task(background_tasks, run_document_structure_preview_job, job_id, session_id, user_id, row["id"])
    return job_id


def run_document_structure_preview_job(job_id: str, session_id: str, user_id: str, document_id: str):
    supabase = get_supabase()
    started_at = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        if not is_r2_configured():
            raise ValueError("R2 storage is required for TagFlow preview assets")
        get_owned_session(supabase, session_id, user_id)
        row = get_session_document_row(supabase, session_id, user_id, document_id)
        remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
        if not remediation:
            raise ValueError("Run PDF review before generating TagFlow previews")
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        requested_page_numbers = {
            int(page_number)
            for page_number in (payload.get("page_numbers") if isinstance(payload, dict) else []) or []
            if isinstance(page_number, int) or str(page_number).isdigit()
        } or None
        pages = tagflow_preview_pages_for_generation(remediation, requested_page_numbers=requested_page_numbers)
        if not pages:
            raise ValueError("No TagFlow preview pages need generation")
        running_remediation = mark_tagflow_preview_generation_status(
            remediation,
            pages=pages,
            job_id=job_id,
            status="running",
            timestamp=started_at,
        )
        update_document_remediation_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=row["id"],
            remediation_plan=running_remediation,
            updated_at=started_at,
        )
        remediation = running_remediation

        tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
        version = int(tagflow_state.get("version") or 1)
        state_page_by_number = {
            int(page.get("page_number") or 0): page
            for page in tagflow_state.get("pages") or []
            if isinstance(page, dict)
        }
        pdf_data: bytes | None = None

        def get_pdf_data() -> bytes:
            nonlocal pdf_data
            if pdf_data is None:
                pdf_data, _ = load_document_pdf_bytes(
                    supabase,
                    session_id=session_id,
                    user_id=user_id,
                    row=row,
                )
            return pdf_data

        generated_at = datetime.now(timezone.utc).isoformat()
        generated_assets: dict[int, dict[str, Any]] = {}
        failed_pages: list[dict[str, Any]] = []
        for page in pages:
            page_number = int(page["page_number"])
            try:
                state_page = state_page_by_number.get(page_number) if isinstance(state_page_by_number.get(page_number), dict) else {}
                zones = state_page.get("zones") if isinstance(state_page.get("zones"), list) else []
                existing_original_asset = page.get("original_asset") if isinstance(page.get("original_asset"), dict) else {}
                if existing_original_asset.get("status") == "generated" and existing_original_asset.get("r2_key"):
                    original_asset = {
                        **existing_original_asset,
                        "status": "generated",
                        "variant": "original",
                        "stale": False,
                        "generation_status": "generated",
                    }
                    tagged_bytes, tagged_width, tagged_height = render_tagged_preview_from_asset(original_asset, zones)
                else:
                    data = get_pdf_data()
                    preview_bytes, width, height = render_pdf_page_preview_bytes(data, page_number)
                    key = document_tagflow_preview_storage_key(session_id, row["id"], version, page_number, "original")
                    upload_bytes(
                        key,
                        preview_bytes,
                        content_type="image/webp",
                        cache_control="private, max-age=31536000, immutable",
                        metadata={
                            "source_document_id": row["id"],
                            "source_canvas_file_id": str(row.get("canvas_id") or ""),
                            "page_number": str(page_number),
                            "variant": "original",
                            "tagflow_version": str(version),
                        },
                    )
                    original_asset = {
                        "status": "generated",
                        "variant": "original",
                        "r2_key": key,
                        "content_type": "image/webp",
                        "width": width,
                        "height": height,
                        "file_size_bytes": len(preview_bytes),
                        "generated_at": generated_at,
                        "source": "original_pdf",
                        "tagflow_version": version,
                        "source_tagflow_version": version,
                    }
                    tagged_bytes, tagged_width, tagged_height = render_tagged_pdf_page_preview_bytes(data, page_number, zones)
                tagged_key = document_tagflow_preview_storage_key(session_id, row["id"], version, page_number, "tagged")
                upload_bytes(
                    tagged_key,
                    tagged_bytes,
                    content_type="image/webp",
                    cache_control="private, max-age=31536000, immutable",
                    metadata={
                        "source_document_id": row["id"],
                        "source_canvas_file_id": str(row.get("canvas_id") or ""),
                        "page_number": str(page_number),
                        "variant": "tagged",
                        "tagflow_version": str(version),
                        "zone_count": str(len(zones)),
                    },
                )
                generated_assets[page_number] = {
                    "original_asset": original_asset,
                    "tagged_asset": {
                        "status": "generated",
                        "variant": "tagged",
                        "r2_key": tagged_key,
                        "content_type": "image/webp",
                        "width": tagged_width,
                        "height": tagged_height,
                        "file_size_bytes": len(tagged_bytes),
                        "generated_at": generated_at,
                        "source": "tagflow_working_state",
                        "tagflow_version": version,
                        "source_tagflow_version": version,
                        "zone_count": len(zones),
                    },
                }
            except Exception as exc:
                logger.exception(
                    "Failed to render TagFlow preview page session_id=%s document_id=%s page_number=%s",
                    session_id,
                    row["id"],
                    page_number,
                )
                failed_pages.append({"page_number": page_number, "error": str(exc)})

        next_remediation = apply_tagflow_preview_assets(
            remediation,
            job_id=job_id,
            generated_assets=generated_assets,
            failed_pages=failed_pages,
            generated_at=generated_at,
        )
        update_document_remediation_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=row["id"],
            remediation_plan=next_remediation,
            updated_at=generated_at,
        )
        result = {
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "generated_page_count": len(generated_assets),
            "failed_page_count": len(failed_pages),
            "requested_page_numbers": [page["page_number"] for page in pages],
            "generated_page_numbers": sorted(generated_assets),
            "failed_pages": failed_pages,
        }
        if not generated_assets:
            raise ValueError(f"TagFlow preview generation failed for all {len(failed_pages)} page(s)")
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_structure_preview_completed",
            properties={
                "job_id": job_id,
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "generated_page_count": len(generated_assets),
                "failed_page_count": len(failed_pages),
            },
        )
    except Exception as exc:
        logger.exception("TagFlow preview generation job failed for document_id=%s", document_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
