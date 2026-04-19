from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "editor", "viewer"]
ROLE_VALUES: tuple[Role, ...] = ("admin", "editor", "viewer")


class User(BaseModel):
    id: str
    username: str
    role: Role
    created_at: str
    last_login: str | None = None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    role: Role = "viewer"


class UserUpdate(BaseModel):
    role: Role | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


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
