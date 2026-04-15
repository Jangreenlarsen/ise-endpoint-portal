from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_endpoint_service
from app.core.exceptions import IseApiError
from app.schemas.endpoint import EndpointGroupSummary
from app.services.endpoint_service import EndpointService

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("", response_model=list[EndpointGroupSummary])
async def list_groups(
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointGroupSummary]:
    try:
        return await service.list_groups()
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
