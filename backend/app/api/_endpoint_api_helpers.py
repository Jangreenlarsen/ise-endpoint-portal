# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Delte hjælpefunktioner til endpoints-router og endpoints_ops-router.

Udtrukket fra endpoints.py (P2-refaktor) for at undgå duplikering.
"""
from __future__ import annotations

from fastapi import HTTPException

from app.core.exceptions import IseApiError
from app.schemas.user import User
from app.services import user_service


def _ise_http_error(exc: IseApiError, not_found_msg: str = "Endpoint ikke fundet") -> HTTPException:
    """Konvertér IseApiError til en brugervenlig HTTPException.

    - 404          → 404 med dansk besked
    - transport (0)→ 503 "ISE midlertidigt utilgængelig"
    - andet        → 502 med HTTP-status
    """
    if exc.status_code == 404:
        return HTTPException(status_code=404, detail=not_found_msg)
    if exc.status_code == 0:
        return HTTPException(
            status_code=503,
            detail="ISE er midlertidigt utilgængelig — prøv igen om lidt",
        )
    return HTTPException(
        status_code=502,
        detail=f"ISE returnerede en uventet fejl (HTTP {exc.status_code})",
    )


def _scope_for(user: User) -> list[str] | None:
    """Returnér effektive roller eller None for admin (= ingen filter)."""
    if user.role == "admin":
        return None
    return user_service.effective_roles(user)


def _autotag_for(user: User) -> str | None:
    """Returnér username der skal auto-tagges på write, eller None for admin."""
    if user.role == "admin":
        return None
    return user.username


def _is_psk_editor_for(user: User) -> bool:
    return user.role in ("admin", "editor-psk")
