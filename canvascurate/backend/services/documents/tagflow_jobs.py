"""Document TagFlow background job wrappers."""

from __future__ import annotations

from fastapi import BackgroundTasks

from services.document_records import get_owned_session, update_document_remediation_metadata
from services.documents.inventory import get_session_document_row
from tagflow_ai import (
    queue_tagflow_ai_suggestion_job as queue_tagflow_ai_suggestion_job_service,
    run_tagflow_ai_suggestion_job as run_tagflow_ai_suggestion_job_service,
)


def queue_tagflow_ai_suggestion_job(
    supabase,
    *,
    session_id: str,
    user_id: str,
    row: dict,
    page_numbers: list[int] | None = None,
    background_tasks: BackgroundTasks | None = None,
    max_pages: int | None = 10,
    skip_manual_pages: bool = False,
    skip_existing_suggestions: bool = False,
    auto_apply_to_draft: bool = False,
    run_inline: bool = False,
) -> str:
    return queue_tagflow_ai_suggestion_job_service(
        supabase,
        session_id=session_id,
        user_id=user_id,
        row=row,
        page_numbers=page_numbers,
        max_pages=max_pages,
        skip_manual_pages=skip_manual_pages,
        skip_existing_suggestions=skip_existing_suggestions,
        auto_apply_to_draft=auto_apply_to_draft,
        background_tasks=background_tasks,
        run_inline=run_inline,
        update_document_remediation_metadata=update_document_remediation_metadata,
        run_job=run_tagflow_ai_suggestion_job,
    )


def run_tagflow_ai_suggestion_job(job_id: str, session_id: str, user_id: str, document_id: str) -> None:
    run_tagflow_ai_suggestion_job_service(
        job_id,
        session_id,
        user_id,
        document_id,
        get_owned_session=get_owned_session,
        get_session_document_row=get_session_document_row,
        update_document_remediation_metadata=update_document_remediation_metadata,
    )
