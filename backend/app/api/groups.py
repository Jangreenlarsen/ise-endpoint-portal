# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_endpoint_service, require_admin, require_register_lookup
from app.core.exceptions import IseApiError
from app.schemas.endpoint import EndpointGroupCreate, EndpointGroupCreated, EndpointGroupSummary
from app.services.endpoint_service import EndpointService

# Registrar har brug for groups-dropdown'en i opret-formularen, derfor
# require_register_lookup (= admin/editor/viewer/registrar) i stedet for
# require_any (som ikke inkluderer registrar).
router = APIRouter(prefix="/groups", tags=["groups"], dependencies=[Depends(require_register_lookup)])


@router.get("", response_model=list[EndpointGroupSummary])
async def list_groups(
    service: EndpointService = Depends(get_endpoint_service),
) -> list[EndpointGroupSummary]:
    try:
        return await service.list_groups()
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("", response_model=EndpointGroupCreated, status_code=201, dependencies=[Depends(require_admin)])
async def create_group(
    payload: EndpointGroupCreate,
    service: EndpointService = Depends(get_endpoint_service),
) -> EndpointGroupCreated:
    try:
        new_id = await service.create_group(payload.name, payload.description)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return EndpointGroupCreated(id=new_id, name=payload.name)
