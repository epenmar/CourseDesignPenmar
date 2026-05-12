"""ASU AIML text and vision generation helpers.

Centralizes prompt construction and model/provider selection for image alt
text, link text, content rewrites, generated course HTML, and TagFlow zone
suggestions.
"""

import base64
import json
import os

import httpx


ALT_TEXT_SYSTEM = (
    "You are an accessibility expert writing alt text for images in "
    "university course materials. "
    "Write concise, descriptive alt text following WCAG 2.1 guidelines. "
    "Focus on the information content the image conveys, not visual appearance. "
    "Be specific about what the image shows. "
    "Do not start with 'Image of' or 'Picture of'. "
    "If the image contains readable text, charts, or data, describe the key content. "
    "Keep it under 250 characters. "
    "Return only the alt text."
)

LONG_DESC_SYSTEM = (
    "You are an accessibility expert writing detailed image descriptions for "
    "university course materials, following WCAG 2.1 guidelines.\n\n"
    "Describe the information content of the image as a sighted learner would "
    "use it in context.\n\n"
    "Include visible text, labels, chart values, diagram steps, and meaningful "
    "relationships when they are present. Do not editorialize or infer beyond "
    "what is visible. Do not start with 'This image shows'. Use plain language."
)

LINK_TEXT_SYSTEM = (
    "You are an accessibility expert improving link text in university course materials. "
    "Write concise, descriptive link text that makes sense out of context. "
    "Do not use vague phrases like click here, here, learn more, read more, or link. "
    "Return only the replacement link text, with no quotation marks."
)

AI_REWRITE_SYSTEM = (
    "You are a writing assistant for university course designers. "
    "Rewrite selected course content according to the user's instruction. "
    "Preserve factual meaning and return only the replacement text with no explanations, "
    "quotation marks, or markdown fences."
)

AI_GENERATE_SYSTEM = (
    "You are a course content writer for a university. "
    "Generate well-structured HTML content suitable for a Canvas LMS page. "
    "Use semantic HTML tags such as h2, h3, p, ul, ol, li, strong, em, and table when useful. "
    "Do not wrap the result in code fences and do not add explanations. Return only HTML."
)

TAGFLOW_ZONE_SYSTEM = (
    "You are an accessibility expert suggesting PDF structure zones for remediation. "
    "Return only valid JSON with a top-level zones array. "
    "Each zone must include tag, x, y, width, height, reading_order, confidence, evidence_type, evidence_ids, and note. "
    "Coordinates must be percentages from 0 to 100 using the supplied PDF text and figure bounds. "
    "When the page layout hint is single_column, two_column, or three_column, assign reading_order by that layout. "
    "For two_column and three_column pages, finish all meaningful content in column 1 before column 2, and column 2 before column 3. "
    "Prefer existing structure evidence when present, especially heading levels. "
    "Use normalized_font_names and font_size to identify visual heading hierarchy, but ignore noisy subset prefixes. "
    "Do not overwrite manual work; these are suggestions for human review."
)

COURSE_CREATION_OUTLINE_SYSTEM = (
    "You are an instructional designer helping build an online university course from source documentation. "
    "Return only valid JSON. Do not include markdown fences or explanatory text. "
    "Use the supplied project setup and extracted source chunks. Do not invent facts beyond the sources; "
    "surface assumptions and content gaps explicitly. Build a practical Canvas-ready outline with modules, "
    "objectives, topics, source provenance, and recommended draft content items."
)

COURSE_CREATION_DRAFT_SYSTEM = (
    "You are an instructional designer drafting source-backed Canvas LMS content. "
    "Return only valid JSON matching the requested template schema. Do not include markdown fences, comments, "
    "or explanatory text. Use concise student-facing language. Use only facts supported by the supplied outline "
    "and source summaries. If a detail is missing, write a practical placeholder that asks the instructor to refine it."
)

_MAGIC_BYTES = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),
    (b"BM", "image/bmp"),
]

_STRIP_PREFIXES = [
    "alt text:",
    "alt-text:",
    "caption:",
    "image caption:",
    "the image shows",
    "the image displays",
    "the image depicts",
    "this image shows",
    "this image depicts",
    "image of",
    "picture of",
    "photo of",
    "photograph of",
]


def is_ai_configured() -> bool:
    return bool(os.getenv("CREATE_AI_API_KEY", "").strip())


def _query_url() -> str:
    configured = os.getenv("CREATE_AI_API_URL", "https://api-main.aiml.asu.edu/query").strip()
    return configured.replace("/query", "/queryV2")


def _text_query_url() -> str:
    return os.getenv("CREATE_AI_API_URL", "https://api-main.aiml.asu.edu/query").strip()


def _model_name() -> str:
    return os.getenv("CREATE_AI_API_MODEL") or os.getenv("CREATE_AI_MODEL", "claude4_5_sonnet")


def _link_text_model_name() -> str:
    return (
        os.getenv("CREATE_AI_LINK_TEXT_MODEL")
        or os.getenv("CREATE_AI_API_LINK_TEXT_MODEL")
        or _model_name()
    )


def _rewrite_model_name() -> str:
    return (
        os.getenv("CREATE_AI_REWRITE_MODEL")
        or os.getenv("CREATE_AI_API_REWRITE_MODEL")
        or _model_name()
    )


def _generate_model_name() -> str:
    return (
        os.getenv("CREATE_AI_GENERATE_MODEL")
        or os.getenv("CREATE_AI_API_GENERATE_MODEL")
        or _model_name()
    )


def _provider_name() -> str:
    return os.getenv("CREATE_AI_API_PROVIDER") or os.getenv("CREATE_AI_PROVIDER", "aws")


def _link_text_provider_name() -> str:
    return (
        os.getenv("CREATE_AI_LINK_TEXT_PROVIDER")
        or os.getenv("CREATE_AI_API_LINK_TEXT_PROVIDER")
        or _provider_name()
    )


def _rewrite_provider_name() -> str:
    return (
        os.getenv("CREATE_AI_REWRITE_PROVIDER")
        or os.getenv("CREATE_AI_API_REWRITE_PROVIDER")
        or _provider_name()
    )


def _generate_provider_name() -> str:
    return (
        os.getenv("CREATE_AI_GENERATE_PROVIDER")
        or os.getenv("CREATE_AI_API_GENERATE_PROVIDER")
        or _provider_name()
    )


def _tagflow_model_name() -> str:
    return (
        os.getenv("CREATE_AI_TAGFLOW_MODEL")
        or os.getenv("CREATE_AI_API_TAGFLOW_MODEL")
        or _model_name()
    )


def _tagflow_provider_name() -> str:
    return (
        os.getenv("CREATE_AI_TAGFLOW_PROVIDER")
        or os.getenv("CREATE_AI_API_TAGFLOW_PROVIDER")
        or _provider_name()
    )


def _course_creation_model_name() -> str:
    return (
        os.getenv("CREATE_AI_CANVAS_CREATE_MODEL")
        or os.getenv("CREATE_AI_COURSE_CREATION_MODEL")
        or os.getenv("CREATE_AI_API_CANVAS_CREATE_MODEL")
        or os.getenv("CREATE_AI_API_COURSE_CREATION_MODEL")
        or _generate_model_name()
    )


def _course_creation_provider_name() -> str:
    return (
        os.getenv("CREATE_AI_CANVAS_CREATE_PROVIDER")
        or os.getenv("CREATE_AI_COURSE_CREATION_PROVIDER")
        or os.getenv("CREATE_AI_API_CANVAS_CREATE_PROVIDER")
        or os.getenv("CREATE_AI_API_COURSE_CREATION_PROVIDER")
        or _generate_provider_name()
    )


def _env_int(names: tuple[str, ...], default: int) -> int:
    for name in names:
        value = os.getenv(name)
        if not value:
            continue
        try:
            parsed = int(value)
        except ValueError:
            continue
        if parsed > 0:
            return parsed
    return default


def _model_max_token_cap(model_name: str) -> int | None:
    lowered = model_name.lower()
    if "gemini" in lowered:
        return 4096
    return None


def _course_creation_max_tokens(*, compact: bool) -> int:
    if compact:
        requested = _env_int(
            (
                "CREATE_AI_CANVAS_CREATE_COMPACT_MAX_TOKENS",
                "CREATE_AI_COURSE_CREATION_COMPACT_MAX_TOKENS",
                "CREATE_AI_API_CANVAS_CREATE_COMPACT_MAX_TOKENS",
                "CREATE_AI_API_COURSE_CREATION_COMPACT_MAX_TOKENS",
            ),
            3000,
        )
    else:
        requested = _env_int(
            (
                "CREATE_AI_CANVAS_CREATE_MAX_TOKENS",
                "CREATE_AI_COURSE_CREATION_MAX_TOKENS",
                "CREATE_AI_API_CANVAS_CREATE_MAX_TOKENS",
                "CREATE_AI_API_COURSE_CREATION_MAX_TOKENS",
            ),
            4096,
        )
    cap = _model_max_token_cap(_course_creation_model_name())
    return min(requested, cap) if cap else requested


def _course_creation_content_max_tokens() -> int:
    requested = _env_int(
        (
            "CREATE_AI_CANVAS_CREATE_CONTENT_MAX_TOKENS",
            "CREATE_AI_COURSE_CREATION_CONTENT_MAX_TOKENS",
            "CREATE_AI_API_CANVAS_CREATE_CONTENT_MAX_TOKENS",
            "CREATE_AI_API_COURSE_CREATION_CONTENT_MAX_TOKENS",
        ),
        1500,
    )
    cap = _model_max_token_cap(_course_creation_model_name())
    return min(requested, cap) if cap else requested


def _detect_media_type(data: bytes, fallback: str = "image/png") -> str:
    for magic, mime in _MAGIC_BYTES:
        if data[: len(magic)] == magic:
            return mime
    return fallback


def _clean_output(text: str) -> str:
    cleaned = text.strip()
    if len(cleaned) >= 2 and cleaned[0] == '"' and cleaned[-1] == '"':
        cleaned = cleaned[1:-1]
    lowered = cleaned.lower().lstrip()
    for prefix in _STRIP_PREFIXES:
        if lowered.startswith(prefix):
            cleaned = cleaned[len(prefix):].lstrip(" ,:-")
            if cleaned:
                cleaned = cleaned[0].upper() + cleaned[1:]
            break
    return cleaned.strip()


def _truncate_alt(text: str, limit: int = 250) -> str:
    if len(text) <= limit:
        return text
    trimmed = text[:limit]
    for separator in [". ", ", ", " "]:
        index = trimmed.rfind(separator)
        if index > 40:
            return trimmed[:index].rstrip(",;: ")
    return trimmed.rsplit(" ", 1)[0]


def _call_vision(system: str, prompt: str, image_bytes: bytes, media_type: str) -> str:
    api_key = os.getenv("CREATE_AI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("CREATE_AI_API_KEY is not configured")

    data_uri = f"data:{media_type};base64,{base64.b64encode(image_bytes).decode('utf-8')}"
    payload = {
        "action": "query",
        "endpoint": "vision",
        "request_source": "override_params",
        "query": f"{system}\n\n{prompt}",
        "model_provider": _provider_name(),
        "model_name": _model_name(),
        "model_params": {"system_prompt": system, "temperature": 0},
        "image_file": data_uri,
    }

    with httpx.Client(
        timeout=60.0,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    ) as client:
        response = client.post(_query_url(), json=payload)
        response.raise_for_status()
        body = response.json()

    text = (body.get("response") or "").strip()
    if not text:
        raise RuntimeError("ASU AIML returned an empty response")
    return text


def _call_text(
    system: str,
    prompt: str,
    *,
    model_name: str | None = None,
    provider_name: str | None = None,
    max_tokens: int | None = None,
) -> str:
    api_key = os.getenv("CREATE_AI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("CREATE_AI_API_KEY is not configured")

    payload = {
        "action": "query",
        "request_source": "override_params",
        "query": prompt,
        "model_provider": provider_name or _provider_name(),
        "model_name": model_name or _model_name(),
        "model_params": {
            "system_prompt": system,
            "temperature": 0,
            **({"max_tokens": max_tokens} if max_tokens else {}),
        },
    }

    with httpx.Client(
        timeout=60.0,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    ) as client:
        response = client.post(_text_query_url(), json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body = response.text[:800] if getattr(response, "text", None) else ""
            raise RuntimeError(
                f"ASU AIML text request failed: {response.status_code} {response.reason_phrase}. {body}"
            ) from exc
        body = response.json()

    text = (body.get("response") or "").strip()
    if not text:
        raise RuntimeError("ASU AIML returned an empty response")
    return text


def generate_alt_text_from_bytes(image_bytes: bytes, content_type: str | None, context: str = "") -> str:
    media_type = _detect_media_type(image_bytes, (content_type or "image/png").split(";")[0].strip() or "image/png")
    prompt = "Write alt text for this image from a university course."
    if context:
        prompt += f" Context: {context}"
    raw = _call_vision(ALT_TEXT_SYSTEM, prompt, image_bytes, media_type)
    return _truncate_alt(_clean_output(raw))


def generate_long_description_from_bytes(image_bytes: bytes, content_type: str | None, context: str = "") -> str:
    media_type = _detect_media_type(image_bytes, (content_type or "image/png").split(";")[0].strip() or "image/png")
    prompt = (
        "Write a detailed image description for this university course image. "
        "Transcribe visible text when present and describe meaningful content precisely."
    )
    if context:
        prompt += f" Context for orientation only: {context}"
    return _call_vision(LONG_DESC_SYSTEM, prompt, image_bytes, media_type).strip().strip("\"'")


def generate_link_text_suggestion(
    *,
    current_text: str | None,
    href: str,
    content_title: str | None = None,
    module_name: str | None = None,
    surrounding_text: str | None = None,
    before_text: str | None = None,
    after_text: str | None = None,
    html_context: str | None = None,
    selected_context: str | None = None,
) -> str:
    context = []
    if content_title:
        context.append(f"Content title: {content_title}")
    if module_name:
        context.append(f"Module: {module_name}")
    if before_text or after_text:
        context.append(
            "The link sits inside this sentence. The replacement goes between "
            f"the before and after text: ...{before_text or ''} [{current_text or 'current link'}] {after_text or ''}..."
        )
    if selected_context:
        context.append(f"User-highlighted context to prioritize: {selected_context[:1200]}")
    if surrounding_text:
        context.append(f"Surrounding page text: {surrounding_text}")
    if html_context:
        cleaned_html_context = " ".join((html_context or "").split())
        context.append(f"HTML context with the current link marked: {cleaned_html_context[:1800]}")
    prompt = (
        "Suggest replacement text for an inaccessible or vague course link.\n"
        f"Current link text: {current_text or 'empty'}\n"
        f"Destination URL: {href}\n"
        "Use the page context to understand what the link is for, but return only the replacement anchor text.\n"
        "Requirements:\n"
        "- Maximum 60 characters.\n"
        "- The replacement must read naturally between the before and after text when provided.\n"
        "- Describe what the user will find when clicking.\n"
        "- Do not include the URL itself or the domain name.\n"
        "- Do not use vague phrases like click here, here, learn more, read more, or link.\n"
        "- Avoid repeating words already present immediately before or after the link.\n"
        "- Use sentence case, not title case.\n"
        + ("\n".join(context) if context else "")
    )
    return _clean_output(
        _call_text(
            LINK_TEXT_SYSTEM,
            prompt,
            model_name=_link_text_model_name(),
            provider_name=_link_text_provider_name(),
        )
    ).strip().strip("\"'")


def generate_rewritten_text(*, text: str, instruction: str, context: str | None = None) -> str:
    prompt = f"{instruction.strip()}\n\nSelected text:\n{text.strip()}"
    if context:
        prompt += f"\n\nPage context for orientation only:\n{context[:3000]}"
    return _call_text(
        AI_REWRITE_SYSTEM,
        prompt,
        model_name=_rewrite_model_name(),
        provider_name=_rewrite_provider_name(),
    ).strip().strip("\"'")


def generate_course_html(*, prompt: str, context: str | None = None, additional_context: str | None = None) -> str:
    user_prompt = prompt.strip()
    if additional_context:
        user_prompt += f"\n\nAdditional user context:\n{additional_context.strip()}"
    if context:
        user_prompt += f"\n\nCurrent page content for context:\n{context[:5000]}"
    return _call_text(
        AI_GENERATE_SYSTEM,
        user_prompt,
        model_name=_generate_model_name(),
        provider_name=_generate_provider_name(),
    ).strip()


def generate_tagflow_zone_suggestions(*, page_payload: dict) -> str:
    layout_hint = page_payload.get("layout_hint") if isinstance(page_payload.get("layout_hint"), dict) else {}
    effective_layout = str(layout_hint.get("effective") or "auto")
    if effective_layout == "two_column":
        reading_order_instruction = (
            "The user marked this page as two_column. Reading order must be column-major: "
            "read the left column from top to bottom, then the right column from top to bottom. "
            "Do not interleave rows across columns."
        )
    elif effective_layout == "three_column":
        reading_order_instruction = (
            "The user marked this page as three_column. Reading order must be column-major: "
            "read column 1 from top to bottom, then column 2, then column 3. "
            "Do not interleave rows across columns."
        )
    elif effective_layout == "single_column":
        reading_order_instruction = "The user marked this page as single_column. Reading order should be top-to-bottom."
    else:
        reading_order_instruction = "No fixed layout was selected. Infer reading order from text, visual, and structure evidence."
    prompt = (
        "Suggest accessible PDF structure zones for this page.\n"
        "Allowed tags: H1, H2, H3, H4, H5, H6, P, L, LI, Figure, Table, TH, TD, TR, Artifact, Span.\n"
        f"{reading_order_instruction}\n"
        "evidence_type must be one of: text_block, font_signal, existing_tag, figure_candidate, table_signal, layout_signal.\n"
        "evidence_ids should reference input text block ids or figure candidate ids when possible.\n"
        "Return JSON only in this shape: "
        "{\"zones\":[{\"tag\":\"P\",\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"reading_order\":1,\"confidence\":0.8,\"evidence_type\":\"text_block\",\"evidence_ids\":[\"text-1-1\"],\"note\":\"reason\"}]}.\n\n"
        f"Page analysis JSON:\n{json.dumps(page_payload, ensure_ascii=False)}"
    )
    return _call_text(
        TAGFLOW_ZONE_SYSTEM,
        prompt,
        model_name=_tagflow_model_name(),
        provider_name=_tagflow_provider_name(),
    ).strip()


def generate_course_creation_outline(*, project_payload: dict, compact: bool = False) -> str:
    source_chunk_limit = 6 if compact else 8
    item_limit = 2 if compact else 3
    max_tokens = _course_creation_max_tokens(compact=compact)
    prompt = (
        "Create Course Creation outline JSON from this payload. Return JSON only.\n\n"
        "Required shape: "
        "{\"source_chunks\":[{\"id\":\"chunk id\",\"summary\":\"max 18 words\",\"topics\":[\"topic\"],"
        "\"source_locator\":{}}],\"outline\":{\"title\":\"course title\",\"description\":\"max 30 words\","
        "\"modules\":[{\"id\":\"module-1\",\"title\":\"module title\",\"overview\":\"max 35 words\","
        "\"objectives\":[\"max 12 words\"],\"topics\":[\"topic\"],\"estimated_workload\":\"short\","
        "\"source_chunk_ids\":[\"chunk id\"],\"items\":[{\"type\":\"overview|page|assignment|discussion|quiz\","
        "\"title\":\"item title\",\"purpose\":\"max 14 words\",\"source_chunk_ids\":[\"chunk id\"]}]}],"
        "\"gaps\":[\"gap\"],\"assumptions\":[\"assumption\"]}}.\n\n"
        "Hard limits: "
        "match setup.module_count exactly when present; "
        f"return at most {source_chunk_limit} source_chunks; "
        f"return at most {item_limit} items per module; "
        "return at most 3 objectives and 5 topics per module; "
        "use compact strings, no paragraphs; "
        "do not add orientation/welcome items unless explicitly supported by source chunks; "
        "every module and item must cite source_chunk_ids from the payload; "
        "no markdown, no comments, no trailing commas, no unescaped newlines inside strings. "
        "The final character must be the closing JSON brace.\n\n"
        f"Project payload JSON:\n{json.dumps(project_payload, ensure_ascii=False)}"
    )
    return _call_text(
        COURSE_CREATION_OUTLINE_SYSTEM,
        prompt,
        model_name=_course_creation_model_name(),
        provider_name=_course_creation_provider_name(),
        max_tokens=max_tokens,
    ).strip()


def generate_course_creation_draft_content(*, item_payload: dict) -> str:
    prompt = (
        "Draft structured Canvas content for one Course Creation outline item.\n"
        "Return one JSON object only. The object must match template_schema keys and value types.\n"
        "Do not return rendered HTML. Do not add keys that are not in template_schema except source_chunk_ids.\n"
        "Use complete student-facing sentences. Keep each paragraph under 90 words.\n\n"
        f"Payload JSON:\n{json.dumps(item_payload, ensure_ascii=False)}"
    )
    return _call_text(
        COURSE_CREATION_DRAFT_SYSTEM,
        prompt,
        model_name=_course_creation_model_name(),
        provider_name=_course_creation_provider_name(),
        max_tokens=_course_creation_content_max_tokens(),
    ).strip()
