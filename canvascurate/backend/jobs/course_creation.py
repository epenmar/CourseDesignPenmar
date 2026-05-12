"""Course Creation background jobs."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from ai_image_text import generate_course_creation_outline
from r2_storage import download_bytes
from services.course_creation.extraction import extract_course_source
from services.course_creation.projects import (
    COURSE_CREATION_DRAFT_JOB_TYPE,
    COURSE_CREATION_EXTRACT_JOB_TYPE,
    COURSE_CREATION_OUTLINE_JOB_TYPE,
    get_course_creation_source,
    get_owned_course_creation_session,
    list_course_creation_sources,
    project_setup_from_meta,
    course_creation_meta,
    update_course_creation_project_data,
    write_extraction_artifact,
    write_outline_debug_artifact,
)
from services.document_records import write_platform_event
from supabase_client import get_supabase


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ai_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    candidate = match.group(0) if match else cleaned
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as first_error:
        repaired = _repair_json(candidate)
        try:
            payload = json.loads(repaired)
        except json.JSONDecodeError as repaired_error:
            if not match:
                raise ValueError("AI response did not include JSON") from first_error
            raise repaired_error from first_error
    if not isinstance(payload, dict):
        raise ValueError("AI response JSON must be an object")
    return payload


def _repair_json(value: str) -> str:
    """Repair common LLM JSON slips without changing valid content."""
    repaired = value.strip()
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
    # Missing commas between object members or array values are the most common
    # failure mode for long outline responses.
    for _ in range(3):
        updated = re.sub(r'([}\]"])\s*\n\s*("[-A-Za-z0-9_]+":)', r"\1,\n\2", repaired)
        updated = re.sub(r'(")\s*\n\s*(")', r'\1,\n\2', updated)
        if updated == repaired:
            break
        repaired = updated
    return repaired


def _compact_text(value: Any, limit: int = 1600) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def _raw_response_excerpt(raw: str, error: Exception, *, radius: int = 1400) -> str:
    position = getattr(error, "pos", None)
    if not isinstance(position, int):
        return raw[: radius * 2]
    start = max(0, position - radius)
    end = min(len(raw), position + radius)
    prefix = f"... excerpt starts at character {start} ...\n" if start else ""
    suffix = f"\n... excerpt ends at character {end} of {len(raw)} ..." if end < len(raw) else ""
    return f"{prefix}{raw[start:end]}{suffix}"


def _chunk_page_number(chunk: dict[str, Any]) -> int:
    locator = chunk.get("source_locator") if isinstance(chunk.get("source_locator"), dict) else {}
    try:
        return int(locator.get("page") or 0)
    except (TypeError, ValueError):
        return 0


def _chunk_content_score(text: str) -> int:
    score = 0
    if re.search(r"\bCHAPTER\s+\d+\b", text, flags=re.IGNORECASE):
        score += 4
    if re.search(r"\b\d+\.\d+\s+[A-Z]", text):
        score += 3
    if "LEARNING OBJECTIVES" in text.upper():
        score += 3
    if re.search(r"\bKEY TERMS\b|\bCHAPTER SUMMARY\b|\bREVIEW QUESTIONS\b", text, flags=re.IGNORECASE):
        score += 1
    if text.upper().startswith(("PREFACE", "ABOUT OPENSTAX", "ACADEMIC INTEGRITY")):
        score -= 4
    chapter_hits = len(re.findall(r"\bCHAPTER\s+\d+\b", text, flags=re.IGNORECASE))
    if chapter_hits >= 4:
        score -= 6
    if len(text) < 120:
        score -= 2
    return score


def _is_noisy_front_matter(text: str, *, page_number: int, seen_content: bool) -> bool:
    upper = text.upper()
    if seen_content:
        return False
    if page_number and page_number <= 9:
        if (
            "PREFACE" in upper
            or "ABOUT OPENSTAX" in upper
            or "COVERAGE AND SCOPE" in upper
            or "ACADEMIC INTEGRITY" in upper
            or upper.startswith("ACCESS FOR FREE")
            or len(re.findall(r"\bCHAPTER\s+\d+\b", upper)) >= 3
        ):
            return True
    return _chunk_content_score(text) < 2


def _infer_chunk_title(chunk: dict[str, Any], text: str) -> str:
    chapter_match = re.search(
        r"\bCHAPTER\s+(\d+)\s+(.+?)(?=\s+\d+\.\d+|\s+LEARNING OBJECTIVES|\s+Introduction\b|$)",
        text,
        flags=re.IGNORECASE,
    )
    if chapter_match:
        title = _compact_text(chapter_match.group(2), 100)
        return f"Chapter {chapter_match.group(1)}: {title}" if title else f"Chapter {chapter_match.group(1)}"
    section_match = re.search(r"\b(\d+\.\d+)\s+([A-Z][A-Za-z0-9 ,:;()'/-]{4,90})", text)
    if section_match:
        return f"{section_match.group(1)} {section_match.group(2).strip()}"
    return _compact_text(chunk.get("title") or chunk.get("source_title"), 140)


def _normalized_source_chunk(raw: dict[str, Any], index: int) -> dict[str, Any]:
    chunk_id = _compact_text(raw.get("id"), 120) or f"source-chunk-{index}"
    content_types = raw.get("content_types") if isinstance(raw.get("content_types"), list) else []
    topics = raw.get("topics") if isinstance(raw.get("topics"), list) else []
    objectives = raw.get("learning_objectives") if isinstance(raw.get("learning_objectives"), list) else []
    confidence = raw.get("confidence")
    try:
        confidence_value = max(0.0, min(1.0, float(confidence))) if confidence is not None else None
    except (TypeError, ValueError):
        confidence_value = None
    return {
        "id": chunk_id,
        "source_id": _compact_text(raw.get("source_id"), 120),
        "source_title": _compact_text(raw.get("source_title"), 240),
        "summary": _compact_text(raw.get("summary"), 1200),
        "topics": [_compact_text(item, 140) for item in topics[:12] if _compact_text(item, 140)],
        "learning_objectives": [_compact_text(item, 240) for item in objectives[:8] if _compact_text(item, 240)],
        "recommended_use": _compact_text(raw.get("recommended_use"), 500),
        "content_types": [_compact_text(item, 40) for item in content_types[:8] if _compact_text(item, 40)],
        "confidence": confidence_value,
        "source_locator": raw.get("source_locator") if isinstance(raw.get("source_locator"), dict) else {},
    }


def _normalize_outline_item(raw: dict[str, Any], index: int) -> dict[str, Any]:
    source_ids = raw.get("source_chunk_ids") if isinstance(raw.get("source_chunk_ids"), list) else []
    return {
        "type": _compact_text(raw.get("type"), 40) or "page",
        "title": _compact_text(raw.get("title"), 180) or f"Draft item {index}",
        "purpose": _compact_text(raw.get("purpose"), 500),
        "source_chunk_ids": [_compact_text(item, 120) for item in source_ids[:20] if _compact_text(item, 120)],
    }


def _normalize_outline(raw: dict[str, Any], setup: dict[str, Any]) -> dict[str, Any]:
    outline = raw.get("outline") if isinstance(raw.get("outline"), dict) else raw
    modules = outline.get("modules") if isinstance(outline.get("modules"), list) else []
    normalized_modules = []
    for module_index, module in enumerate(modules[:40], start=1):
        if not isinstance(module, dict):
            continue
        objectives = module.get("objectives") if isinstance(module.get("objectives"), list) else []
        topics = module.get("topics") if isinstance(module.get("topics"), list) else []
        source_ids = module.get("source_chunk_ids") if isinstance(module.get("source_chunk_ids"), list) else []
        items = module.get("items") if isinstance(module.get("items"), list) else []
        normalized_modules.append({
            "id": _compact_text(module.get("id"), 80) or f"module-{module_index}",
            "title": _compact_text(module.get("title"), 180) or f"Module {module_index}",
            "overview": _compact_text(module.get("overview"), 1200),
            "objectives": [_compact_text(item, 240) for item in objectives[:10] if _compact_text(item, 240)],
            "topics": [_compact_text(item, 140) for item in topics[:16] if _compact_text(item, 140)],
            "estimated_workload": _compact_text(module.get("estimated_workload"), 160),
            "source_chunk_ids": [_compact_text(item, 120) for item in source_ids[:30] if _compact_text(item, 120)],
            "items": [
                _normalize_outline_item(item, item_index)
                for item_index, item in enumerate(items[:12], start=1)
                if isinstance(item, dict)
            ],
        })
    gaps = outline.get("gaps") if isinstance(outline.get("gaps"), list) else []
    assumptions = outline.get("assumptions") if isinstance(outline.get("assumptions"), list) else []
    return {
        "title": _compact_text(outline.get("title"), 180) or setup.get("course_title") or "New Course Build",
        "description": _compact_text(outline.get("description"), 1600) or setup.get("course_description") or "",
        "modules": normalized_modules,
        "gaps": [_compact_text(item, 300) for item in gaps[:20] if _compact_text(item, 300)],
        "assumptions": [_compact_text(item, 300) for item in assumptions[:20] if _compact_text(item, 300)],
    }


def _select_representative_outline_chunks(
    chunks: list[dict[str, Any]],
    setup: dict[str, Any],
    *,
    max_chars: int = 14000,
) -> list[dict[str, Any]]:
    if not chunks:
        return []
    requested_count = setup.get("module_count")
    try:
        module_count = int(requested_count) if requested_count else 0
    except (TypeError, ValueError):
        module_count = 0
    target_count = max(10, min(24, (module_count or 8) * 3, len(chunks)))
    if len(chunks) <= target_count:
        selected = chunks
    else:
        indices: set[int] = set()
        denominator = max(1, target_count - 1)
        for index in range(target_count):
            indices.add(round(index * (len(chunks) - 1) / denominator))
        chapter_start_indices = [
            index
            for index, chunk in enumerate(chunks)
            if int(chunk.get("content_score") or 0) >= 6
        ][: max(4, module_count or 8)]
        indices.update(chapter_start_indices)
        ordered_indices = sorted(indices)
        if len(ordered_indices) > target_count:
            ordered_indices = [
                ordered_indices[round(index * (len(ordered_indices) - 1) / max(1, target_count - 1))]
                for index in range(target_count)
            ]
        selected = [chunks[index] for index in ordered_indices]

    trimmed: list[dict[str, Any]] = []
    total_chars = 0
    for chunk in selected:
        text = _compact_text(chunk.get("text"), 650)
        if not text:
            continue
        projected = total_chars + len(text)
        if trimmed and projected > max_chars:
            break
        trimmed.append({**chunk, "text": text})
        total_chars = projected
    return trimmed or selected[:1]


def _source_chunks_for_outline(supabase, *, session_id: str, user_id: str, setup: dict[str, Any]) -> list[dict[str, Any]]:
    sources = list_course_creation_sources(supabase, session_id=session_id, user_id=user_id)
    chunks: list[dict[str, Any]] = []
    for source in sources:
        summary = source.get("extraction_summary") if isinstance(source.get("extraction_summary"), dict) else {}
        artifact_key = summary.get("artifact_key")
        if not artifact_key:
            continue
        try:
            data, _ = download_bytes(str(artifact_key))
            artifact = json.loads(data.decode("utf-8"))
        except Exception:
            continue
        artifact_chunks = artifact.get("chunks") if isinstance(artifact.get("chunks"), list) else []
        seen_content = False
        for chunk in artifact_chunks:
            if not isinstance(chunk, dict):
                continue
            text_preview = _compact_text(chunk.get("text_preview"), 1100)
            if not text_preview:
                continue
            page_number = _chunk_page_number(chunk)
            if _is_noisy_front_matter(text_preview, page_number=page_number, seen_content=seen_content):
                continue
            seen_content = True
            title = _infer_chunk_title(chunk, text_preview)
            chunks.append({
                "id": f"{source.get('id')}:{chunk.get('id') or len(chunks) + 1}",
                "source_id": source.get("id"),
                "source_title": source.get("filename"),
                "type": chunk.get("type"),
                "title": title,
                "text": text_preview,
                "page_number": page_number or None,
                "content_score": _chunk_content_score(text_preview),
                "source_locator": chunk.get("source_locator") if isinstance(chunk.get("source_locator"), dict) else {},
            })
    chunks.sort(key=lambda item: (_chunk_page_number(item), _compact_text(item.get("id"), 120)))
    return _select_representative_outline_chunks(chunks, setup)


def _fallback_source_analysis(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks[:24], start=1):
        text = _compact_text(chunk.get("text"), 1200)
        title = _compact_text(chunk.get("title") or chunk.get("source_title"), 180)
        topic = title or f"Source topic {index}"
        items.append({
            "id": _compact_text(chunk.get("id"), 120) or f"source-chunk-{index}",
            "source_id": _compact_text(chunk.get("source_id"), 120),
            "source_title": _compact_text(chunk.get("source_title"), 240),
            "summary": text[:700] or topic,
            "topics": [topic],
            "learning_objectives": [],
            "recommended_use": "Use this source chunk while reviewing and refining the generated course outline.",
            "content_types": ["page"],
            "confidence": None,
            "source_locator": chunk.get("source_locator") if isinstance(chunk.get("source_locator"), dict) else {},
        })
    return items


def _fallback_outline(setup: dict[str, Any], chunks: list[dict[str, Any]], warning: str | None = None) -> dict[str, Any]:
    requested_count = setup.get("module_count")
    try:
        module_count = int(requested_count) if requested_count else 0
    except (TypeError, ValueError):
        module_count = 0
    if module_count <= 0:
        module_count = min(8, max(1, len(chunks)))
    module_count = max(1, min(40, module_count))
    modules: list[dict[str, Any]] = []
    group_size = max(1, (len(chunks) + module_count - 1) // module_count)
    chunk_groups = [
        chunks[index * group_size:(index + 1) * group_size]
        for index in range(module_count)
    ]
    for index, group in enumerate(chunk_groups, start=1):
        primary = group[0] if group else {}
        topic = _compact_text(primary.get("title") or primary.get("source_title"), 140) or f"Module {index}"
        source_ids = [
            _compact_text(chunk.get("id"), 120)
            for chunk in group[:10]
            if _compact_text(chunk.get("id"), 120)
        ]
        overview_seed = " ".join(
            _compact_text(chunk.get("text"), 260)
            for chunk in group[:3]
            if _compact_text(chunk.get("text"), 260)
        )
        modules.append({
            "id": f"module-{index}",
            "title": topic if topic.lower().startswith("module") else f"Module {index}: {topic}",
            "overview": overview_seed[:900] or "Review source material and refine this module overview.",
            "objectives": [
                f"Summarize key concepts from {topic}.",
                "Apply source material to course activities and assessments.",
            ],
            "topics": [
                _compact_text(chunk.get("title") or chunk.get("source_title"), 140)
                for chunk in group[:6]
                if _compact_text(chunk.get("title") or chunk.get("source_title"), 140)
            ],
            "estimated_workload": setup.get("module_cadence") or "",
            "source_chunk_ids": source_ids,
            "items": [
                {
                    "type": "overview",
                    "title": f"{topic} Overview",
                    "purpose": "Orient learners to the module themes and source-backed expectations.",
                    "source_chunk_ids": source_ids[:5],
                },
                {
                    "type": "discussion",
                    "title": f"{topic} Discussion",
                    "purpose": "Prompt learners to connect and apply the source material.",
                    "source_chunk_ids": source_ids[:5],
                },
            ],
        })
    assumptions = [
        "A deterministic outline was generated from extracted source chunks because the AI response could not be parsed as valid JSON."
    ]
    if warning:
        assumptions.append(f"AI parse issue: {warning[:220]}")
    return {
        "title": setup.get("course_title") or "New Course Build",
        "description": setup.get("course_description") or "",
        "modules": modules,
        "gaps": ["Review module titles, objectives, and draft item recommendations before generating Canvas content."],
        "assumptions": assumptions,
    }


def run_course_creation_source_extraction_job(job_id: str, session_id: str, user_id: str, source_id: str) -> None:
    supabase = get_supabase()
    started_at = utc_now_iso()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        get_owned_course_creation_session(supabase, session_id, user_id)
        source = get_course_creation_source(
            supabase,
            session_id=session_id,
            user_id=user_id,
            source_id=source_id,
        )
        tag_data = source.get("tag_data") if isinstance(source.get("tag_data"), dict) else {}
        course_creation = tag_data.get("course_creation") if isinstance(tag_data.get("course_creation"), dict) else {}
        now = utc_now_iso()
        supabase.table("documents").update({
            "status": "processing",
            "tag_data": {
                **tag_data,
                "course_creation": {
                    **course_creation,
                    "extraction_status": "running",
                    "extraction_job_id": job_id,
                    "extraction_started_at": now,
                },
            },
            "updated_at": now,
        }).eq("id", source_id).eq("session_id", session_id).eq("user_id", user_id).execute()

        data, content_type = download_bytes(source["r2_original_key"])
        extraction = extract_course_source(
            data,
            filename=source.get("filename") or "source",
            content_type=tag_data.get("mime_type") or content_type,
        )
        artifact_key = write_extraction_artifact(
            session_id=session_id,
            source_id=source_id,
            filename=source.get("filename") or "source",
            extraction=extraction,
        )
        finished_at = utc_now_iso()
        extraction_status = extraction.get("status") or "succeeded"
        summary = {
            "status": extraction_status,
            "message": extraction.get("message"),
            "chunk_count": extraction.get("chunk_count", 0),
            "text_char_count": extraction.get("text_char_count", 0),
            "page_count": extraction.get("page_count"),
            "preview_chunks": extraction.get("chunks", [])[:8],
            "artifact_key": artifact_key,
            "extracted_at": finished_at,
        }
        supabase.table("documents").update({
            "status": "ready" if extraction_status == "succeeded" else "uploaded",
            "r2_working_key": artifact_key,
            "page_count": extraction.get("page_count"),
            "tag_data": {
                **tag_data,
                "course_creation": {
                    **course_creation,
                    "extraction_status": extraction_status,
                    "extraction_job_id": job_id,
                    "extraction_summary": summary,
                    "extraction_artifact_key": artifact_key,
                    "extracted_at": finished_at,
                },
            },
            "updated_at": finished_at,
        }).eq("id", source_id).eq("session_id", session_id).eq("user_id", user_id).execute()
        result = {
            "source_id": source_id,
            "job_type": COURSE_CREATION_EXTRACT_JOB_TYPE,
            "extraction": summary,
        }
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="course_creation_source_extracted",
            properties={
                "job_id": job_id,
                "source_id": source_id,
                "status": extraction_status,
                "chunk_count": summary["chunk_count"],
                "text_char_count": summary["text_char_count"],
            },
        )
    except Exception as exc:
        finished_at = utc_now_iso()
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        try:
            source = get_course_creation_source(
                supabase,
                session_id=session_id,
                user_id=user_id,
                source_id=source_id,
            )
            tag_data = source.get("tag_data") if isinstance(source.get("tag_data"), dict) else {}
            course_creation = tag_data.get("course_creation") if isinstance(tag_data.get("course_creation"), dict) else {}
            supabase.table("documents").update({
                "tag_data": {
                    **tag_data,
                    "course_creation": {
                        **course_creation,
                        "extraction_status": "failed",
                        "extraction_job_id": job_id,
                        "extraction_error": str(exc),
                    },
                },
                "updated_at": finished_at,
            }).eq("id", source_id).eq("session_id", session_id).eq("user_id", user_id).execute()
        except Exception:
            pass


def run_course_creation_outline_job(job_id: str, session_id: str, user_id: str) -> None:
    supabase = get_supabase()
    started_at = utc_now_iso()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        session = get_owned_course_creation_session(supabase, session_id, user_id)
        project = course_creation_meta(session)
        setup = project_setup_from_meta(project)
        chunks = _source_chunks_for_outline(supabase, session_id=session_id, user_id=user_id, setup=setup)
        if not chunks:
            raise ValueError("Extract at least one source file before generating an outline")

        running_generation = {
            "status": "running",
            "job_id": job_id,
            "started_at": started_at,
            "source_chunk_count": len(chunks),
        }
        update_course_creation_project_data(
            supabase,
            session_id=session_id,
            user_id=user_id,
            project_patch={"outline_generation": running_generation},
        )
        outline_payload = {
            "setup": setup,
            "source_count": len({chunk.get("source_id") for chunk in chunks}),
            "source_chunks": chunks,
        }
        raw = generate_course_creation_outline(project_payload=outline_payload)
        parse_warning = None
        retry_warning = None
        debug_artifact_key = None
        raw_response_excerpt = None
        try:
            parsed = _parse_ai_json(raw)
        except Exception as exc:
            first_parse_warning = str(exc)
            first_raw = raw
            first_raw_excerpt = _raw_response_excerpt(first_raw, exc)
            try:
                raw = generate_course_creation_outline(project_payload=outline_payload, compact=True)
                parsed = _parse_ai_json(raw)
                retry_warning = f"Initial AI JSON parse failed; compact retry succeeded: {first_parse_warning[:220]}"
            except Exception as retry_exc:
                parse_warning = (
                    f"Initial AI JSON parse failed: {first_parse_warning[:220]} "
                    f"Compact retry failed: {str(retry_exc)[:220]}"
                )
                raw_response_excerpt = _raw_response_excerpt(raw, retry_exc)
                try:
                    debug_artifact_key = write_outline_debug_artifact(
                        session_id=session_id,
                        job_id=job_id,
                        debug_payload={
                            "status": "parse_failed",
                            "parse_error": parse_warning,
                            "initial_raw_response": first_raw,
                            "initial_raw_response_length": len(first_raw),
                            "initial_raw_response_excerpt": first_raw_excerpt,
                            "retry_raw_response": raw,
                            "retry_raw_response_length": len(raw),
                            "retry_raw_response_excerpt": raw_response_excerpt,
                            "setup": setup,
                            "source_chunk_count": len(chunks),
                            "source_chunk_ids": [
                                _compact_text(chunk.get("id"), 120)
                                for chunk in chunks
                                if _compact_text(chunk.get("id"), 120)
                            ],
                            "captured_at": utc_now_iso(),
                        },
                    )
                except Exception:
                    debug_artifact_key = None
                parsed = {
                    "source_chunks": _fallback_source_analysis(chunks),
                    "outline": _fallback_outline(setup, chunks, parse_warning),
                }

        parsed_source_chunks = parsed.get("source_chunks") if isinstance(parsed.get("source_chunks"), list) else []
        if not parsed_source_chunks:
            parsed_source_chunks = _fallback_source_analysis(chunks)
            parse_warning = parse_warning or "AI response did not include source_chunks"
        source_analysis = {
            "generated_at": utc_now_iso(),
            "job_id": job_id,
            "source_chunk_count": len(chunks),
            "items": [
                _normalized_source_chunk(chunk, index)
                for index, chunk in enumerate(
                    parsed_source_chunks,
                    start=1,
                )
                if isinstance(chunk, dict)
            ],
        }
        normalized_outline = _normalize_outline(parsed, setup)
        if not normalized_outline.get("modules"):
            normalized_outline = _fallback_outline(setup, chunks, "AI response did not include outline modules")
            parse_warning = parse_warning or "AI response did not include outline modules"
        outline = {
            **normalized_outline,
            "status": "draft",
            "generated_at": utc_now_iso(),
            "job_id": job_id,
        }
        finished_at = utc_now_iso()
        generation_status = "succeeded_with_fallback" if parse_warning else "succeeded_with_retry" if retry_warning else "succeeded"
        generation = {
            "status": generation_status,
            "job_id": job_id,
            "source_chunk_count": len(chunks),
            "source_analysis_count": len(source_analysis["items"]),
            "module_count": len(outline["modules"]),
            "finished_at": finished_at,
        }
        if retry_warning:
            generation["warning"] = retry_warning
        if parse_warning:
            generation["warning"] = parse_warning
            generation["raw_response_length"] = len(raw)
            if raw_response_excerpt:
                generation["raw_response_excerpt"] = raw_response_excerpt
            if debug_artifact_key:
                generation["debug_artifact_key"] = debug_artifact_key
        update_course_creation_project_data(
            supabase,
            session_id=session_id,
            user_id=user_id,
            project_patch={
                "status": "outline_draft",
                "source_analysis": source_analysis,
                "outline": outline,
                "outline_generation": generation,
            },
        )
        result = {
            "job_type": COURSE_CREATION_OUTLINE_JOB_TYPE,
            "status": generation_status,
            "source_chunk_count": len(chunks),
            "source_analysis_count": len(source_analysis["items"]),
            "module_count": len(outline["modules"]),
            "outline": outline,
        }
        if retry_warning:
            result["warning"] = retry_warning
        if parse_warning:
            result["warning"] = parse_warning
            result["raw_response_length"] = len(raw)
            if raw_response_excerpt:
                result["raw_response_excerpt"] = raw_response_excerpt
            if debug_artifact_key:
                result["debug_artifact_key"] = debug_artifact_key
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="course_creation_outline_generated",
            properties={
                "job_id": job_id,
                "source_chunk_count": len(chunks),
                "module_count": len(outline["modules"]),
            },
        )
    except Exception as exc:
        finished_at = utc_now_iso()
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        try:
            update_course_creation_project_data(
                supabase,
                session_id=session_id,
                user_id=user_id,
                project_patch={
                    "outline_generation": {
                        "status": "failed",
                        "job_id": job_id,
                        "error": str(exc),
                        "finished_at": finished_at,
                    }
                },
            )
        except Exception:
            pass


def run_course_creation_draft_job(
    job_id: str,
    session_id: str,
    user_id: str,
    *,
    use_ai_body_generation: bool = True,
) -> None:
    supabase = get_supabase()
    started_at = utc_now_iso()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        session = get_owned_course_creation_session(supabase, session_id, user_id)
        project = course_creation_meta(session)
        if not isinstance(project.get("outline"), dict):
            raise ValueError("Generate an outline before creating editable drafts")

        update_course_creation_project_data(
            supabase,
            session_id=session_id,
            user_id=user_id,
            project_patch={
                "draft_generation": {
                    "status": "running",
                    "job_id": job_id,
                    "started_at": started_at,
                    "use_ai_body_generation": use_ai_body_generation,
                }
            },
        )
        from services.course_creation.draft_builder import materialize_outline_to_editable_drafts

        result = materialize_outline_to_editable_drafts(
            supabase,
            session_id=session_id,
            user_id=user_id,
            project=project,
            use_ai_body_generation=use_ai_body_generation,
        )
        finished_at = utc_now_iso()
        result = {
            **result,
            "job_id": job_id,
            "finished_at": finished_at,
        }
        update_course_creation_project_data(
            supabase,
            session_id=session_id,
            user_id=user_id,
            project_patch={
                "status": "drafts_created",
                "draft_generation": result,
            },
        )
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": {
                "job_type": COURSE_CREATION_DRAFT_JOB_TYPE,
                **result,
            },
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="course_creation_drafts_generated",
            properties=result,
        )
    except Exception as exc:
        finished_at = utc_now_iso()
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        try:
            update_course_creation_project_data(
                supabase,
                session_id=session_id,
                user_id=user_id,
                project_patch={
                    "draft_generation": {
                        "status": "failed",
                        "job_id": job_id,
                        "error": str(exc),
                        "finished_at": finished_at,
                    }
                },
            )
        except Exception:
            pass
