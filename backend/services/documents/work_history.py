"""Document work-history read model helpers."""

from __future__ import annotations

import time
from typing import Any

from content_inventory import compact_whitespace
from services.images.text import IMAGE_TEXT_JOB_TYPE
from services.pdf_export.readiness import build_pdf_export_readiness


DOCUMENT_WORK_EVENT_TYPES = {
    "standalone_document_uploaded",
    "standalone_document_remediation_queued",
    "standalone_document_canvas_deploy_queued",
    "standalone_document_canvas_deployed",
    "document_analysis_queued",
    "document_remediation_queued",
    "document_remediation_completed",
    "document_structure_preview_queued",
    "document_structure_preview_completed",
    "document_tagflow_zones_updated",
    "document_pdf_export_queued",
    "document_pdf_export_prepared",
    "document_replacement_uploaded",
    "document_replacement_references_reviewed",
    "document_replacement_deploy_queued",
    "document_replacement_deployed",
    "document_original_archive_queued",
    "document_original_archived",
}


def document_work_history_job_entry(
    *,
    row: dict[str, Any],
    user_id: str,
    session_id: str,
    job: dict[str, Any],
) -> dict[str, Any]:
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    job_type = job.get("job_type") or "background_job"
    status = job.get("status") or "unknown"
    occurred_at = job.get("finished_at") or job.get("started_at") or job.get("queued_at")

    if job_type == "document_analysis":
        analysis = result.get("analysis") if isinstance(result.get("analysis"), dict) else {}
        summary = analysis.get("summary") if isinstance(analysis.get("summary"), dict) else {}
        finding_count = summary.get("finding_count")
        label = "Document analysis"
        detail = f"{finding_count} finding{'s' if finding_count != 1 else ''}" if isinstance(finding_count, int) else f"Analysis {status}"
    elif job_type == "document_remediation":
        remediation = result.get("remediation_plan") if isinstance(result.get("remediation_plan"), dict) else {}
        metadata = remediation.get("metadata") if isinstance(remediation.get("metadata"), dict) else {}
        structural_tags = remediation.get("structural_tags") if isinstance(remediation.get("structural_tags"), dict) else {}
        populated = sum(1 for key in ("title", "language", "author", "keywords") if metadata.get(key))
        label = "PDF remediation plan"
        heading_count = structural_tags.get("heading_tag_count") or 0
        structure_count = structural_tags.get("structure_tag_count") or 0
        detail = f"{populated} metadata field{'s' if populated != 1 else ''}, {heading_count} heading tag{'s' if heading_count != 1 else ''}, {structure_count} structure element{'s' if structure_count != 1 else ''}"
    elif job_type == "document_structure_preview":
        generated_count = result.get("generated_page_count")
        failed_count = result.get("failed_page_count")
        label = "TagFlow preview assets"
        detail = f"{generated_count or 0} generated, {failed_count or 0} failed"
    elif job_type == "pdf_export":
        label = "Tagged PDF export"
        export_status = result.get("export_status") or status
        if export_status == "generator_pending":
            detail = "Export model prepared; PDF generator pending"
        else:
            detail = f"Export {export_status}"
    elif job_type == "document_replacement_deploy":
        selected_count = result.get("selected_reference_count") or len(payload.get("selected_references") or [])
        revision_count = len(result.get("revisions") or [])
        label = "Replacement deployment"
        detail = f"{selected_count} selected reference{'s' if selected_count != 1 else ''}, {revision_count} pending revision{'s' if revision_count != 1 else ''}"
    elif job_type == "document_file_archive":
        label = "Original archive"
        archive_path = result.get("archive_folder_path") or result.get("archive_folder_name") or payload.get("target_folder_name")
        detail = f"Moved to {archive_path}" if status == "succeeded" and archive_path else f"Archive {status}"
    elif job_type == "standalone_document_canvas_deploy":
        label = "Canvas file deployment"
        course_id = result.get("canvas_course_id") or payload.get("canvas_course_id")
        canvas_file_id = result.get("canvas_file_id")
        detail = f"Uploaded Canvas file {canvas_file_id}" if canvas_file_id else f"Deployment to course {course_id or ''} {status}".strip()
    else:
        label = str(job_type).replace("_", " ").title()
        detail = f"Job {status}"

    if job.get("error_message"):
        detail = str(job["error_message"])

    return {
        "id": f"job:{job.get('id')}",
        "occurred_at": occurred_at,
        "actor_user_id": user_id,
        "session_id": session_id,
        "document_id": row.get("id"),
        "canvas_file_id": row.get("canvas_id"),
        "type": job_type,
        "status": status,
        "label": label,
        "summary": detail,
        "source_table": "background_jobs",
        "source_id": job.get("id"),
        "metadata": {
            "payload": payload,
            "result": result,
            "error_message": job.get("error_message"),
        },
    }


def document_work_history_decision_entry(
    *,
    row: dict[str, Any],
    user_id: str,
    session_id: str,
) -> dict[str, Any] | None:
    decision = row.get("inventory_decision") if isinstance(row.get("inventory_decision"), dict) else None
    if not decision:
        return None
    action = decision.get("action") or "reviewed"
    status = "applied" if decision.get("applied_to_canvas") else "saved"
    action_label = "cleanup" if action == "delete" else action
    summary = f"Marked {action_label}"
    if decision.get("reason"):
        summary = f"{summary}: {decision['reason']}"
    return {
        "id": f"decision:{decision.get('id')}",
        "occurred_at": decision.get("updated_at") or decision.get("created_at"),
        "actor_user_id": user_id,
        "session_id": session_id,
        "document_id": row.get("id"),
        "canvas_file_id": row.get("canvas_id"),
        "type": "inventory_decision",
        "status": status,
        "label": "Inventory decision",
        "summary": summary,
        "source_table": "content_inventory_decisions",
        "source_id": decision.get("id"),
        "metadata": decision,
    }


def document_work_history_event_entry(
    *,
    row: dict[str, Any],
    user_id: str,
    session_id: str,
    event: dict[str, Any],
) -> dict[str, Any] | None:
    properties = event.get("properties") if isinstance(event.get("properties"), dict) else {}
    document_ids = {str(row.get("id") or "")}
    canvas_file_ids = {str(row.get("canvas_id") or "")}
    if str(properties.get("document_id") or "") not in document_ids and str(properties.get("canvas_file_id") or "") not in canvas_file_ids:
        return None

    event_type = event.get("event_type") or "platform_event"
    label_by_type = {
        "standalone_document_uploaded": "Document uploaded",
        "standalone_document_remediation_queued": "PDF review queued",
        "standalone_document_canvas_deploy_queued": "Canvas deployment queued",
        "standalone_document_canvas_deployed": "Canvas deployment completed",
        "document_analysis_queued": "Analysis queued",
        "document_remediation_queued": "Remediation queued",
        "document_remediation_completed": "Remediation plan completed",
        "document_structure_preview_queued": "Structure preview queued",
        "document_structure_preview_completed": "Structure preview completed",
        "document_tagflow_zones_updated": "TagFlow zones updated",
        "document_pdf_export_queued": "PDF export queued",
        "document_pdf_export_prepared": "PDF export prepared",
        "document_replacement_uploaded": "Replacement uploaded",
        "document_replacement_references_reviewed": "References reviewed",
        "document_replacement_deploy_queued": "Deployment queued",
        "document_replacement_deployed": "Replacement deployed",
        "document_original_archive_queued": "Archive queued",
        "document_original_archived": "Original archived",
    }
    summary_by_type = {
        "standalone_document_uploaded": f"Uploaded {properties.get('filename') or row.get('filename') or 'document'}",
        "standalone_document_remediation_queued": f"Queued {properties.get('queued_job_count') or 0} preparation job{'s' if (properties.get('queued_job_count') or 0) != 1 else ''}",
        "standalone_document_canvas_deploy_queued": f"Queued Canvas deployment to course {properties.get('canvas_course_id') or ''}".strip(),
        "standalone_document_canvas_deployed": f"Uploaded Canvas file {properties.get('canvas_file_id') or ''}".strip(),
        "document_analysis_queued": f"Queued analysis for {properties.get('filename') or row.get('filename') or 'document'}",
        "document_remediation_queued": f"Queued PDF metadata extraction for {properties.get('filename') or row.get('filename') or 'document'}",
        "document_remediation_completed": f"Extracted {properties.get('metadata_field_count') or 0} metadata field{'s' if (properties.get('metadata_field_count') or 0) != 1 else ''}",
        "document_structure_preview_queued": f"Queued {properties.get('page_count') or 0} TagFlow preview page{'s' if (properties.get('page_count') or 0) != 1 else ''}",
        "document_structure_preview_completed": f"Generated {properties.get('generated_page_count') or 0} TagFlow preview page{'s' if (properties.get('generated_page_count') or 0) != 1 else ''}",
        "document_tagflow_zones_updated": f"Updated {properties.get('zone_count') or 0} zone{'s' if (properties.get('zone_count') or 0) != 1 else ''} on page {properties.get('page_number') or ''}".strip(),
        "document_pdf_export_queued": f"Queued PDF export with {properties.get('warning_count') or 0} warning{'s' if (properties.get('warning_count') or 0) != 1 else ''}",
        "document_pdf_export_prepared": f"Prepared export model with {properties.get('page_count') or 0} page{'s' if (properties.get('page_count') or 0) != 1 else ''} and {properties.get('zone_count') or 0} zone{'s' if (properties.get('zone_count') or 0) != 1 else ''}",
        "document_replacement_uploaded": f"Uploaded {properties.get('filename') or 'replacement file'}",
        "document_replacement_references_reviewed": f"Reviewed {properties.get('linked_count') or 0} reference{'s' if (properties.get('linked_count') or 0) != 1 else ''}",
        "document_replacement_deploy_queued": f"Queued deployment for {properties.get('selected_reference_count') or 0} reference{'s' if (properties.get('selected_reference_count') or 0) != 1 else ''}",
        "document_replacement_deployed": f"Uploaded replacement Canvas file {properties.get('canvas_file_id') or ''}".strip(),
        "document_original_archive_queued": "Queued original file archive",
        "document_original_archived": f"Archived to {properties.get('archive_folder_path') or properties.get('archive_folder_name') or 'CanvasCurate Archive'}",
    }
    return {
        "id": f"event:{event.get('id')}",
        "occurred_at": event.get("created_at"),
        "actor_user_id": user_id,
        "session_id": session_id,
        "document_id": row.get("id"),
        "canvas_file_id": row.get("canvas_id"),
        "type": event_type,
        "status": "recorded",
        "label": label_by_type.get(event_type, str(event_type).replace("_", " ").title()),
        "summary": summary_by_type.get(event_type, "Recorded platform event"),
        "source_table": "platform_events",
        "source_id": event.get("id"),
        "metadata": properties,
    }


def build_document_work_history(
    *,
    row: dict[str, Any],
    user_id: str,
    session_id: str,
    document_jobs: list[dict[str, Any]],
    deployment_history: list[dict[str, Any]],
    archive_history: list[dict[str, Any]],
    platform_events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for job in [*document_jobs, *deployment_history, *archive_history]:
        entries.append(document_work_history_job_entry(row=row, user_id=user_id, session_id=session_id, job=job))

    decision_entry = document_work_history_decision_entry(row=row, user_id=user_id, session_id=session_id)
    if decision_entry:
        entries.append(decision_entry)

    for event in platform_events:
        entry = document_work_history_event_entry(row=row, user_id=user_id, session_id=session_id, event=event)
        if entry:
            entries.append(entry)

    entries.sort(key=lambda entry: entry.get("occurred_at") or "", reverse=True)
    return entries
