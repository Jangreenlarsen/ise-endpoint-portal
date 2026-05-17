# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Pydantic schemas for the audit-log API (2.9.0)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AuditEvent(BaseModel):
    id: int
    ts: str
    actor_id: str = ""
    actor_username: str
    action: str
    resource_type: str
    resource_id: str | None = None
    before: Any = None
    after: Any = None
    source_ip: str = ""


class AuditListResponse(BaseModel):
    events: list[AuditEvent]
    total: int
    limit: int
    offset: int


class RollbackResponse(BaseModel):
    ok: bool
    event_id: int
    resource_type: str
    resource_id: str | None
    message: str
    restored: Any = Field(
        default=None,
        description="Snapshot of the restored state (for verification).",
    )
