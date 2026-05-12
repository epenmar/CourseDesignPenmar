"""TagFlow preview asset helpers.

Finds generated page preview assets and produces focused crops for selected
zones without requiring direct PDF rendering or OCR dependencies.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from PIL import Image, ImageOps

from r2_storage import download_bytes, is_r2_configured, signed_get_url
from services.pdf_figure_assets import attach_pdf_figure_signed_urls
from services.pdf_figures import enrich_tagflow_figure_candidates


logger = logging.getLogger(__name__)
TAGFLOW_PREVIEW_SIGNED_URL_TTL_SECONDS = 15 * 60


def attach_tagflow_preview_signed_urls(remediation: dict[str, Any]) -> dict[str, Any]:
    remediation = enrich_tagflow_figure_candidates(remediation)
    remediation = attach_pdf_figure_signed_urls(remediation)
    r2_ready = is_r2_configured()
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=TAGFLOW_PREVIEW_SIGNED_URL_TTL_SECONDS)
    ).isoformat() if r2_ready else None

    def sign_asset(asset: Any) -> Any:
        if not r2_ready or not isinstance(asset, dict) or asset.get("status") != "generated" or not asset.get("r2_key"):
            return asset
        try:
            return {
                **asset,
                "signed_url": signed_get_url(str(asset["r2_key"]), expires_in=TAGFLOW_PREVIEW_SIGNED_URL_TTL_SECONDS),
                "signed_url_expires_at": expires_at,
            }
        except Exception:
            logger.exception("Failed to sign TagFlow preview asset key=%s", asset.get("r2_key"))
            return asset

    def compact_tagflow_page(page: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in page.items()
            if key != "image_blocks"
        }

    def compact_text_analysis_payload(text_analysis: Any) -> Any:
        if not isinstance(text_analysis, dict):
            return text_analysis
        compact_pages = []
        for page in text_analysis.get("pages") or []:
            if not isinstance(page, dict):
                continue
            compact_pages.append({
                key: value
                for key, value in page.items()
                if key not in {"text_blocks", "image_blocks", "figure_candidates"}
            })
        return {
            **text_analysis,
            "pages": compact_pages,
        }

    structure_preview = remediation.get("structure_preview") if isinstance(remediation.get("structure_preview"), dict) else {}
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}

    representative_pages = []
    for page in structure_preview.get("representative_pages") or []:
        if not isinstance(page, dict):
            continue
        representative_pages.append({
            **page,
            "original_asset": sign_asset(page.get("original_asset")),
            "tagged_asset": sign_asset(page.get("tagged_asset")),
        })

    state_pages = []
    for page in tagflow_state.get("pages") or []:
        if not isinstance(page, dict):
            continue
        compact_page = compact_tagflow_page(page)
        state_pages.append({
            **compact_page,
            "original_asset": sign_asset(page.get("original_asset")),
            "tagged_asset": sign_asset(page.get("tagged_asset")),
        })

    response = {
        **remediation,
        "structure_preview": {
            **structure_preview,
            "representative_pages": representative_pages,
        },
        "tagflow_state": {
            **tagflow_state,
            "pages": state_pages,
            "preview_signed_url_ttl_seconds": TAGFLOW_PREVIEW_SIGNED_URL_TTL_SECONDS,
        },
    }
    if "text_analysis" in remediation:
        response["text_analysis"] = compact_text_analysis_payload(remediation.get("text_analysis"))
    return response


def find_tagflow_page_asset(remediation: dict[str, Any], *, page_number: int, variant: str = "original") -> dict[str, Any] | None:
    structure_preview = remediation.get("structure_preview") if isinstance(remediation.get("structure_preview"), dict) else {}
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}

    for page in structure_preview.get("representative_pages") or []:
        if not isinstance(page, dict) or int(page.get("page_number") or 0) != page_number:
            continue
        asset = page.get(f"{variant}_asset")
        if isinstance(asset, dict):
            return asset

    for page in tagflow_state.get("pages") or []:
        if not isinstance(page, dict) or int(page.get("page_number") or 0) != page_number:
            continue
        asset = page.get(f"{variant}_asset")
        if isinstance(asset, dict):
            return asset

    return None


def normalize_percent_bounds(bounds: dict[str, Any]) -> dict[str, float]:
    x = max(0.0, min(100.0, float(bounds.get("x") or 0)))
    y = max(0.0, min(100.0, float(bounds.get("y") or 0)))
    width = max(0.1, min(100.0 - x, float(bounds.get("width") or 0)))
    height = max(0.1, min(100.0 - y, float(bounds.get("height") or 0)))
    return {"x": x, "y": y, "width": width, "height": height}


def crop_preview_asset_to_webp(asset: dict[str, Any], bounds: dict[str, Any], *, max_size: tuple[int, int] = (1400, 1400)) -> tuple[bytes, int, int]:
    if asset.get("status") != "generated" or not asset.get("r2_key"):
        raise ValueError("Original preview asset is not generated")

    payload, _ = download_bytes(str(asset["r2_key"]))
    image = Image.open(io.BytesIO(payload))
    image.load()
    image = image.convert("RGB")
    image_width, image_height = image.size
    normalized = normalize_percent_bounds(bounds)

    left = round(normalized["x"] / 100 * image_width)
    top = round(normalized["y"] / 100 * image_height)
    right = round((normalized["x"] + normalized["width"]) / 100 * image_width)
    bottom = round((normalized["y"] + normalized["height"]) / 100 * image_height)
    if right <= left or bottom <= top:
        raise ValueError("Zone crop is empty")

    crop = image.crop((
        max(0, left),
        max(0, top),
        min(image_width, right),
        min(image_height, bottom),
    ))
    crop = ImageOps.contain(crop, max_size, Image.Resampling.LANCZOS)
    output = io.BytesIO()
    crop.save(output, format="WEBP", quality=88, method=6)
    width, height = crop.size
    return output.getvalue(), width, height
