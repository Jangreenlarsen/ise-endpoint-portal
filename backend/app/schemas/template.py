from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TemplateFields(BaseModel):
    group_id: str = ""
    description: str = ""
    static_group_assignment: bool | None = None
    custom_attributes: dict[str, str] = Field(default_factory=dict)


class Template(BaseModel):
    id: str
    name: str
    description: str = ""
    fields: TemplateFields
    visible_to: list[str] = Field(default_factory=list)
    created_at: str
    created_by: str


class TemplateCreate(BaseModel):
    name: str
    description: str = ""
    fields: TemplateFields = Field(default_factory=TemplateFields)
    visible_to: list[str] = Field(default_factory=list)


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    fields: TemplateFields | None = None
    visible_to: list[str] | None = None


class TemplateListResponse(BaseModel):
    templates: list[Template]
