"""Course Creation API request models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CourseCreationSetupRequest(BaseModel):
    course_title: str = Field(default="", max_length=180)
    course_code: str = Field(default="", max_length=80)
    course_description: str = Field(default="", max_length=4000)
    audience: str = Field(default="", max_length=500)
    level: str = Field(default="", max_length=80)
    term_length: str = Field(default="", max_length=80)
    module_count: int | None = Field(default=None, ge=1, le=40)
    module_cadence: str = Field(default="", max_length=120)
    source_notes: str = Field(default="", max_length=4000)


class CourseCreationOutlineRequest(BaseModel):
    outline: dict[str, Any]
