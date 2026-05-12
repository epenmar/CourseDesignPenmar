"""Request schemas for PDF figure remediation APIs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class FlowchartPointRequest(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)


class FlowchartBoundsRequest(FlowchartPointRequest):
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


class FlowchartNodeRequest(BaseModel):
    id: str | None = Field(default=None, max_length=80)
    label: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    reading_order: int = Field(default=1, ge=1, le=300)
    role: str | None = Field(default=None, max_length=40)
    bounds: FlowchartBoundsRequest | None = None


class FlowchartConnectionRequest(BaseModel):
    id: str | None = Field(default=None, max_length=80)
    from_node_id: str = Field(max_length=80)
    to_node_id: str = Field(max_length=80)
    label: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    order: int = Field(default=1, ge=1, le=500)
    from_anchor: FlowchartPointRequest | None = None
    to_anchor: FlowchartPointRequest | None = None


class PdfFigureFlowchartRequest(BaseModel):
    nodes: list[FlowchartNodeRequest] = Field(default_factory=list, max_length=300)
    connections: list[FlowchartConnectionRequest] = Field(default_factory=list, max_length=500)
    reading_order: list[str] = Field(default_factory=list, max_length=300)
    guidance: str | None = Field(default=None, max_length=4000)
