from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import (
    get_dacl_service,
    require_any,
    require_editor,
    require_register_lookup,
)
from app.core.exceptions import IseApiError
from app.schemas.dacl import (
    CreateDaclRequest,
    DaclDetail,
    DaclSummary,
    DaclValidationResult,
    UpdateDaclRequest,
    ValidateDaclRequest,
)
from app.services.dacl_service import DaclService, validate_dacl

router = APIRouter(prefix="/dacls", tags=["dacls"])


@router.get("", response_model=list[DaclSummary], dependencies=[Depends(require_register_lookup)])
async def list_dacls(
    service: DaclService = Depends(get_dacl_service),
) -> list[DaclSummary]:
    try:
        return await service.list_summaries()
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{dacl_id}", response_model=DaclDetail, dependencies=[Depends(require_any)])
async def get_dacl(
    dacl_id: str,
    service: DaclService = Depends(get_dacl_service),
) -> DaclDetail:
    try:
        return await service.get(dacl_id)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("", status_code=status.HTTP_201_CREATED,
             response_model=DaclDetail, dependencies=[Depends(require_editor)])
async def create_dacl(
    req: CreateDaclRequest,
    service: DaclService = Depends(get_dacl_service),
) -> DaclDetail:
    try:
        return await service.create(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/{dacl_id}", response_model=DaclDetail, dependencies=[Depends(require_editor)])
async def update_dacl(
    dacl_id: str,
    req: UpdateDaclRequest,
    service: DaclService = Depends(get_dacl_service),
) -> DaclDetail:
    try:
        return await service.update(dacl_id, req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/{dacl_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_editor)])
async def delete_dacl(
    dacl_id: str,
    service: DaclService = Depends(get_dacl_service),
) -> None:
    try:
        await service.delete(dacl_id)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/validate", response_model=DaclValidationResult,
             dependencies=[Depends(require_any)])
async def validate(req: ValidateDaclRequest) -> DaclValidationResult:
    """Real-time syntaks-tjek (Cisco IOS-style ACE per linje)."""
    return validate_dacl(req.dacl, req.dacl_type)
