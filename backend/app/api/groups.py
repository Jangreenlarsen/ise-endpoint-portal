# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_endpoint_service, require_register_lookup
from app.core.exceptions import IseApiError
from app.schemas.endpoint import EndpointGroupSummary
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
