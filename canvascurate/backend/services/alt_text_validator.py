"""Helpers for detecting image alt text that still needs review."""

from __future__ import annotations

import re
from urllib.parse import unquote, urlparse

GENERIC_ALT_WORDS = {
    "image",
    "images",
    "img",
    "photo",
    "photos",
    "picture",
    "pictures",
    "screenshot",
    "screen shot",
    "untitled",
    "file",
    "scan",
    "document",
    "thumbnail",
    "thumb",
}

_ALT_LOOKS_LIKE_FILENAME = re.compile(r"^[\w\s\-_.]+\.[A-Za-z0-9]{2,5}$")
_GENERIC_FILENAME_PATTERN = re.compile(
    r"^(?:img|dsc|dscn|pict?|photo|screen[\s_-]?shot|scn|image|scan|capture)"
    r"[\s_\-]*[\d][\d\s\-]*$",
    re.IGNORECASE,
)
_CAMEL_SPLIT = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")


def _compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _split_camelcase(value: str) -> list[str]:
    parts = _CAMEL_SPLIT.findall(value)
    return parts if len(parts) > 1 else [value]


def _segment_smashed_word(value: str) -> str:
    parts = _split_camelcase(value)
    if len(parts) > 1:
        return " ".join(parts)
    if len(value) < 7:
        return value
    try:
        import wordninja
    except ImportError:
        return value
    words = wordninja.split(value)
    if len(words) <= 1:
        return value
    single_letter_words = sum(1 for word in words if len(word) == 1 and word.isalpha() and word.lower() not in {"a", "i"})
    if single_letter_words:
        return value
    return " ".join(words)


def derive_filename_stem(value: str | None) -> str:
    raw = _compact(value)
    if not raw:
        return ""
    if "://" in raw or raw.startswith("/"):
        tail = (urlparse(raw).path or raw).rsplit("/", 1)[-1]
    else:
        tail = raw.rsplit("/", 1)[-1]
    try:
        tail = unquote(tail)
    except Exception:
        pass
    tail = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", tail)
    tail = re.sub(r"[._\-]+", " ", tail)
    tail = _compact(tail)
    if not tail:
        return ""
    return " ".join(_segment_smashed_word(part) for part in tail.split(" ")).strip()


def _normalize_filenameish(value: str | None) -> str:
    return re.sub(r"[\s\-_.]+", "", (value or "").lower())


def is_filename_alt(alt: str | None, *filename_sources: str | None) -> bool:
    alt_text = _compact(alt)
    if not alt_text:
        return False
    if _ALT_LOOKS_LIKE_FILENAME.match(alt_text):
        return True
    normalized_alt = _normalize_filenameish(alt_text)
    if not normalized_alt:
        return False
    for source in filename_sources:
        stem = derive_filename_stem(source)
        normalized_stem = _normalize_filenameish(stem)
        if not normalized_stem:
            continue
        stem_words = re.split(r"\s+", stem.strip())
        stem_is_substantial = len(stem_words) > 1 and len(normalized_stem) >= 6
        if (
            normalized_alt == normalized_stem
            or normalized_alt in normalized_stem
            or (stem_is_substantial and normalized_stem in normalized_alt)
        ):
            return True
    return False


def classify_alt_text(alt: str | None, *filename_sources: str | None) -> str | None:
    alt_text = _compact(alt)
    if not alt_text:
        return "missing_image_alt"
    if alt_text.lower() in GENERIC_ALT_WORDS:
        return "generic_image_alt"
    if is_filename_alt(alt_text, *filename_sources):
        return "filename_image_alt"
    if _GENERIC_FILENAME_PATTERN.match(derive_filename_stem(alt_text) or alt_text):
        return "filename_image_alt"
    if len(alt_text) > 250:
        return "image_alt_too_long"
    return None


def alt_issue_label(code: str | None) -> str | None:
    return {
        "missing_image_alt": "Missing alt text",
        "generic_image_alt": "Generic alt text",
        "filename_image_alt": "Alt text is the filename",
        "image_alt_too_long": "Alt text is too long",
    }.get(code or "")
