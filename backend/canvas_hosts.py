import re
from urllib.parse import urlparse

from fastapi import HTTPException

ASU_CANVAS_HOSTS = ("canvas.asu.edu", "asu.instructure.com")
ASU_CANVAS_BASE_URLS = tuple(f"https://{host}" for host in ASU_CANVAS_HOSTS)
ALLOWED_CANVAS_HOSTS = set(ASU_CANVAS_HOSTS)


def _validate_allowed_host(host: str) -> str:
    normalized = host.lower().strip(".")
    if normalized not in ALLOWED_CANVAS_HOSTS:
        raise HTTPException(
            status_code=422,
            detail="Canvas host must be canvas.asu.edu or asu.instructure.com",
        )
    return normalized


def normalize_canvas_base_url(raw_base_url: str) -> str:
    value = raw_base_url.strip()
    if not value:
        raise HTTPException(status_code=422, detail="canvas_base_url is required")

    if "://" not in value:
        value = f"https://{value}"

    parsed = urlparse(value)
    host = parsed.hostname or ""

    if parsed.scheme.lower() != "https" or not host:
        raise HTTPException(
            status_code=422,
            detail="canvas_base_url must be a valid HTTPS URL",
        )

    return f"https://{_validate_allowed_host(host)}"


def canvas_base_url_aliases(raw_base_url: str) -> list[str]:
    """Return accepted Canvas base URLs that can share one ASU Canvas credential."""
    normalized = normalize_canvas_base_url(raw_base_url)
    if normalized not in ASU_CANVAS_BASE_URLS:
        return [normalized]
    return [normalized, *[base_url for base_url in ASU_CANVAS_BASE_URLS if base_url != normalized]]


def parse_canvas_course_url(raw_canvas_url: str) -> tuple[str, str]:
    canvas_url = raw_canvas_url.strip()
    parsed = urlparse(canvas_url)
    host = parsed.hostname or ""

    if parsed.scheme.lower() != "https" or not host:
        raise HTTPException(
            status_code=422,
            detail="canvas_url must be a valid HTTPS URL",
        )

    canvas_base_url = f"https://{_validate_allowed_host(host)}"
    match = re.search(r"/courses/(\d+)(?:/|$)", parsed.path)
    if not match:
        raise HTTPException(
            status_code=422,
            detail="canvas_url must contain /courses/<id>",
        )

    return canvas_base_url, match.group(1)
