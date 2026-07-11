# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "editor", "editor-psk", "viewer", "registrant", "registrant_templet"]
ROLE_VALUES: tuple[Role, ...] = ("admin", "editor", "editor-psk", "viewer", "registrant", "registrant_templet")
UserType = Literal["user", "operator", "tacacs_shadow"]


class User(BaseModel):
    id: str
    username: str
    role: Role
    user_type: UserType = "user"
    created_at: str
    last_login: str | None = None
    assigned_endpoint_roles: list[str] = Field(default_factory=list)
    assigned_templates: list[str] = Field(default_factory=list)


class UserMe(User):
    """Returneres af GET /api/auth/me — inkluderer effektive roller.

    `effective_roles` = `assigned_endpoint_roles` + `[username]` og er
    den liste frontend bruger til at filtrere endpoint-visning.
    """

    effective_roles: list[str] = Field(default_factory=list)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(default="", max_length=256)
    role: Role = "viewer"


class UserUpdate(BaseModel):
    role: Role | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)
    user_type: UserType | None = None


class UserEndpointRoles(BaseModel):
    """Body for PUT /api/users/{id}/endpoint-roles."""

    roles: list[str] = Field(default_factory=list)


class UserTemplates(BaseModel):
    """Body for PUT /api/users/{id}/templates."""

    template_ids: list[str] = Field(default_factory=list)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str  # medtages for backward-compat; frontend bør bruge httpOnly cookie
    user: User
    expires_at: str = ""  # ISO 8601 UTC — frontend bruger dette til udløbstjek
    auth_type: str = "local"  # "local" eller "tacacs"


class UserPrefs(BaseModel):
    language: Literal["da", "en"] | None = None  # None = brug portal/browser default
    col_order: list[str] | None = None   # rækkefølge af kolonne-nøgler i Browse
    col_vis: dict[str, bool] | None = None   # {nøgle: synlig} for Browse-kolonner
    col_widths: dict[str, int] | None = None  # {nøgle: pixel-bredde} for Browse-kolonner
    tree_layout: dict | None = None  # gruppetræets layout (groupBy/branchDim/merges/hidden)


class AuthStatus(BaseModel):
    setup_required: bool
    authenticated: bool
    user: User | None = None
    default_language: Literal["da", "en"] = "en"  # portal global default — bundled here for pre-login access


class SetupRequest(BaseModel):
    """First-run admin setup. Only accepted when no users exist."""

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


# Saved views (3.9.0) — per-bruger Browse filter-presets.
class SavedView(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=64)
    query: dict = Field(default_factory=dict)
    created_at: str


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    query: dict = Field(default_factory=dict)


class SavedViewUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    query: dict | None = None


class SavedViewsResponse(BaseModel):
    views: list[SavedView] = Field(default_factory=list)
    max_views: int = 20
