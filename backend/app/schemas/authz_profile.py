# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

from pydantic import BaseModel


class AuthzProfileSummary(BaseModel):
    id: str
    name: str
    description: str = ""


class AuthzProfileStatus(BaseModel):
    name: str
    exists: bool
    profile_id: str | None = None
    description: str = ""


class StandardProfilesResult(BaseModel):
    ok: bool
    created: list[str]
    already_existed: list[str]
    errors: list[str]


class AuthzProfileDetail(BaseModel):
    id: str = ""
    name: str
    description: str = ""
    access_type: str = ""    # ACCESS_ACCEPT / ACCESS_REJECT
    profile_type: str = ""   # SWITCH etc.
    dacl_name: str = ""
    vlan: str = ""
    radius_profile: str = ""
    advanced_attrs: list[str] = []
