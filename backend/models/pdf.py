"""PDF remediation request models.

Defines shared Pydantic contracts for TagFlow zones, preview generation,
layout hints, figure review, AI figure text generation, and PDF metadata
review.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class TagType(str, Enum):
    H1 = "H1"
    H2 = "H2"
    H3 = "H3"
    H4 = "H4"
    H5 = "H5"
    H6 = "H6"
    P = "P"
    L = "L"
    LI = "LI"
    FIGURE = "Figure"
    TABLE = "Table"
    TH = "TH"
    TD = "TD"
    TR = "TR"
    ARTIFACT = "Artifact"
    SPAN = "Span"


class PercentBounds(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


class TagFlowZoneRequest(PercentBounds):
    id: str | None = None
    tag: TagType
    reading_order: int = Field(ge=0, le=500)
    source: Literal["manual", "ai", "imported"] = "manual"
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence_type: str | None = Field(default=None, max_length=80)
    evidence_ids: list[str] | None = Field(default=None, max_length=20)
    figure_candidate_id: str | None = Field(default=None, max_length=120)
    figure_inventory_id: str | None = Field(default=None, max_length=120)
    alt_text: str | None = Field(default=None, max_length=1000)
    long_description: str | None = Field(default=None, max_length=8000)
    figure_type: Literal["image", "diagram", "flowchart"] | None = None
    flowchart_guidance: str | None = Field(default=None, max_length=4000)
    flowchart: dict[str, Any] | None = None
    note: str | None = Field(default=None, max_length=500)


class TagFlowPageZonesRequest(BaseModel):
    zones: list[TagFlowZoneRequest] = Field(default_factory=list, max_length=500)
    review_status: Literal["edited", "remediated"] | None = None


class TagFlowPreviewRequest(BaseModel):
    page_numbers: list[int] | None = Field(default=None, max_length=200)


class TagFlowSuggestionRequest(BaseModel):
    page_numbers: list[int] | None = Field(default=None, max_length=50)


class TagFlowLayoutHintRequest(BaseModel):
    layout: Literal["auto", "single_column", "two_column", "three_column"] = "auto"
    scope: Literal["page", "document"] = "page"
    page_number: int | None = Field(default=None, ge=1)


class PdfFigureReviewRequest(BaseModel):
    alt_text: str | None = Field(default=None, max_length=1000)
    long_description: str | None = Field(default=None, max_length=8000)
    is_decorative: bool | None = None
    review_action: Literal["keep", "ignore"] | None = None
    figure_type: Literal["image", "diagram", "flowchart"] | None = None
    flowchart_guidance: str | None = Field(default=None, max_length=4000)


class PdfFigureGenerateRequest(BaseModel):
    mode: Literal["alt", "long_desc", "both"] = "alt"
    figure_type: Literal["image", "diagram", "flowchart"] | None = None
    guidance: str | None = Field(default=None, max_length=4000)


class PdfMetadataReviewRequest(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=40)


class TagFlowZoneFigureGenerateRequest(PercentBounds):
    zone_id: str | None = Field(default=None, max_length=120)
    mode: Literal["alt", "long_desc", "both"] = "alt"
    figure_type: Literal["image", "diagram", "flowchart"] | None = None
    guidance: str | None = Field(default=None, max_length=4000)
