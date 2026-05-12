"""Request schemas for inventory decisions."""

from typing import Literal

from pydantic import BaseModel, Field


class InventoryDecisionRequest(BaseModel):
    content_item_id: str
    action: Literal["keep", "delete", "defer"]
    reason: str | None = None


class BulkInventoryDecisionRequest(BaseModel):
    content_item_ids: list[str] = Field(min_length=1, max_length=200)
    action: Literal["keep", "delete", "defer"]
    reason: str | None = None
