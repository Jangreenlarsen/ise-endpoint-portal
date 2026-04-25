from __future__ import annotations

from pydantic import BaseModel, Field


class EndpointRole(BaseModel):
    name: str
    description: str = ""
    created_by: str
    created_at: str


class EndpointRoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=256)


class EndpointRoleListResponse(BaseModel):
    roles: list[EndpointRole]
