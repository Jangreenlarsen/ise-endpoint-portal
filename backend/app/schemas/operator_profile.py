from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.user import Role


class OperatorProfile(BaseModel):
    id: str
    name: str
    display_name: str
    default_role: Role = "viewer"
    assigned_endpoint_roles: list[str] = Field(default_factory=list)
    assigned_templates: list[str] = Field(default_factory=list)


class OperatorProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    display_name: str = Field(min_length=1, max_length=128)
    default_role: Role = "viewer"
    assigned_endpoint_roles: list[str] = Field(default_factory=list)
    assigned_templates: list[str] = Field(default_factory=list)


class OperatorProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    default_role: Role | None = None
    assigned_endpoint_roles: list[str] | None = None
    assigned_templates: list[str] | None = None
