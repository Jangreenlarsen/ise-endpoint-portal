from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "editor", "viewer", "registrar"]
ROLE_VALUES: tuple[Role, ...] = ("admin", "editor", "viewer", "registrar")


class User(BaseModel):
    id: str
    username: str
    role: Role
    created_at: str
    last_login: str | None = None
    assigned_endpoint_roles: list[str] = Field(default_factory=list)


class UserMe(User):
    """Returneres af GET /api/auth/me — inkluderer effektive roller.

    `effective_roles` = `assigned_endpoint_roles` + `[username]` og er
    den liste frontend bruger til at filtrere endpoint-visning.
    """

    effective_roles: list[str] = Field(default_factory=list)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    role: Role = "viewer"


class UserUpdate(BaseModel):
    role: Role | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


class UserEndpointRoles(BaseModel):
    """Body for PUT /api/users/{id}/endpoint-roles."""

    roles: list[str] = Field(default_factory=list)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: User


class AuthStatus(BaseModel):
    setup_required: bool
    authenticated: bool
    user: User | None = None


class SetupRequest(BaseModel):
    """First-run admin setup. Only accepted when no users exist."""

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)
