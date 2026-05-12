"""AI helpers for editor-owned routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from ai_image_text import generate_course_html, generate_rewritten_text, is_ai_configured
from api.editor.schemas import AIGenerateRequest, AIRewriteRequest
from services.document_records import get_owned_session
from supabase_client import get_supabase


logger = logging.getLogger(__name__)


def rewrite_selected_text(
    *,
    session_id: str,
    user_id: str,
    body: AIRewriteRequest,
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="CREATE_AI_API_KEY is not configured")
    try:
        return {
            "status": "ok",
            "result": generate_rewritten_text(
                text=body.text,
                instruction=body.instruction,
                context=body.context,
            ),
        }
    except Exception as exc:
        logger.exception("AI rewrite failed")
        raise HTTPException(status_code=502, detail=f"AI service error: {exc}")


def generate_editor_content(
    *,
    session_id: str,
    user_id: str,
    body: AIGenerateRequest,
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="CREATE_AI_API_KEY is not configured")
    try:
        return {
            "status": "ok",
            "html": generate_course_html(
                prompt=body.prompt,
                context=body.context,
                additional_context=body.additional_context,
            ),
        }
    except Exception as exc:
        logger.exception("AI generation failed")
        raise HTTPException(status_code=502, detail=f"AI service error: {exc}")
