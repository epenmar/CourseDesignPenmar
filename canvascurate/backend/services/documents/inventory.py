"""Document inventory retrieval, filtering, sorting, and count shaping.

Keeps the session document list route thin while the broader Canvas router is
gradually decomposed into feature services and focused API modules.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from content_inventory import build_document_inventory_rows
from services.content_bodies import fetch_content_html_by_item_id
from services.documents.standalone import standalone_document_rows
from services.images.text import IMAGE_TEXT_JOB_TYPE
from services.pdf_export.readiness import build_pdf_export_readiness


PDF_FIGURE_TEXT_JOB_TYPE = "pdf_figure_text_generate"
FILE_TYPE_KEYS = ("all", "pdf", "word", "powerpoint", "spreadsheet", "image", "other")


def document_has_active_canvas_placement(row: dict[str, Any]) -> bool:
    return bool(
        (row.get("linked_count") or 0) > 0
        or row.get("module_canvas_id")
        or row.get("module_name")
    )


def document_complexity_score(row: dict[str, Any]) -> dict[str, Any]:
    review = row.get("accessibility_review") if isinstance(row.get("accessibility_review"), dict) else {}
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else {}
    pdf_profile = remediation.get("pdf_profile") if isinstance(remediation.get("pdf_profile"), dict) else {}
    page_count = pdf_profile.get("page_count") or review.get("page_count") or row.get("page_count") or 0
    image_count = int(pdf_profile.get("image_count") or 0)
    table_count = int(pdf_profile.get("table_count") or 0)
    font_count = int(pdf_profile.get("font_count") or 0)
    raw_font_count = int(pdf_profile.get("raw_font_count") or 0)
    scanned_page_count = int(pdf_profile.get("scanned_page_count") or 0)
    column_signal = pdf_profile.get("column_signal") or "not_detected"
    max_columns = 2 if column_signal == "possible_layout_regions" else 1

    def score_factor(value: int | float, low_threshold: int, high_threshold: int) -> int:
        if value <= low_threshold:
            return 0
        if value >= high_threshold:
            return 100
        return int((value - low_threshold) / (high_threshold - low_threshold) * 100)

    page_count_int = int(page_count or 0)
    scanned_ratio = scanned_page_count / max(page_count_int, 1)
    factor_scores = {
        "pages": score_factor(page_count_int, 5, 20),
        "images": score_factor(image_count, 2, 10),
        "tables": score_factor(table_count, 0, 3),
        "fonts": score_factor(font_count, 2, 5),
        "columns": score_factor(max_columns, 1, 2),
        "scanned": int(scanned_ratio * 100),
    }
    weights = {
        "pages": 15,
        "images": 20,
        "tables": 20,
        "fonts": 15,
        "columns": 15,
        "scanned": 15,
    }

    factors = [
        {
            "key": "pages",
            "label": "Pages",
            "score": factor_scores["pages"],
            "detail": f"{page_count} page{'s' if page_count != 1 else ''}" if page_count else "Page count unavailable",
        },
        {
            "key": "images",
            "label": "Images",
            "score": factor_scores["images"],
            "detail": f"{image_count} image object{'s' if image_count != 1 else ''} detected" if pdf_profile else "Image count pending PDF profile",
        },
        {
            "key": "tables",
            "label": "Tables",
            "score": factor_scores["tables"],
            "detail": f"{table_count} tagged table signal{'s' if table_count != 1 else ''}" if pdf_profile else "Table count pending PDF profile",
        },
        {
            "key": "fonts",
            "label": "Fonts",
            "score": factor_scores["fonts"],
            "detail": f"{font_count} normalized font{'s' if font_count != 1 else ''} detected" + (f" ({raw_font_count} raw)" if raw_font_count and raw_font_count != font_count else "") if pdf_profile else "Font profile pending",
        },
        {
            "key": "columns",
            "label": "Columns",
            "score": factor_scores["columns"],
            "detail": "Possible multi-region layout" if column_signal == "possible_layout_regions" else ("No column signal detected" if pdf_profile else "Column signal pending PDF profile"),
        },
        {
            "key": "scanned",
            "label": "Scanned Pages",
            "score": factor_scores["scanned"],
            "detail": f"{scanned_page_count} scanned page{'s' if scanned_page_count != 1 else ''} estimated" if scanned_page_count else ("No scanned pages indicated" if pdf_profile else "Scanned-page signal pending PDF profile"),
        },
    ]
    score = min(100, sum(factor_scores[key] * weights[key] for key in factor_scores) // 100)
    if score <= 33:
        label = "Simple"
    elif score <= 66:
        label = "Moderate"
    else:
        label = "Complex"
    return {
        "score": score,
        "label": label,
        "factors": factors,
        "raw_counts": {
            "pages": page_count_int,
            "images": image_count,
            "tables": table_count,
            "fonts": font_count,
            "columns": max_columns,
            "scanned": scanned_page_count,
        },
    }


def pdf_review_type(row: dict[str, Any]) -> dict[str, Any] | None:
    if (row.get("extension") or "").lower() != "pdf" and row.get("mime_type") != "application/pdf":
        return None

    review = row.get("accessibility_review") if isinstance(row.get("accessibility_review"), dict) else None
    if not review:
        return None

    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else {}
    structural_tags = remediation.get("structural_tags") if isinstance(remediation.get("structural_tags"), dict) else {}
    issues = review.get("issues") if isinstance(review.get("issues"), list) else []
    issue_codes = {issue.get("code") for issue in issues if isinstance(issue, dict)}
    complexity = row.get("document_complexity") if isinstance(row.get("document_complexity"), dict) else document_complexity_score(row)
    complexity_label = str(complexity.get("label") or "").lower()
    page_count = review.get("page_count") or 0
    has_struct_tree = structural_tags.get("has_struct_tree")
    if has_struct_tree is None:
        has_struct_tree = review.get("has_struct_tree")

    if complexity_label == "complex" or "pdf_encrypted" in issue_codes or page_count >= 25 or len(issues) >= 3 or (has_struct_tree is False and page_count >= 5):
        return {
            "level": "complex",
            "label": "Complex",
            "detail": "Likely needs deeper remediation before export.",
        }
    if complexity_label == "moderate" or len(issues) > 0 or page_count >= 6:
        return {
            "level": "moderate",
            "label": "Moderate",
            "detail": "Review findings before moving into tag flow.",
        }
    return {
        "level": "simple",
        "label": "Simple",
        "detail": "Initial PDF review found a low-complexity remediation path.",
    }


def pdf_reviewed_at(row: dict[str, Any]) -> str | None:
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else {}
    if isinstance(remediation.get("extracted_at"), str):
        return remediation["extracted_at"]
    if (row.get("extension") or "").lower() == "pdf" or row.get("mime_type") == "application/pdf":
        return None
    analysis = row.get("document_analysis") if isinstance(row.get("document_analysis"), dict) else {}
    if isinstance(analysis.get("analyzed_at"), str):
        return analysis["analyzed_at"]
    return None


def document_findings_from_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    review = row.get("accessibility_review") if isinstance(row.get("accessibility_review"), dict) else {}
    for issue in review.get("issues") or []:
        findings.append({
            "code": issue.get("code") or "pdf_accessibility_signal",
            "severity": "high" if issue.get("code") in {"pdf_encrypted", "pdf_no_struct_tree"} else "medium",
            "message": issue.get("message") or "PDF accessibility issue detected.",
            "source": "initial_pdf_probe",
        })

    if row.get("filename_link_count"):
        findings.append({
            "code": "filename_link_text",
            "severity": "medium",
            "message": f"{row['filename_link_count']} course reference{'s use' if row['filename_link_count'] != 1 else ' uses'} filename-style link text.",
            "source": "course_reference_scan",
        })

    if not row.get("linked_count"):
        findings.append({
            "code": "unlinked_canvas_file",
            "severity": "low",
            "message": "No stored course content currently links to this file.",
            "source": "course_reference_scan",
        })

    if not findings and (row.get("extension") or "").lower() == "pdf":
        findings.append({
            "code": "no_initial_pdf_findings",
            "severity": "info",
            "message": "The initial PDF probe did not detect structural issues. A full remediation job can still perform deeper checks.",
            "source": "initial_pdf_probe",
        })
    elif not findings:
        findings.append({
            "code": "unsupported_file_type",
            "severity": "info",
            "message": "Document accessibility analysis is currently PDF-focused for this workflow.",
            "source": "document_inventory",
        })

    return findings


def build_document_analysis(row: dict[str, Any], *, analyzed_at: str) -> dict[str, Any]:
    findings = document_findings_from_row(row)
    blocking_count = sum(1 for finding in findings if finding.get("severity") in {"high", "critical"})
    return {
        "kind": "document_analysis",
        "status": "needs_review" if any(finding.get("severity") != "info" for finding in findings) else "passed_initial_check",
        "analyzed_at": analyzed_at,
        "document_id": row.get("id"),
        "canvas_file_id": row.get("canvas_id"),
        "filename": row.get("filename"),
        "complexity": document_complexity_score(row),
        "findings": findings,
        "summary": {
            "finding_count": len(findings),
            "blocking_count": blocking_count,
            "linked_count": row.get("linked_count") or 0,
            "filename_link_count": row.get("filename_link_count") or 0,
        },
    }


def normalize_document_analysis(row: dict[str, Any], analysis: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(analysis, dict):
        return build_document_analysis(row, analyzed_at=datetime.now(timezone.utc).isoformat())
    normalized = dict(analysis)
    normalized["complexity"] = document_complexity_score(row)
    summary = normalized.get("summary") if isinstance(normalized.get("summary"), dict) else {}
    normalized["summary"] = {
        **summary,
        "linked_count": row.get("linked_count") or 0,
        "filename_link_count": row.get("filename_link_count") or 0,
    }
    return normalized


def fetch_session_items_and_bodies(
    supabase,
    session_id: str,
    user_id: str,
    content_types: list[str] | None = None,
) -> tuple[list[dict], dict[str, str]]:
    query = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, module_canvas_id, module_name, published, is_orphaned, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id)
    if content_types:
        query = query.in_("content_type", content_types)

    item_result = query.execute()
    items = item_result.data or []
    html_body_content_types = {"page", "assignment", "discussion", "quiz", "quiz_question"}
    item_ids = [
        item["id"]
        for item in items
        if item.get("id") and item.get("content_type") in html_body_content_types
    ]
    body_by_item_id = fetch_content_html_by_item_id(supabase, item_ids)
    return items, body_by_item_id


DOCUMENT_INVENTORY_JOB_TYPES = [
    "document_analysis",
    "document_remediation",
    "document_structure_preview",
    "tagflow_ai_suggestions",
    "pdf_export",
    IMAGE_TEXT_JOB_TYPE,
    PDF_FIGURE_TEXT_JOB_TYPE,
    "standalone_document_canvas_deploy",
    "document_replacement_deploy",
    "document_file_archive",
]


def document_job_summaries_by_document(
    supabase,
    *,
    session_id: str,
    user_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    document_keys_by_row_id: dict[str, set[str]] = {}
    all_document_keys: set[str] = set()
    for row in rows:
        row_id = str(row.get("id") or "")
        if not row_id:
            continue
        keys = {row_id}
        canvas_id = str(row.get("canvas_id") or "")
        if canvas_id:
            keys.add(canvas_id)
        document_keys_by_row_id[row_id] = keys
        all_document_keys.update(keys)
    if not all_document_keys:
        return {}

    result = supabase.table("background_jobs").select(
        "id, job_type, status, payload, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "job_type", DOCUMENT_INVENTORY_JOB_TYPES
    ).order("queued_at", desc=True).limit(300).execute()

    jobs_by_document_key: dict[str, list[dict[str, Any]]] = {}
    for job in result.data or []:
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        keys = {
            str(payload.get("document_id") or ""),
            str(payload.get("canvas_file_id") or ""),
        }
        keys = {key for key in keys if key in all_document_keys}
        if not keys:
            continue
        summary_payload = {
            key: payload.get(key)
            for key in ("document_id", "canvas_file_id", "page_limit", "max_pages", "filename", "scope")
            if payload.get(key) is not None
        }
        if isinstance(payload.get("page_numbers"), list):
            summary_payload["page_count"] = len(payload["page_numbers"])
        summary = {
            "id": job.get("id"),
            "job_type": job.get("job_type"),
            "status": job.get("status"),
            "payload": summary_payload,
            "error_message": job.get("error_message"),
            "queued_at": job.get("queued_at"),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
        }
        for key in keys:
            jobs_by_document_key.setdefault(key, []).append(summary)

    by_row_id: dict[str, list[dict[str, Any]]] = {}
    seen_by_row_id: dict[str, set[str]] = {}
    for row_id, keys in document_keys_by_row_id.items():
        merged: list[dict[str, Any]] = []
        seen = seen_by_row_id.setdefault(row_id, set())
        for key in keys:
            for job in jobs_by_document_key.get(key, []):
                job_id = str(job.get("id") or "")
                if not job_id or job_id in seen:
                    continue
                merged.append(job)
                seen.add(job_id)
        if merged:
            merged.sort(key=lambda job: str(job.get("queued_at") or ""), reverse=True)
            by_row_id[row_id] = merged[:10]
    return by_row_id


def session_document_rows(supabase, session_id: str, user_id: str) -> list[dict[str, Any]]:
    items, body_by_item_id = fetch_session_items_and_bodies(
        supabase,
        session_id,
        user_id,
        None,
    )
    rows = build_document_inventory_rows(items, body_by_item_id)
    rows.extend(standalone_document_rows(supabase, session_id, user_id))
    decision_result = supabase.table("content_inventory_decisions").select(
        "id, content_item_id, action, reason, applied_to_canvas, applied_at, created_at, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    decision_by_item_id = {
        row["content_item_id"]: row
        for row in decision_result.data or []
        if row.get("content_item_id")
    }
    image_result = supabase.table("course_images").select(
        "canvas_file_id"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    embedded_image_file_ids = {
        str(row.get("canvas_file_id"))
        for row in image_result.data or []
        if row.get("canvas_file_id") is not None
    }
    replacement_jobs = supabase.table("background_jobs").select(
        "id, status, payload, result, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", "document_replacement_deploy"
    ).order("queued_at", desc=True).limit(100).execute()
    replacement_by_source_canvas_id: dict[str, dict[str, Any]] = {}
    replacement_by_new_canvas_id: dict[str, dict[str, Any]] = {}
    for job in replacement_jobs.data or []:
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        result = job.get("result") if isinstance(job.get("result"), dict) else {}
        source_canvas_id = str(payload.get("canvas_file_id") or "")
        new_canvas_id = str(result.get("canvas_file_id") or "")
        deployment = {
            "status": job.get("status"),
            "canvas_file_id": result.get("canvas_file_id"),
            "canvas_url": result.get("canvas_url"),
            "job_id": job.get("id"),
            "queued_at": job.get("queued_at"),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
            "selected_reference_count": result.get("selected_reference_count"),
            "revision_count": len(result.get("revisions") or []),
        }
        replacement_info = {
            "id": payload.get("replacement_id"),
            "status": "deployed_to_canvas_file" if job.get("status") == "succeeded" else job.get("status"),
            "canvas_deployment": deployment,
        }
        if source_canvas_id and source_canvas_id not in replacement_by_source_canvas_id:
            replacement_by_source_canvas_id[source_canvas_id] = replacement_info
        if new_canvas_id and new_canvas_id not in replacement_by_new_canvas_id:
            replacement_by_new_canvas_id[new_canvas_id] = {
                **replacement_info,
                "source_canvas_file_id": source_canvas_id or None,
            }
    job_summaries = document_job_summaries_by_document(
        supabase,
        session_id=session_id,
        user_id=user_id,
        rows=rows,
    )
    for row in rows:
        metadata = next((item.get("metadata") for item in items if item.get("id") == row.get("id")), None)
        inventory_decision = decision_by_item_id.get(str(row.get("id")))
        row["inventory_decision"] = inventory_decision
        row["decision_action"] = inventory_decision.get("action") if inventory_decision else None
        row["decision_reason"] = inventory_decision.get("reason") if inventory_decision else None
        if isinstance(metadata, dict) and isinstance(metadata.get("document_remediation"), dict):
            row["document_remediation"] = metadata["document_remediation"]
            row["document_remediation"]["export_readiness"] = build_pdf_export_readiness(row["document_remediation"])
        if isinstance(metadata, dict) and isinstance(metadata.get("document_analysis"), dict):
            row["document_analysis"] = normalize_document_analysis(row, metadata["document_analysis"])
        if isinstance(metadata, dict) and isinstance(metadata.get("replacement_candidate"), dict):
            row["replacement_candidate"] = metadata["replacement_candidate"]
        canvas_id = str(row.get("canvas_id") or "")
        if canvas_id and not row.get("replacement_candidate") and canvas_id in replacement_by_source_canvas_id:
            row["replacement_candidate"] = replacement_by_source_canvas_id[canvas_id]
            row["replacement_status"] = replacement_by_source_canvas_id[canvas_id].get("status")
            deployment = replacement_by_source_canvas_id[canvas_id].get("canvas_deployment") or {}
            row["replacement_canvas_file_id"] = deployment.get("canvas_file_id")
            row["replacement_canvas_url"] = deployment.get("canvas_url")
        if canvas_id and canvas_id in replacement_by_new_canvas_id:
            row["is_replacement_file"] = True
            row["source_canvas_file_id"] = replacement_by_new_canvas_id[canvas_id].get("source_canvas_file_id")
        row["non_embedded_image_file"] = bool(
            row.get("is_image_file")
            and (not row.get("canvas_id") or str(row.get("canvas_id")) not in embedded_image_file_ids)
        )
        row["document_complexity"] = document_complexity_score(row)
        row["pdf_review_type"] = pdf_review_type(row)
        row["pdf_reviewed_at"] = pdf_reviewed_at(row)
        row["document_jobs"] = job_summaries.get(str(row.get("id") or ""), [])
    return rows


def get_session_document_row(supabase, session_id: str, user_id: str, document_id: str) -> dict[str, Any]:
    for row in session_document_rows(supabase, session_id, user_id):
        if row.get("id") == document_id or row.get("canvas_id") == document_id:
            return row
    raise HTTPException(status_code=404, detail="Document not found")


def document_replacement_deployed(row: dict[str, Any]) -> bool:
    candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else {}
    deployment = candidate.get("canvas_deployment") if isinstance(candidate.get("canvas_deployment"), dict) else {}
    return deployment.get("status") == "succeeded"


def document_archived(row: dict[str, Any]) -> bool:
    archive = row.get("canvas_archive") if isinstance(row.get("canvas_archive"), dict) else {}
    return archive.get("status") == "succeeded"


def document_matches_status_filter(row: dict[str, Any], status: str) -> bool:
    if status == "all":
        return True
    if status == "linked":
        return (row.get("linked_count") or 0) > 0
    if status == "unlinked":
        return (row.get("linked_count") or 0) == 0
    if status == "filename_links":
        return (row.get("filename_link_count") or 0) > 0
    if status == "replacement_deployed":
        return document_replacement_deployed(row)
    if status == "ready_to_archive":
        return document_replacement_deployed(row) and not document_has_active_canvas_placement(row) and not document_archived(row)
    if status == "still_placed":
        return document_replacement_deployed(row) and document_has_active_canvas_placement(row) and not document_archived(row)
    if status == "cleanup_marked":
        return document_replacement_deployed(row) and row.get("decision_action") == "delete" and not document_archived(row)
    if status == "archived":
        return document_archived(row)
    return True


def document_file_type(row: dict[str, Any]) -> str:
    extension = str(row.get("extension") or "").lower().lstrip(".")
    mime_type = str(row.get("mime_type") or "").lower()
    if extension == "pdf" or mime_type == "application/pdf":
        return "pdf"
    if extension in {"doc", "docx"} or "word" in mime_type:
        return "word"
    if extension in {"ppt", "pptx"} or "presentation" in mime_type or "powerpoint" in mime_type:
        return "powerpoint"
    if extension in {"csv", "xls", "xlsx"} or "spreadsheet" in mime_type or "excel" in mime_type or mime_type == "text/csv":
        return "spreadsheet"
    if extension in {"apng", "avif", "gif", "jpg", "jpeg", "png", "svg", "webp"} or mime_type.startswith("image/"):
        return "image"
    return "other"


def document_inventory_name(row: dict[str, Any]) -> str:
    return str(row.get("title") or row.get("filename") or "").casefold()


def sort_document_inventory_rows(rows: list[dict[str, Any]], sort: str) -> None:
    if sort == "name_asc":
        rows.sort(key=lambda row: (document_inventory_name(row), row.get("folder_path") or ""))
        return
    if sort == "name_desc":
        rows.sort(key=lambda row: (document_inventory_name(row), row.get("folder_path") or ""), reverse=True)
        return
    rows.sort(
        key=lambda row: (
            0 if row.get("filename_link_count", 0) else 1,
            0 if row.get("linked_count", 0) else 1,
            row.get("folder_path") or "",
            row.get("title") or row.get("filename") or "",
        )
    )


def document_inventory_status_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    linked_count = sum(1 for row in rows if row.get("linked_count", 0) > 0)
    return {
        "all": len(rows),
        "linked": linked_count,
        "unlinked": len(rows) - linked_count,
        "filename_links": sum(1 for row in rows if row.get("filename_link_count", 0) > 0),
        "replacement_deployed": sum(1 for row in rows if document_replacement_deployed(row)),
        "ready_to_archive": sum(
            1 for row in rows
            if document_replacement_deployed(row) and not document_has_active_canvas_placement(row) and not document_archived(row)
        ),
        "still_placed": sum(
            1 for row in rows
            if document_replacement_deployed(row) and document_has_active_canvas_placement(row) and not document_archived(row)
        ),
        "cleanup_marked": sum(
            1 for row in rows
            if document_replacement_deployed(row) and row.get("decision_action") == "delete" and not document_archived(row)
        ),
        "archived": sum(1 for row in rows if document_archived(row)),
    }


def document_inventory_file_type_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = {key: 0 for key in FILE_TYPE_KEYS}
    counts["all"] = len(rows)
    for row in rows:
        file_type = document_file_type(row)
        counts[file_type] = counts.get(file_type, 0) + 1
    return counts


def filter_document_inventory_rows(
    rows: list[dict[str, Any]],
    *,
    q: str | None,
    file_type: str,
    status: str,
    sort: str,
) -> dict[str, Any]:
    normalized_query = q.strip().lower() if q else ""
    query_filtered = []
    for row in rows:
        haystack = " ".join([
            row.get("title") or "",
            row.get("filename") or "",
            row.get("extension") or "",
            row.get("mime_type") or "",
            row.get("folder_name") or "",
            row.get("folder_path") or "",
        ]).lower()
        if normalized_query and normalized_query not in haystack:
            continue
        query_filtered.append(row)

    file_type_filtered = [
        row for row in query_filtered
        if file_type == "all" or document_file_type(row) == file_type
    ]
    filtered = [
        row for row in file_type_filtered
        if document_matches_status_filter(row, status)
    ]
    sort_document_inventory_rows(filtered, sort)

    return {
        "rows": filtered,
        "counts": document_inventory_status_counts(file_type_filtered),
        "file_type_counts": document_inventory_file_type_counts(query_filtered),
    }
