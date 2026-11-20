# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Operationelle endpoints-ruter: CoA, bulk-CoA, ANC og endpoint-historik.

Udtrukket fra endpoints.py (P2-refaktor). Registreres i main.py som separat router.
"""
from __future__ import annotations

import asyncio
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api._endpoint_api_helpers import (
    OUT_OF_SCOPE_MSG,
    _ise_http_error,
    _split_by_scope,
    require_endpoint_in_scope,
)
from app.api.deps import get_endpoint_service, require_coa, require_editor
from app.schemas.user import User
from app.core.exceptions import IseApiError
from app.schemas.endpoint import (
    AncActionResponse,
    AncPoliciesResponse,
    AncQuarantineRequest,
    AncStatusResponse,
    BulkApplyTemplateRequest,
    BulkDecommissionRequest,
    CoaReauthResponse,
)
from app.services.endpoint_service import EndpointService

router = APIRouter(prefix="/endpoints", tags=["endpoints"])


class SetActiveStatusRequest(BaseModel):
    active_status: str


# ------------------------------------------------------------------ #
# CoA (Change of Authorization)                                        #
# ------------------------------------------------------------------ #

@router.post("/{endpoint_id}/coa-reauth", response_model=CoaReauthResponse, dependencies=[Depends(require_coa), Depends(require_endpoint_in_scope)])
async def coa_reauth(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> CoaReauthResponse:
    """Trigger CoA reauth on ISE for the given endpoint's MAC."""
    try:
        ok, mac, msg = await service.coa_reauth(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return CoaReauthResponse(ok=ok, mac=mac, message=msg)


@router.post("/{endpoint_id}/coa-disconnect", response_model=CoaReauthResponse, dependencies=[Depends(require_coa), Depends(require_endpoint_in_scope)])
async def coa_disconnect(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> CoaReauthResponse:
    """Trigger CoA disconnect (deauth) on ISE for the given endpoint's MAC.

    Forces the WLC/switch to remove the session so the client must re-associate
    and run a fresh DHCP DORA — useful when a VLAN change requires a new IP.
    """
    try:
        ok, mac, msg = await service.coa_disconnect(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return CoaReauthResponse(ok=ok, mac=mac, message=msg)


# ------------------------------------------------------------------ #
# Bulk CoA                                                            #
# ------------------------------------------------------------------ #

class BulkCoaRequest(BaseModel):
    endpoint_ids: list[str]
    action: Literal["reauth", "disconnect"] = "reauth"


@router.post("/bulk-coa")
async def bulk_coa(
    body: BulkCoaRequest,
    user: User = Depends(require_coa),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Trigger CoA reauth eller disconnect for en liste af endpoints parallelt."""
    sem = asyncio.Semaphore(3)
    allowed, denied = await _split_by_scope(service, body.endpoint_ids[:200], user)

    async def do_one(ep_id: str) -> dict:
        async with sem:
            try:
                if body.action == "disconnect":
                    ok, mac, msg = await service.coa_disconnect(ep_id)
                else:
                    ok, mac, msg = await service.coa_reauth(ep_id)
                return {"id": ep_id, "ok": ok, "mac": mac, "message": msg}
            except Exception as exc:  # noqa: BLE001
                return {"id": ep_id, "ok": False, "mac": None, "message": str(exc)}

    results = list(await asyncio.gather(*(do_one(ep_id) for ep_id in allowed)))
    results += [{"id": i, "ok": False, "mac": None, "message": OUT_OF_SCOPE_MSG} for i in denied]
    return {"results": results, "ok_count": sum(1 for r in results if r["ok"])}


# ------------------------------------------------------------------ #
# Endpoint historik (audit trail)                                     #
# ------------------------------------------------------------------ #

@router.get("/{endpoint_id}/history", dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def get_endpoint_history(
    endpoint_id: str,
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    """Returnér audit-historik for ét endpoint (hvem ændrede hvad og hvornår)."""
    from app.core import audit_store

    def _parse(blob: str | None):
        if blob is None:
            return None
        try:
            return json.loads(blob)
        except (TypeError, ValueError):
            return blob

    rows, total = await audit_store.query(
        resource_type="endpoint",
        resource_id=endpoint_id,
        limit=limit,
        offset=0,
    )
    events = [
        {
            "id": r["id"],
            "ts": r["ts"],
            "actor_username": r["actor_username"],
            "action": r["action"],
            "before": _parse(r.get("before_json")),
            "after": _parse(r.get("after_json")),
        }
        for r in rows
    ]
    return {"events": events, "total": total}


# ------------------------------------------------------------------ #
# ANC (Adaptive Network Control) — editor/admin only                  #
# ------------------------------------------------------------------ #

@router.get("/anc-policies", response_model=AncPoliciesResponse, dependencies=[Depends(require_editor)])
async def list_anc_policies(
    service: EndpointService = Depends(get_endpoint_service),
) -> AncPoliciesResponse:
    """List all ANC policy names configured in ISE."""
    try:
        policies = await service.list_anc_policies()
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return AncPoliciesResponse(policies=policies)


@router.get("/{endpoint_id}/anc-status", response_model=AncStatusResponse, dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def anc_status(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> AncStatusResponse:
    """Get the current ANC quarantine status for an endpoint."""
    try:
        mac, policy = await service.anc_status(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return AncStatusResponse(mac=mac, policy=policy, quarantined=policy is not None)


@router.post("/{endpoint_id}/anc-quarantine", response_model=AncActionResponse, dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def anc_quarantine(
    endpoint_id: str,
    req: AncQuarantineRequest,
    service: EndpointService = Depends(get_endpoint_service),
) -> AncActionResponse:
    """Apply an ANC quarantine policy to an endpoint."""
    try:
        ok, mac, msg = await service.anc_quarantine(endpoint_id, req.policy_name)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return AncActionResponse(ok=ok, mac=mac, message=msg)


@router.post("/{endpoint_id}/anc-clear", response_model=AncActionResponse, dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def anc_clear(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> AncActionResponse:
    """Clear the ANC quarantine policy from an endpoint."""
    try:
        ok, mac, msg = await service.anc_clear(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return AncActionResponse(ok=ok, mac=mac, message=msg)


# ------------------------------------------------------------------ #
# Decommission                                                        #
# ------------------------------------------------------------------ #

@router.post("/{endpoint_id}/decommission", dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def decommission_endpoint(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Sæt HypervisionStatus='Decommissioned' på et endpoint (soft-delete)."""
    try:
        await service.decommission_endpoint(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return {"status": "decommissioned", "id": endpoint_id}


@router.post("/bulk-decommission")
async def bulk_decommission(
    body: BulkDecommissionRequest,
    user: User = Depends(require_editor),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Decommission en liste af endpoints parallelt."""
    allowed, denied = await _split_by_scope(service, body.endpoint_ids, user)
    result = await service.bulk_decommission(BulkDecommissionRequest(endpoint_ids=allowed))
    return _merge_denied(result, denied)


@router.post("/{endpoint_id}/undecommission", dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def undecommission_endpoint(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Ryd HypervisionStatus på et dekommissioneret endpoint (genaktivering)."""
    try:
        await service.undecommission_endpoint(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return {"status": "active", "id": endpoint_id}


@router.post("/bulk-undecommission")
async def bulk_undecommission(
    body: BulkDecommissionRequest,
    user: User = Depends(require_editor),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Genaktiver en liste af dekommissionerede endpoints parallelt."""
    allowed, denied = await _split_by_scope(service, body.endpoint_ids, user)
    result = await service.bulk_undecommission(BulkDecommissionRequest(endpoint_ids=allowed))
    return _merge_denied(result, denied)


@router.post("/{endpoint_id}/active-status", dependencies=[Depends(require_editor), Depends(require_endpoint_in_scope)])
async def set_active_status(
    endpoint_id: str,
    body: SetActiveStatusRequest,
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Sæt HypervisionActive manuelt ("Aktiv" eller "Inaktiv")."""
    try:
        await service.set_active_status(endpoint_id, body.active_status)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return {"active_status": body.active_status, "id": endpoint_id}


# ------------------------------------------------------------------ #
# Bulk template-apply                                                 #
# ------------------------------------------------------------------ #

@router.post("/bulk-apply-template")
async def bulk_apply_template(
    body: BulkApplyTemplateRequest,
    user: User = Depends(require_editor),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Anvend en skabelon på en liste af endpoints parallelt."""
    allowed, denied = await _split_by_scope(service, body.endpoint_ids, user)
    try:
        result = await service.bulk_apply_template(
            BulkApplyTemplateRequest(endpoint_ids=allowed, template_id=body.template_id)
        )
        return _merge_denied(result, denied)
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


def _merge_denied(result: dict, denied: list[str]) -> dict:
    """Tilføj endpoints afvist af scope-tjekket som fejlede rækker (BUGS.md P-2)."""
    if denied:
        result.setdefault("results", []).extend(
            {"id": i, "ok": False, "error": OUT_OF_SCOPE_MSG} for i in denied
        )
    return result
