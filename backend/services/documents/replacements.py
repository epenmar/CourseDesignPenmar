"""Document replacement deployment and original-file archive services."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from html import escape as escape_html
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from canvas_sync import CanvasClient, get_active_pat, sha256_payload
from content_inventory import canonical_asset_url
from r2_storage import download_bytes
from services.canvas_uploads import canvas_course_connection, canvas_file_html_url, upload_canvas_course_file
from services.content_revisions import save_content_revision
from services.document_records import write_platform_event
from services.documents.inventory import document_has_active_canvas_placement, get_session_document_row
from services.editor.file_upload import safe_upload_filename
from supabase_client import get_supabase


logger = logging.getLogger(__name__)


def render_attrs(attrs: list[tuple[str, str | None]]) -> str:
    if not attrs:
        return ""
    rendered = []
    for name, value in attrs:
        if value is None:
            rendered.append(name)
        else:
            rendered.append(f'{name}="{escape_html(str(value), quote=True)}"')
    return " " + " ".join(rendered)


def set_attr(attrs: list[tuple[str, str | None]], name: str, value: str | None):
    lowered = name.lower()
    for index, (existing_name, _) in enumerate(attrs):
        if existing_name.lower() == lowered:
            attrs[index] = (existing_name, value)
            return
    attrs.append((name, value))


class LinkHrefReplaceParser(HTMLParser):
    def __init__(self, *, target_index: int, target_href: str, replacement_href: str):
        super().__init__(convert_charrefs=False)
        self.target_index = target_index
        self.target_href = canonical_asset_url(target_href)
        self.replacement_href = replacement_href
        self.link_index = 0
        self.parts: list[str] = []
        self.changed = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() == "a":
            attr_map = {name.lower(): value or "" for name, value in attrs}
            href = canonical_asset_url(attr_map.get("href"))
            if href:
                self.link_index += 1
            if href and self.link_index == self.target_index and href == self.target_href:
                next_attrs = list(attrs)
                set_attr(next_attrs, "href", self.replacement_href)
                set_attr(next_attrs, "data-api-endpoint", self.replacement_href)
                set_attr(next_attrs, "data-api-returntype", "File")
                attrs = next_attrs
                self.changed = True
        self.parts.append(f"<{tag}{render_attrs(attrs)}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]):
        self.parts.append(f"<{tag}{render_attrs(attrs)} />")

    def handle_endtag(self, tag: str):
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str):
        self.parts.append(data)

    def handle_entityref(self, name: str):
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str):
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str):
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str):
        self.parts.append(f"<!{decl}>")

    def result(self) -> str:
        return "".join(self.parts)


def apply_link_href_to_html(html_body: str, *, link_index: int, href: str, replacement_href: str) -> tuple[str, bool]:
    parser = LinkHrefReplaceParser(
        target_index=link_index,
        target_href=href,
        replacement_href=replacement_href,
    )
    parser.feed(html_body or "")
    parser.close()
    return parser.result(), parser.changed


def persist_replacement_candidate(
    supabase,
    *,
    session_id: str,
    user_id: str,
    row: dict[str, Any],
    candidate: dict[str, Any],
    now: str,
    r2_working_key: str | None = None,
):
    item_result = supabase.table("course_content_items").select(
        "id, metadata"
    ).eq("id", row["id"]).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Document file row not found")
    metadata = item_result.data[0].get("metadata") if isinstance(item_result.data[0].get("metadata"), dict) else {}
    supabase.table("course_content_items").update({
        "metadata": {**metadata, "replacement_candidate": candidate},
        "updated_at": now,
    }).eq("id", row["id"]).eq("session_id", session_id).eq(
        "user_id", user_id
    ).execute()

    document_result = supabase.table("documents").select(
        "id, tag_data"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    for document in document_result.data or []:
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        matches_content_item = tag_data.get("content_item_id") == row["id"]
        matches_canvas_file = row.get("canvas_id") and str(tag_data.get("canvas_file_id") or "") == str(row.get("canvas_id"))
        if not matches_content_item and not matches_canvas_file:
            continue
        updates = {
            "tag_data": {**tag_data, "replacement_candidate": candidate},
            "updated_at": now,
        }
        if r2_working_key:
            updates["r2_working_key"] = r2_working_key
        supabase.table("documents").update(updates).eq("id", document["id"]).execute()


def selected_document_references(row: dict[str, Any], requested: list[dict[str, Any]]) -> list[dict[str, Any]]:
    available = {
        (link.get("content_item_id"), int(link.get("link_index") or 0), canonical_asset_url(link.get("href"))): link
        for link in row.get("linked_from", [])
        if link.get("content_item_id") and link.get("link_index") and link.get("href")
    }
    selected: list[dict[str, Any]] = []
    for reference in requested:
        key = (
            reference.get("content_item_id"),
            int(reference.get("link_index") or 0),
            canonical_asset_url(reference.get("href")),
        )
        link = available.get(key)
        if not link:
            raise HTTPException(status_code=422, detail="One or more selected references no longer match this document")
        selected.append(link)
    return selected


def run_document_replacement_deploy_job(
    job_id: str,
    session_id: str,
    user_id: str,
    document_id: str,
    selected_references: list[dict[str, Any]],
):
    supabase = get_supabase()
    started_at = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        row = get_session_document_row(supabase, session_id, user_id, document_id)
        candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else None
        if not candidate:
            raise ValueError("Replacement candidate is missing")
        r2_key = candidate.get("r2_key")
        if not isinstance(r2_key, str) or not r2_key:
            raise ValueError("Replacement candidate is missing R2 storage key")

        data, stored_content_type = download_bytes(r2_key)
        filename = safe_upload_filename(candidate.get("filename") or "replacement.pdf", "replacement.pdf")
        content_type = candidate.get("content_type") or stored_content_type or "application/pdf"
        course = canvas_course_connection(supabase, session_id, user_id)
        canvas_base_url = course["canvas_base_url"]
        canvas_course_id = course["canvas_course_id"]
        pat_token = get_active_pat(supabase, user_id, canvas_base_url)
        file_row = upload_canvas_course_file(
            canvas_base_url=canvas_base_url,
            canvas_course_id=canvas_course_id,
            pat_token=pat_token,
            filename=filename,
            content_type=content_type,
            data=data,
        )
        canvas_file_id = str(file_row.get("id")) if file_row.get("id") is not None else None
        canvas_url = canvas_file_html_url(canvas_base_url, canvas_course_id, file_row)
        now = datetime.now(timezone.utc).isoformat()

        folder = file_row.get("folder") if isinstance(file_row.get("folder"), dict) else {}
        if canvas_file_id:
            content_row = {
                "session_id": session_id,
                "user_id": user_id,
                "canvas_id": canvas_file_id,
                "content_type": "file",
                "title": file_row.get("display_name") or file_row.get("filename") or filename,
                "canvas_url": canvas_url,
                "published": not bool(file_row.get("hidden")),
                "module_name": None,
                "position": None,
                "body_hash": sha256_payload({"replacement_file": canvas_file_id, "source_document_id": document_id}),
                "body_word_count": 0,
                "last_canvas_edit_at": file_row.get("updated_at") or file_row.get("created_at") or now,
                "last_synced_at": now,
                "is_orphaned": True,
                "metadata": {
                    "filename": file_row.get("filename") or filename,
                    "content_type": file_row.get("content-type") or file_row.get("content_type") or content_type,
                    "size": file_row.get("size") or len(data),
                    "folder_id": file_row.get("folder_id") or folder.get("id"),
                    "folder_name": folder.get("name"),
                    "folder_path": folder.get("full_name"),
                    "uploaded_via": "document_replacement_deploy",
                    "source_document_id": document_id,
                    "source_canvas_file_id": row.get("canvas_id"),
                    "replacement_id": candidate.get("id"),
                },
                "updated_at": now,
            }
            existing_file_result = supabase.table("course_content_items").select("id").eq(
                "session_id", session_id
            ).eq("user_id", user_id).eq("canvas_id", canvas_file_id).eq(
                "content_type", "file"
            ).limit(1).execute()
            if existing_file_result.data:
                supabase.table("course_content_items").update(content_row).eq("id", existing_file_result.data[0]["id"]).execute()
            else:
                supabase.table("course_content_items").insert(content_row).execute()

        grouped: dict[str, list[dict[str, Any]]] = {}
        for reference in selected_references:
            grouped.setdefault(reference["content_item_id"], []).append(reference)

        revisions: list[dict[str, Any]] = []
        for content_item_id, references in grouped.items():
            body_result = supabase.table("course_content_bodies").select(
                "html_body"
            ).eq("content_item_id", content_item_id).limit(1).execute()
            current_html = (body_result.data[0].get("html_body") if body_result.data else "") or ""
            next_html = current_html
            changed_count = 0
            for reference in sorted(references, key=lambda link: int(link.get("link_index") or 0)):
                next_html, changed = apply_link_href_to_html(
                    next_html,
                    link_index=int(reference["link_index"]),
                    href=reference["href"],
                    replacement_href=canvas_url,
                )
                if changed:
                    changed_count += 1
            if changed_count <= 0:
                continue
            result = save_content_revision(
                supabase,
                session_id=session_id,
                user_id=user_id,
                content_item_id=content_item_id,
                next_html=next_html,
                change_summary=f"Replace document link with {filename}",
            )
            revisions.append({
                "content_item_id": content_item_id,
                "changed_count": changed_count,
                "saved": result["saved"],
                "revision_number": result["revision_number"],
            })

        deployed_candidate = {
            **candidate,
            "status": "deployed_to_canvas_file",
            "reference_review": {
                "status": "reviewed",
                "reviewed_at": started_at,
                "reviewed_by": user_id,
                "linked_count": len(selected_references),
                "filename_link_count": sum(1 for reference in selected_references if reference.get("is_filename_label")),
                "generic_link_count": sum(1 for reference in selected_references if reference.get("issue_code")),
                "content_item_ids": list(grouped.keys()),
            },
            "canvas_deployment": {
                "status": "succeeded",
                "canvas_file_id": canvas_file_id,
                "canvas_url": canvas_url,
                "job_id": job_id,
                "deployed_at": now,
                "selected_reference_count": len(selected_references),
                "revision_count": len(revisions),
            },
        }
        persist_replacement_candidate(
            supabase,
            session_id=session_id,
            user_id=user_id,
            row=row,
            candidate=deployed_candidate,
            now=now,
        )

        result = {
            "document_id": document_id,
            "replacement_id": candidate.get("id"),
            "canvas_file_id": canvas_file_id,
            "canvas_url": canvas_url,
            "selected_reference_count": len(selected_references),
            "revisions": revisions,
        }
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_replacement_deployed",
            properties=result,
        )
    except Exception as exc:
        logger.exception("Document replacement deployment failed for document_id=%s", document_id)
        try:
            row = get_session_document_row(supabase, session_id, user_id, document_id)
            candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else {}
            if isinstance(candidate, dict):
                now = datetime.now(timezone.utc).isoformat()
                failed_candidate = {
                    **candidate,
                    "canvas_deployment": {
                        **(candidate.get("canvas_deployment") if isinstance(candidate.get("canvas_deployment"), dict) else {}),
                        "status": "failed",
                        "job_id": job_id,
                        "error_message": str(exc),
                    },
                }
                persist_replacement_candidate(
                    supabase,
                    session_id=session_id,
                    user_id=user_id,
                    row=row,
                    candidate=failed_candidate,
                    now=now,
                )
        except Exception:
            logger.exception("Failed to persist replacement deployment failure state")
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()


def ensure_canvas_archive_folder(client: CanvasClient, canvas_course_id: str) -> dict[str, Any]:
    folder_name = "CanvasCurate Archive"
    root_folder = client.get(f"/courses/{quote(canvas_course_id, safe='')}/folders/root")
    root_folder_id = root_folder.get("id")
    if root_folder_id is None:
        raise ValueError("Canvas root folder did not return an id")

    folders = client.get_paginated(f"/courses/{quote(canvas_course_id, safe='')}/folders")
    for folder in folders:
        if (
            str(folder.get("name") or "").strip().lower() == folder_name.lower()
            and str(folder.get("parent_folder_id") or "") == str(root_folder_id)
        ):
            return folder
    return client.post_form(
        f"/folders/{quote(str(root_folder_id), safe='')}/folders",
        {"name": folder_name},
    )


def run_document_file_archive_job(
    job_id: str,
    session_id: str,
    user_id: str,
    document_id: str,
):
    supabase = get_supabase()
    started_at = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    client: CanvasClient | None = None
    try:
        row = get_session_document_row(supabase, session_id, user_id, document_id)
        canvas_file_id = str(row.get("canvas_id") or "")
        if not canvas_file_id:
            raise ValueError("Document is not linked to a Canvas file")
        candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else {}
        deployment = candidate.get("canvas_deployment") if isinstance(candidate.get("canvas_deployment"), dict) else {}
        if deployment.get("status") != "succeeded" or document_has_active_canvas_placement(row):
            raise ValueError("Only originals with a deployed replacement and no active references or module placement can be archived")

        course = canvas_course_connection(supabase, session_id, user_id)
        canvas_base_url = course["canvas_base_url"]
        canvas_course_id = str(course["canvas_course_id"])
        pat_token = get_active_pat(supabase, user_id, canvas_base_url)
        client = CanvasClient(canvas_base_url, pat_token)
        archive_folder = ensure_canvas_archive_folder(client, canvas_course_id)
        archive_folder_id = archive_folder.get("id")
        if archive_folder_id is None:
            raise ValueError("Canvas archive folder did not return an id")

        file_row = client.put_form(
            f"/files/{quote(canvas_file_id, safe='')}",
            {
                "parent_folder_id": str(archive_folder_id),
                "on_duplicate": "rename",
            },
        )
        now = datetime.now(timezone.utc).isoformat()
        folder = file_row.get("folder") if isinstance(file_row.get("folder"), dict) else archive_folder
        archive_state = {
            "status": "succeeded",
            "job_id": job_id,
            "archived_at": now,
            "canvas_file_id": canvas_file_id,
            "folder_id": file_row.get("folder_id") or archive_folder_id,
            "folder_name": folder.get("name") or archive_folder.get("name"),
            "folder_path": folder.get("full_name") or archive_folder.get("full_name"),
        }
        item_result = supabase.table("course_content_items").select(
            "metadata"
        ).eq("id", row["id"]).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        item_metadata = item_result.data[0].get("metadata") if item_result.data else {}
        current_metadata = item_metadata if isinstance(item_metadata, dict) else {}
        next_metadata = {
            **current_metadata,
            "folder_id": archive_state["folder_id"],
            "folder_name": archive_state["folder_name"],
            "folder_path": archive_state["folder_path"],
            "canvas_archive": archive_state,
        }
        supabase.table("course_content_items").update({
            "metadata": next_metadata,
            "updated_at": now,
            "last_canvas_edit_at": file_row.get("updated_at") or now,
        }).eq("id", row["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
        supabase.table("content_inventory_decisions").update({
            "action": "delete",
            "reason": "Original file moved to CanvasCurate Archive after replacement",
            "applied_to_canvas": True,
            "applied_at": now,
            "updated_at": now,
        }).eq("session_id", session_id).eq("user_id", user_id).eq(
            "content_item_id", row["id"]
        ).execute()

        result = {
            "document_id": row["id"],
            "canvas_file_id": canvas_file_id,
            "archive_folder_id": archive_state["folder_id"],
            "archive_folder_name": archive_state["folder_name"],
            "archive_folder_path": archive_state["folder_path"],
        }
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_original_archived",
            properties=result,
        )
    except Exception as exc:
        logger.exception("Document archive failed for document_id=%s", document_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
    finally:
        if client is not None:
            client.close()
