"""Transfer API request and response schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TransferTargetValidationRequest(BaseModel):
    canvas_url: str = Field(..., min_length=8, max_length=500)


class TransferJobRequest(BaseModel):
    mode: Literal["same_course", "target_course", "copy_course"]
    canvas_url: str = Field("", max_length=500)
    erase_first: bool = False
    target_backup_job_id: str | None = None
    erase_without_backup_confirmed: bool = False
