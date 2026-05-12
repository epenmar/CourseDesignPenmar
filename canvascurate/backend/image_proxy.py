import logging
import hashlib
import io
import mimetypes
from urllib.parse import urlparse

import httpx
from PIL import Image

from r2_storage import download_bytes, is_r2_configured, upload_bytes

logger = logging.getLogger(__name__)


def file_extension_from_type(content_type: str | None, source_url: str) -> str:
    guessed = mimetypes.guess_extension((content_type or "").split(";")[0].strip())
    if guessed:
        return guessed.lstrip(".")

    path = urlparse(source_url).path
    suffix = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if suffix in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
        return suffix
    return "bin"


def storage_keys(session_id: str, image_id: str, content_type: str | None, source_url: str) -> tuple[str, str]:
    extension = file_extension_from_type(content_type, source_url)
    base = f"images/canvas-cache/{session_id}/{image_id}"
    return f"{base}/original.{extension}", f"{base}/thumb.webp"


def editor_upload_storage_keys(session_id: str, image_id: str, filename: str, content_type: str | None) -> tuple[str, str]:
    extension = file_extension_from_type(content_type, filename)
    base = f"images/editor-uploads/{session_id}/{image_id}"
    return f"{base}/original.{extension}", f"{base}/thumb.webp"


def fetch_canvas_image_bytes(canvas_url: str, pat_token: str) -> tuple[bytes, str | None]:
    with httpx.Client(
        headers={"Authorization": f"Bearer {pat_token}"},
        follow_redirects=True,
        timeout=30.0,
    ) as client:
        response = client.get(canvas_url)
        response.raise_for_status()
        return response.content, response.headers.get("content-type")


def make_thumb_bytes(original_bytes: bytes) -> tuple[bytes, int | None, int | None, str]:
    try:
        with Image.open(io.BytesIO(original_bytes)) as image:
            image.load()
            width, height = image.size
            converted = image.convert("RGB")
            if width > 400:
                ratio = 400 / width
                converted = converted.resize((400, max(1, int(height * ratio))), Image.Resampling.LANCZOS)

            output = io.BytesIO()
            converted.save(output, format="WEBP", quality=82, method=6)
            thumb_width, thumb_height = converted.size
            return output.getvalue(), thumb_width, thumb_height, "image/webp"
    except Exception:
        return original_bytes, None, None, "application/octet-stream"


def hash_url(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def cache_image_assets(
    *,
    session_id: str,
    image_id: str,
    canvas_url: str,
    pat_token: str,
    existing_original_key: str | None,
    existing_thumb_key: str | None,
) -> dict:
    if is_r2_configured() and existing_original_key and existing_thumb_key:
        try:
            thumb_bytes, thumb_type = download_bytes(existing_thumb_key)
            return {
                "variant": "thumb",
                "bytes": thumb_bytes,
                "content_type": thumb_type or "image/webp",
                "status": "cached",
                "r2_original_key": existing_original_key,
                "r2_thumb_key": existing_thumb_key,
                "width": None,
                "height": None,
                "file_size_bytes": None,
            }
        except Exception:
            logger.exception(
                "Failed to read cached thumb from R2 for session_id=%s image_id=%s thumb_key=%s; falling back to Canvas fetch",
                session_id,
                image_id,
                existing_thumb_key,
            )

    original_bytes, content_type = fetch_canvas_image_bytes(canvas_url, pat_token)
    thumb_bytes, thumb_width, thumb_height, thumb_content_type = make_thumb_bytes(original_bytes)
    original_key, thumb_key = storage_keys(session_id, image_id, content_type, canvas_url)

    stored_in_r2 = False
    if is_r2_configured():
        try:
            upload_bytes(
                original_key,
                original_bytes,
                content_type=content_type or "application/octet-stream",
                cache_control="private, max-age=31536000, immutable",
            )
            upload_bytes(
                thumb_key,
                thumb_bytes,
                content_type=thumb_content_type if thumb_content_type != "application/octet-stream" else (content_type or "application/octet-stream"),
                cache_control="private, max-age=31536000, immutable",
            )
        except Exception:
            logger.exception(
                "Failed to cache image assets in R2 for session_id=%s image_id=%s original_key=%s thumb_key=%s",
                session_id,
                image_id,
                original_key,
                thumb_key,
            )
        else:
            stored_in_r2 = True

    width = None
    height = None
    try:
        with Image.open(io.BytesIO(original_bytes)) as image:
            image.load()
            width, height = image.size
    except Exception:
        width = None
        height = None

    return {
        "variant": "thumb",
        "bytes": thumb_bytes,
        "content_type": thumb_content_type if thumb_content_type != "application/octet-stream" else (content_type or "application/octet-stream"),
        "status": "cached" if stored_in_r2 else "new",
        "r2_original_key": original_key if stored_in_r2 else None,
        "r2_thumb_key": thumb_key if stored_in_r2 else None,
        "width": width,
        "height": height,
        "file_size_bytes": len(original_bytes),
        "original_bytes": original_bytes,
        "original_content_type": content_type or "application/octet-stream",
    }


def read_cached_variant(key: str, default_content_type: str) -> tuple[bytes, str]:
    payload, content_type = download_bytes(key)
    return payload, content_type or default_content_type


def prewarm_image_thumb(
    *,
    session_id: str,
    image_id: str,
    canvas_url: str,
    pat_token: str,
    existing_thumb_key: str | None,
) -> dict:
    if is_r2_configured() and existing_thumb_key:
        try:
            download_bytes(existing_thumb_key)
            return {
                "status": "cached",
                "r2_thumb_key": existing_thumb_key,
                "content_type": "image/webp",
                "file_size_bytes": None,
                "width": None,
                "height": None,
            }
        except Exception:
            logger.exception(
                "Failed to read prewarmed thumb from R2 for session_id=%s image_id=%s thumb_key=%s; falling back to Canvas fetch",
                session_id,
                image_id,
                existing_thumb_key,
            )

    original_bytes, content_type = fetch_canvas_image_bytes(canvas_url, pat_token)
    thumb_bytes, _, _, thumb_content_type = make_thumb_bytes(original_bytes)
    _, thumb_key = storage_keys(session_id, image_id, content_type, canvas_url)

    stored_in_r2 = False
    if is_r2_configured():
        try:
            upload_bytes(
                thumb_key,
                thumb_bytes,
                content_type=thumb_content_type if thumb_content_type != "application/octet-stream" else (content_type or "application/octet-stream"),
                cache_control="private, max-age=31536000, immutable",
            )
        except Exception:
            logger.exception(
                "Failed to prewarm image thumb in R2 for session_id=%s image_id=%s thumb_key=%s",
                session_id,
                image_id,
                thumb_key,
            )
        else:
            stored_in_r2 = True

    width = None
    height = None
    try:
        with Image.open(io.BytesIO(original_bytes)) as image:
            image.load()
            width, height = image.size
    except Exception:
        width = None
        height = None

    return {
        "status": "cached" if stored_in_r2 else "new",
        "r2_thumb_key": thumb_key if stored_in_r2 else None,
        "content_type": content_type or "application/octet-stream",
        "file_size_bytes": len(original_bytes),
        "width": width,
        "height": height,
    }
