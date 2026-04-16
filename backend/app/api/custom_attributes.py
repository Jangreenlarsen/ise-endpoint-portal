from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_custom_attribute_service
from app.schemas.custom_attribute import (
    AddValueRequest,
    AllCustomAttributes,
    SyncResult,
)
from app.services.custom_attribute_service import CustomAttributeService

router = APIRouter(prefix="/custom-attributes", tags=["custom-attributes"])


@router.get("", response_model=AllCustomAttributes)
async def list_custom_attributes(
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> AllCustomAttributes:
    return service.list_all()


@router.post("/{attr_name}/values", response_model=AllCustomAttributes)
async def add_value(
    attr_name: str,
    req: AddValueRequest,
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> AllCustomAttributes:
    try:
        return service.add_value(attr_name, req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{attr_name}/values/{value}", response_model=AllCustomAttributes)
async def remove_value(
    attr_name: str,
    value: str,
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> AllCustomAttributes:
    try:
        return service.remove_value(attr_name, value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync", response_model=SyncResult)
async def sync_from_ise(
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> SyncResult:
    return await service.sync_from_ise()
