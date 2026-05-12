"""Pending Review request and response schema ownership."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class ModuleOperationRequest(BaseModel):
    operation_type: Literal["item_publish", "item_indent", "item_position", "item_move", "item_remove", "item_rename"]
    module_item_id: str
    after_state: dict[str, Any] = Field(default_factory=dict)


class ModuleLevelOperationRequest(BaseModel):
    operation_type: Literal["module_position", "module_rename", "module_delete"]
    module_id: str
    after_state: dict[str, Any] = Field(default_factory=dict)


class ApplyModuleOperationsRequest(BaseModel):
    operation_ids: list[str] | None = None


class ContentPushRequest(BaseModel):
    published: bool | None = None
    batch_id: str | None = None
