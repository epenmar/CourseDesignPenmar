"""Request schemas for image accessibility workflows."""

from typing import Literal

from pydantic import BaseModel, Field


class ImageUpdateRequest(BaseModel):
    edited_alt_text: str | None = None
    long_description: str | None = None
    is_decorative: bool | None = None
    review_action: Literal["keep", "delete", "defer"] | None = None


class BulkImageUpdateRequest(BaseModel):
    image_ids: list[str] = Field(min_length=1, max_length=200)
    is_decorative: bool | None = None
    review_action: Literal["keep", "delete", "defer"] | None = None


class BulkImageApplyRequest(BaseModel):
    image_ids: list[str] = Field(min_length=1, max_length=200)


class GenerateImageTextRequest(BaseModel):
    mode: Literal["alt", "long_desc", "both"] = "both"
    overwrite_existing: bool = True


class GenerateBulkImageTextRequest(BaseModel):
    image_ids: list[str] = Field(min_length=1, max_length=100)
    mode: Literal["alt", "long_desc", "both"] = "alt"
    overwrite_existing: bool = False
    skip_decorative: bool = True
