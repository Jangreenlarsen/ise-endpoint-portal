# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Delte hjælpefunktioner til endpoints-router og endpoints_ops-router.

Udtrukket fra endpoints.py (P2-refaktor) for at undgå duplikering.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Iterable

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_user, get_endpoint_service
from app.core.exceptions import IseApiError
from app.schemas.endpoint import CustomAttrs, EndpointDetail
from app.schemas.user import User
from app.services import user_service
from app.services._endpoint_helpers import _parse_roles_csv
from app.services.endpoint_service import EndpointService

logger = logging.getLogger(__name__)


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


# ── Skrive-autorisation (BUGS.md P-1/P-2) ───────────────────────────────────
#
# Læse-stierne har altid filtreret på System adm-scope og maskeret PSK. Skrive-
# stierne stolede på at frontend skjulte felterne. Hjælperne her håndhæver
# de samme regler server-side for alle skrive- og ops-ruter.

async def _ensure_in_scope(
    service: EndpointService, endpoint_id: str, user: User
) -> EndpointDetail | None:
    """Rejs 404 hvis endpointet ligger uden for brugerens System adm-scope.

    404 (ikke 403) så scope-grænsen ikke afslører at endpointet findes —
    samme konvention som ``get_endpoint``. Admin returnerer None uden opslag.
    Opslaget er cache-backed og koster normalt ingen ISE-kald.
    """
    roles = _scope_for(user)
    if roles is None:
        return None
    try:
        return await service.get_endpoint(endpoint_id, effective_roles=roles)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


async def require_endpoint_in_scope(
    endpoint_id: str,
    user: User = Depends(get_current_user),
    service: EndpointService = Depends(get_endpoint_service),
) -> None:
    """Route-dependency til alle ``/{endpoint_id}``-ruter der skriver eller handler."""
    await _ensure_in_scope(service, endpoint_id, user)


async def _split_by_scope(
    service: EndpointService, ids: Iterable[str], user: User
) -> tuple[list[str], list[str]]:
    """Del en ID-liste i (inden for scope, uden for scope). Admin: alt tilladt."""
    ids = list(ids)
    roles = _scope_for(user)
    if roles is None:
        return ids, []
    sem = asyncio.Semaphore(5)

    async def _one(ep_id: str) -> bool:
        async with sem:
            try:
                await service.get_endpoint(ep_id, effective_roles=roles)
                return True
            except IseApiError:
                return False

    flags = await asyncio.gather(*(_one(i) for i in ids))
    allowed = [i for i, ok in zip(ids, flags) if ok]
    denied = [i for i, ok in zip(ids, flags) if not ok]
    if denied:
        logger.warning(
            "scope: %s afvist for %d endpoint(s) uden for scope: %s",
            user.username, len(denied), ", ".join(denied[:10]),
        )
    return allowed, denied


OUT_OF_SCOPE_MSG = "Endpoint ikke fundet"


def _strip_psk_unless_editor(ca: CustomAttrs | None, user: User) -> None:
    """Fjern PSK-felter fra en skrive-payload hvis brugeren ikke er psk-editor.

    Felterne sættes til None, så de udelades af ISE-payloaden og den
    eksisterende værdi i ISE bevares (ERS merger customAttributes). Der
    strippes frem for at afvise, fordi en almindelig editors gem-flow ellers
    ville fejle på et felt brugeren slet ikke kan se.
    """
    if ca is None or _is_psk_editor_for(user):
        return
    if ca.PSK_Key is not None or ca.PSK_Mode is not None:
        logger.warning(
            "psk: ignorerer PSK-felter fra %s (rolle %s) — kræver admin/editor-psk",
            user.username, user.role,
        )
    ca.PSK_Key = None
    ca.PSK_Mode = None


def _check_role_tags(
    ca: CustomAttrs | None, user: User, existing_roles: Iterable[str] = ()
) -> None:
    """Afvis tildeling af System adm-roller brugeren ikke selv har.

    Roller der allerede står på endpointet må gerne bevares. Admin er fri.
    """
    if ca is None or user.role == "admin" or not ca.HypervisionRoles:
        return
    allowed = {r.lower() for r in user_service.effective_roles(user)}
    allowed |= {r.lower() for r in existing_roles}
    foreign = [r for r in _parse_roles_csv(ca.HypervisionRoles) if r.lower() not in allowed]
    if foreign:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Du kan ikke tildele System adm-roller du ikke selv har: " + ", ".join(foreign),
        )
