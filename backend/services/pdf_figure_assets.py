from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from r2_storage import is_r2_configured, signed_get_url


logger = logging.getLogger(__name__)

PDF_FIGURE_SIGNED_URL_TTL_SECONDS = 15 * 60


def sign_pdf_figure_asset(asset: Any, *, expires_at: str | None = None) -> Any:
    if not is_r2_configured() or not isinstance(asset, dict) or asset.get("status") != "generated" or not asset.get("r2_key"):
        return asset
    try:
        return {
            **asset,
            "signed_url": signed_get_url(str(asset["r2_key"]), expires_in=PDF_FIGURE_SIGNED_URL_TTL_SECONDS),
            "signed_url_expires_at": expires_at or (
                datetime.now(timezone.utc) + timedelta(seconds=PDF_FIGURE_SIGNED_URL_TTL_SECONDS)
            ).isoformat(),
        }
    except Exception:
        logger.exception("Failed to sign PDF figure asset key=%s", asset.get("r2_key"))
        return asset


def sign_pdf_figure(figure: Any, *, expires_at: str | None = None) -> Any:
    if not isinstance(figure, dict):
        return figure
    return {
        **figure,
        "asset": sign_pdf_figure_asset(figure.get("asset"), expires_at=expires_at),
    }


def sign_pdf_figure_inventory(inventory: Any) -> Any:
    if not isinstance(inventory, dict):
        return inventory
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=PDF_FIGURE_SIGNED_URL_TTL_SECONDS)
    ).isoformat() if is_r2_configured() else None
    return {
        **inventory,
        "figures": [
            sign_pdf_figure(figure, expires_at=expires_at)
            for figure in inventory.get("figures") or []
            if isinstance(figure, dict)
        ],
        "asset_signed_url_ttl_seconds": PDF_FIGURE_SIGNED_URL_TTL_SECONDS,
    }


def attach_pdf_figure_signed_urls(remediation: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(remediation, dict):
        return remediation
    inventory = remediation.get("figure_inventory")
    if not isinstance(inventory, dict):
        return remediation
    return {
        **remediation,
        "figure_inventory": sign_pdf_figure_inventory(inventory),
    }
