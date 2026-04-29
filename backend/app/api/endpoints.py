from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import (
    get_current_user,
    get_endpoint_service,
    require_any,
    require_create_endpoint,
    require_editor,
)
from app.core.endpoint_cache import get_cache
from app.core.exceptions import IseApiError
from app.schemas.endpoint import (
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
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
        )
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/details/all", response_model=list[EndpointDetail])
async def list_all_endpoint_details(
    search: str | None = None,
    filter: list[str] | None = Query(default=None),
    user: User = Depends(require_any),
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointDetail]:
    """Fetch ALL endpoints with full details across all ISE pages."""
    try:
        return await service.list_all_endpoint_details(
            search=search,
            filters=filter,
            effective_roles=_scope_for(user),
        )
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{endpoint_id}", response_model=EndpointDetail)
async def get_endpoint(
    endpoint_id: str,
    response: Response,
    user: User = Depends(require_any),
    service: EndpointService = Depends(get_endpoint_service),
) -> EndpointDetail:
    try:
        detail = await service.get_endpoint(
            endpoint_id, effective_roles=_scope_for(user)
        )
    except IseApiError as exc:
        # 404 fra service betyder enten ISE ikke har endpointet, eller
        # det ligger udenfor brugerens scope. I begge tilfælde returnerer
        # vi 404 til klienten — bevidst, så scope-grænsen ikke leakes.
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail="Endpoint ikke fundet") from exc
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # Expose cache age so the frontend can distinguish fresh fetches from
    # cache hits without a separate call.
    cache = get_cache()
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
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
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
    user: User = Depends(require_editor),
    service: EndpointService = Depends(get_endpoint_service),
) -> dict[str, str]:
    try:
        await service.update_endpoint(
            endpoint_id, req, auto_tag_username=_autotag_for(user)
        )
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": "updated"}


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_editor)])
async def delete_endpoint(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> None:
    try:
        await service.delete_endpoint(endpoint_id)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{endpoint_id}/coa-reauth", response_model=CoaReauthResponse, dependencies=[Depends(require_editor)])
async def coa_reauth(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> CoaReauthResponse:
    """Trigger CoA reauth on ISE for the given endpoint's MAC."""
    try:
        ok, mac, msg = await service.coa_reauth(endpoint_id)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
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
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return CoaReauthResponse(ok=ok, mac=mac, message=msg)
