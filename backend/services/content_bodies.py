"""Shared helpers for reading content bodies without oversized PostgREST filters."""

from __future__ import annotations

from typing import Any


CONTENT_BODY_LOOKUP_CHUNK_SIZE = 25


def chunked_values(values: list[str], size: int = CONTENT_BODY_LOOKUP_CHUNK_SIZE):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def fetch_content_body_rows(
    supabase,
    content_item_ids: list[str],
    *,
    columns: str = "content_item_id, html_body",
    chunk_size: int = CONTENT_BODY_LOOKUP_CHUNK_SIZE,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    unique_ids = [item_id for item_id in dict.fromkeys(content_item_ids) if item_id]
    for item_id_chunk in chunked_values(unique_ids, chunk_size):
        result = supabase.table("course_content_bodies").select(columns).in_(
            "content_item_id",
            item_id_chunk,
        ).execute()
        rows.extend(result.data or [])
    return rows


def fetch_content_html_by_item_id(
    supabase,
    content_item_ids: list[str],
    *,
    chunk_size: int = CONTENT_BODY_LOOKUP_CHUNK_SIZE,
) -> dict[str, str]:
    return {
        row["content_item_id"]: row.get("html_body") or ""
        for row in fetch_content_body_rows(
            supabase,
            content_item_ids,
            columns="content_item_id, html_body",
            chunk_size=chunk_size,
        )
        if row.get("content_item_id")
    }
