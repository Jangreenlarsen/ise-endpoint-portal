from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_endpoint_service
from app.core.exceptions import IseApiError
from app.schemas.endpoint import (
    BulkCreateRequest,
    BulkResult,
    CreateEndpointRequest,
    EndpointDetail,
    EndpointSummary,
    EndpointUpdate,
    PaginatedEndpointDetails,
)
from app.services.endpoint_service import EndpointService

router = APIRouter(prefix="/endpoints", tags=["endpoints"])


@router.get("", response_model=list[EndpointSummary])
async def list_endpoints(
    page: int = 1,
    size: int = 100,
    search: str | None = None,
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointSummary]:
    try:
        return await service.list_endpoints(page=page, size=size, search=search)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/details", response_model=PaginatedEndpointDetails)
async def list_endpoint_details(
    page: int = 1,
    size: int = 100,
    search: str | None = None,
    service: EndpointService = Depends(get_endpoint_service),
) -> PaginatedEndpointDetails:
    """List endpoints with full details including custom attributes."""
    try:
        return await service.list_endpoint_details(
            page=page, size=size, search=search
        )
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/details/all", response_model=list[EndpointDetail])
async def list_all_endpoint_details(
    search: str | None = None,
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointDetail]:
    """Fetch ALL endpoints with full details across all ISE pages."""
    try:
        return await service.list_all_endpoint_details(search=search)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{endpoint_id}", response_model=EndpointDetail)
async def get_endpoint(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> EndpointDetail:
    try:
        return await service.get_endpoint(endpoint_id)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    req: CreateEndpointRequest,
    service: EndpointService = Depends(get_endpoint_service),
) -> dict[str, str]:
    try:
        new_id = await service.create_endpoint(req)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": "created", "id": new_id}


@router.post("/bulk", response_model=BulkResult)
async def bulk_create_endpoints(
    req: BulkCreateRequest,
    service: EndpointService = Depends(get_endpoint_service),
) -> BulkResult:
    # Partial failures are reported in the response; no 502 here.
    return await service.bulk_create(req)


@router.put("/{endpoint_id}")
async def update_endpoint(
    endpoint_id: str,
    req: EndpointUpdate,
    service: EndpointService = Depends(get_endpoint_service),
) -> dict[str, str]:
    try:
        await service.update_endpoint(endpoint_id, req)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": "updated"}


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_endpoint(
    endpoint_id: str,
    service: EndpointService = Depends(get_endpoint_service),
) -> None:
    try:
        await service.delete_endpoint(endpoint_id)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
