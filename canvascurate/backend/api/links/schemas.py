"""Request schemas for link text remediation."""

from pydantic import BaseModel, Field


class LinkTextSuggestionRequest(BaseModel):
    content_item_id: str
    link_index: int = Field(ge=1)
    href: str
    text: str | None = None
    before_text: str | None = Field(default=None, max_length=4000)
    after_text: str | None = Field(default=None, max_length=4000)
    html_context: str | None = Field(default=None, max_length=4000)
    selected_context: str | None = Field(default=None, max_length=2000)


class LinkTextApplyRequest(LinkTextSuggestionRequest):
    replacement_text: str


class BulkLinkTextSuggestionRequest(BaseModel):
    links: list[LinkTextSuggestionRequest] = Field(min_length=1, max_length=50)


class BulkLinkTextApplyRequest(BaseModel):
    links: list[LinkTextApplyRequest] = Field(min_length=1, max_length=100)
