# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import asyncio
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from app.api.deps import (
    get_current_user,
    get_endpoint_service,
    require_any,
    require_create_endpoint,
    require_edit_endpoint,
    require_editor,
    require_register_lookup,
)
from app.core.endpoint_cache import get_cache
from app.core.exceptions import IseApiError
from app.schemas.endpoint import (
    AncActionResponse,
    AncPoliciesResponse,
    AncQuarantineRequest,
    AncStatusResponse,
    BulkCreateRequest,
    BulkResult,
    CoaReauthResponse,
    CreateEndpointRequest,
    EndpointDetail,
    EndpointSummary,
    EndpointUpdate,
    PaginatedEndpointDetails,
)
from app.schemas.user import User
from app.services import user_service
from app.services.endpoint_service import EndpointService

router = APIRouter(prefix="/endpoints", tags=["endpoints"])


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
    """Returnér username der skal auto-tagges på write, eller None for admin.

    Non-admin (editor/viewer/registrar) får deres username som fallback-tag
    på create/update hvis ``HypervisionRoles`` ikke eksplicit er valgt.
    Admin overrides ingenting.
    """
    if user.role == "admin":
        return None
    return user.username


def _is_psk_editor_for(user: User) -> bool:
    return user.role in ("admin", "editor-psk")


@router.get("", response_model=list[EndpointSummary])
async def list_endpoints(
    page: int = 1,
    size: int = 100,
    search: str | None = None,
    filter: list[str] | None = Query(default=None),
    user: User = Depends(require_any),
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointSummary]:
    try:
        return await service.list_endpoints(
            page=page,
            size=size,
            search=search,
            filters=filter,
            effective_roles=_scope_for(user),
        )
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


@router.get("/details", response_model=PaginatedEndpointDetails)
async def list_endpoint_details(
    page: int = 1,
    size: int = 100,
    search: str | None = None,
    filter: list[str] | None = Query(default=None),
    user: User = Depends(require_any),
    service: EndpointService = Depends(get_endpoint_service),
) -> PaginatedEndpointDetails:
    """List endpoints with full details including custom attributes."""
    try:
        return await service.list_endpoint_details(
            page=page,
            size=size,
            search=search,
            filters=filter,
            effective_roles=_scope_for(user),
            is_psk_editor=_is_psk_editor_for(user),
        )
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


@router.get("/details/all", response_model=list[EndpointDetail])
async def list_all_endpoint_details(
    search: str | None = None,
    q: str | None = Query(None, description="Fritekst-søgning: MAC, gruppe, profil, owner, lokation, beskrivelse, vendor"),
    filter: list[str] | None = Query(default=None),
    user: User = Depends(require_register_lookup),
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointDetail]:
    """Fetch ALL endpoints with full details across all ISE pages.

    Registrar er tilladt fordi register-viewets "Mine endpoints"-knap
    bruger dette endpoint. Service-laget filtrerer pr. effektive roller
    (registrar's username + assigned System adm), så registrar ser kun
    egne endpoints — ikke en privilegie-eskalering.
    """
    try:
        return await service.list_all_endpoint_details(
            search=search,
            filters=filter,
            effective_roles=_scope_for(user),
            is_psk_editor=_is_psk_editor_for(user),
            full_text_q=q,
        )
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


@router.get("/session-macs", response_model=list[str], dependencies=[Depends(require_any)])
async def list_session_macs(
    service: EndpointService = Depends(get_endpoint_service),
) -> list[str]:
    """Return MAC-addresses that currently have an active RADIUS session in
    ISE MnT. Used by the Browse/Edit view to color the row selector green
    (authenticated in access) or red (no active session).
    """
    try:
        return await service.list_active_session_macs()
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


@router.post("/{endpoint_id}/prioritize", status_code=status.HTTP_202_ACCEPTED)
async def prioritize_endpoint(
    endpoint_id: str,
    _user: User = Depends(require_any),
) -> dict[str, str]:
    """Sæt et endpoint forrest i pre-warm refresh-køen.

    Kaldes af edit-modal ved åbning så baggrunds pre-warm workeren
    prioriterer dette endpoint og cachen hurtigt afspejler live ISE-data.
    """
    from app.services.cache_prewarm import get_worker as get_prewarm_worker
    get_prewarm_worker().prioritize(endpoint_id)
    return {"status": "queued", "id": endpoint_id}


@router.get("/{endpoint_id}/profiler-profile")
async def get_profiler_profile_for_endpoint(
    endpoint_id: str,
    _user: User = Depends(require_any),
) -> dict:
    """Hent ISE profilerprofile-definition for det profile der er tildelt et endpoint.

    1. Henter endpoint fra ISE ERS for at finde profileId.
    2. Henter /ers/config/profilerprofile/{profileId} og returnerer definitionen.
    """
    from app.ise.client import get_ise_client

    client = get_ise_client()
    try:
        ep_data = await client.get(f"/ers/config/endpoint/{endpoint_id}")
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc

    ers_ep = (ep_data or {}).get("ERSEndPoint", {})
    profile_id = ers_ep.get("profileId", "")

    if not profile_id:
        return {"endpoint_id": endpoint_id, "profile_id": None, "profile": None}

    try:
        profile_data = await client.get(f"/ers/config/profilerprofile/{profile_id}")
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc

    profile = dict((profile_data or {}).get("ProfilerProfile", {}))
    profile.pop("link", None)

    return {"endpoint_id": endpoint_id, "profile_id": profile_id, "profile": profile}


@router.get("/{endpoint_id}/profiling-data")
async def get_endpoint_profiling_data(
    endpoint_id: str,
    _user: User = Depends(require_any),
) -> dict:
    """Hent alle ISE probe-attributter (DHCP, HTTP, MDM, netværk osv.)
    for et endpoint fra ISE Open API. Bruges til profileringsdata-visning i detail-modal.
    """
    from app.ise.client import get_ise_client
    from app.ise.profiling import get_endpoint_profiling_data as _get_profiling

    client = get_ise_client()
    try:
        return await _get_profiling(client, endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


@router.get("/{endpoint_id}", response_model=EndpointDetail)
async def get_endpoint(
    endpoint_id: str,
    response: Response,
    user: User = Depends(require_any),
    service: EndpointService = Depends(get_endpoint_service),
) -> EndpointDetail:
    cache = get_cache()
    # Edit-modal skal altid vise aktuelle ISE-data. Concurrent requests
    # (pre-warm hot-queue, to browsere) koalescerer til ét ISE-kald via
    # _inflight_detail i cache i stedet for at ramme ISE selvstændigt.
    try:
        detail = await service.get_endpoint(
            endpoint_id,
            effective_roles=_scope_for(user),
            is_psk_editor=_is_psk_editor_for(user),
            force_fresh=True,
        )
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    if cache.enabled():
        age = cache.detail_age(endpoint_id)
        response.headers["X-Cache-Enabled"] = "true"
        if age is not None:
            response.headers["X-Cache-Age-Seconds"] = f"{age:.2f}"
    else:
        response.headers["X-Cache-Enabled"] = "false"
    return detail


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    req: CreateEndpointRequest,
    user: User = Depends(require_create_endpoint),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict[str, str]:
    try:
        new_id = await service.create_endpoint(
            req, auto_tag_username=_autotag_for(user)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return {"status": "created", "id": new_id}


@router.post("/bulk", response_model=BulkResult)
async def bulk_create_endpoints(
    req: BulkCreateRequest,
    user: User = Depends(require_editor),
    service: EndpointService = Depends(get_endpoint_service),
) -> BulkResult:
    # Partial failures are reported in the response; no 502 here.
    return await service.bulk_create(req, auto_tag_username=_autotag_for(user))


@router.put("/{endpoint_id}")
async def update_endpoint(
    endpoint_id: str,
    req: EndpointUpdate,
    user: User = Depends(require_edit_endpoint),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict[str, str]:
    try:
        await service.update_endpoint(
            endpoint_id, req, auto_tag_username=_autotag_for(user)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc
    return {"status": "updated"}


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_editor)])
async def delete_endpoint(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> None:
    try:
        await service.delete_endpoint(endpoint_id)
    except IseApiError as exc:
        raise _ise_http_error(exc) from exc


@router.post("/{endpoint_id}/coa-reauth", response_model=CoaReauthResponse, dependencies=[Depends(require_editor)])
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


@router.post("/{endpoint_id}/coa-disconnect", response_model=CoaReauthResponse, dependencies=[Depends(require_editor)])
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


@router.post("/bulk-coa", dependencies=[Depends(require_editor)])
async def bulk_coa(
    body: BulkCoaRequest,
    service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Trigger CoA reauth eller disconnect for en liste af endpoints parallelt."""
    sem = asyncio.Semaphore(3)

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

    results = list(await asyncio.gather(*(do_one(ep_id) for ep_id in body.endpoint_ids[:200])))
    return {"results": results, "ok_count": sum(1 for r in results if r["ok"])}


# ------------------------------------------------------------------ #
# Endpoint historik (audit trail)                                     #
# ------------------------------------------------------------------ #

@router.get("/{endpoint_id}/history", dependencies=[Depends(require_editor)])
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


@router.get("/{endpoint_id}/anc-status", response_model=AncStatusResponse, dependencies=[Depends(require_editor)])
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


@router.post("/{endpoint_id}/anc-quarantine", response_model=AncActionResponse, dependencies=[Depends(require_editor)])
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


@router.post("/{endpoint_id}/anc-clear", response_model=AncActionResponse, dependencies=[Depends(require_editor)])
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
