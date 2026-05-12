"""Request schemas for editor-owned Canvas routes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AIRewriteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    instruction: str = Field(min_length=1, max_length=2000)
    context: str | None = Field(default=None, max_length=12000)


class AIGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    context: str | None = Field(default=None, max_length=20000)
    additional_context: str | None = Field(default=None, max_length=4000)


class ContentCreateRequest(BaseModel):
    content_type: Literal["page", "assignment", "discussion"]
    title: str = Field(min_length=1, max_length=255)
    html_body: str | None = None
    published: bool = False
    module_id: str | None = None


class ContentSaveRequest(BaseModel):
    title: str | None = None
    html_body: str
    published: bool | None = None
    change_summary: str | None = None


class ContentIssueRequest(BaseModel):
    issue_type: Literal["needs_replacing", "flag_issue"]
    note: str | None = Field(default=None, max_length=4000)


class SourcePageReplaceRequest(BaseModel):
    source_course_id: str = Field(min_length=1, max_length=64)
    source_page_url: str = Field(min_length=1, max_length=512)


class QuizAnswerRequest(BaseModel):
    id: int | None = None
    text: str | None = None
    html: str | None = None
    weight: float | None = None
    answer_text: str | None = None
    answer_html: str | None = None
    answer_weight: float | None = None
    blank_id: str | None = None
    left: str | None = None
    right: str | None = None
    answer_match_left: str | None = None
    answer_match_right: str | None = None
    matching_answer_incorrect_matches: str | None = None
    match_id: int | None = None
    numerical_answer_type: str | None = None
    exact: float | None = None
    margin: float | None = None
    approximate: float | None = None
    precision: int | None = None
    start: float | None = None
    end: float | None = None


class QuizQuestionUpdateRequest(BaseModel):
    question_text: str | None = None
    question_type: str | None = None
    points_possible: float | None = None
    answers: list[QuizAnswerRequest] | None = None


class QuizQuestionCreateRequest(BaseModel):
    question_text: str = "<p>New question</p>"
    question_type: str = "multiple_choice_question"
    points_possible: float = 1
    answers: list[QuizAnswerRequest] | None = None


class FindReplaceSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    case_sensitive: bool = False
    content_types: list[str] | None = None


class FindReplaceApplyRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    replacement: str = Field(max_length=500)
    case_sensitive: bool = False
    content_item_ids: list[str] = Field(min_length=1, max_length=100)
