from __future__ import annotations

from typing import Any, Literal

from ai_image_text import generate_alt_text_from_bytes, generate_long_description_from_bytes
from services.pdf_figures import render_pdf_figure_crop_bytes
from services.pdf_flowcharts import build_figure_generation_context, compact_flowchart_guidance, normalize_figure_type


def generate_tagflow_zone_figure_text(
    *,
    pdf_data: bytes,
    document_name: str,
    page_number: int,
    bounds: dict[str, float],
    mode: Literal["alt", "long_desc", "both"],
    figure_type: Any = None,
    guidance: Any = None,
) -> dict[str, Any]:
    requested_figure_type = normalize_figure_type(figure_type)
    requested_guidance = compact_flowchart_guidance(guidance)
    crop_bytes, width, height = render_pdf_figure_crop_bytes(
        pdf_data,
        {
            "page_number": page_number,
            "bounds": bounds,
            "figure_type": requested_figure_type,
            "flowchart_guidance": requested_guidance,
        },
        max_size=(1100, 1100),
    )
    context = build_figure_generation_context(
        document_name=document_name,
        figure={
            "page_number": page_number,
            "bounds": bounds,
            "figure_type": requested_figure_type,
            "flowchart_guidance": requested_guidance,
        },
        figure_type=requested_figure_type,
        guidance=requested_guidance,
    )

    result: dict[str, Any] = {
        "page_number": page_number,
        "figure_type": requested_figure_type,
        "flowchart_guidance": requested_guidance,
        "crop": {
            "content_type": "image/webp",
            "width": width,
            "height": height,
        },
    }
    if mode in {"alt", "both"}:
        result["alt_text"] = generate_alt_text_from_bytes(crop_bytes, "image/webp", context)
    if mode in {"long_desc", "both"}:
        result["long_description"] = generate_long_description_from_bytes(crop_bytes, "image/webp", context)
    return result
