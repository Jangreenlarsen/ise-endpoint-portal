# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""API router for ISE Authorization Profiles (admin only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_authz_profile_service, require_admin, require_any
from app.core.exceptions import IseApiError
from app.schemas.authz_profile import (
    AuthzProfileDetail,
    AuthzProfileStatus,
    AuthzProfileSummary,
    StandardProfilesResult,
)
from app.services.authz_profile_service import AuthzProfileService

router = APIRouter(prefix="/authz-profiles", tags=["authz-profiles"])


@router.get(
    "",
    response_model=list[AuthzProfileSummary],
    dependencies=[Depends(require_admin)],
)
async def list_authz_profiles(
    service: AuthzProfileService = Depends(get_authz_profile_service),
) -> list[AuthzProfileSummary]:
    try:
        return await service.list_all()
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get(
    "/standard/status",
    response_model=list[AuthzProfileStatus],
    dependencies=[Depends(require_admin)],
)
async def check_standard_profiles(
    service: AuthzProfileService = Depends(get_authz_profile_service),
) -> list[AuthzProfileStatus]:
    try:
        return await service.check_standard_profiles()
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post(
    "/standard/ensure",
    response_model=StandardProfilesResult,
    dependencies=[Depends(require_admin)],
)
async def ensure_standard_profiles(
    service: AuthzProfileService = Depends(get_authz_profile_service),
) -> StandardProfilesResult:
    try:
        return await service.ensure_standard_profiles()
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get(
    "/{name}/raw",
    response_model=dict,
    dependencies=[Depends(require_admin)],
)
async def get_authz_profile_raw(
    name: str,
    service: AuthzProfileService = Depends(get_authz_profile_service),
) -> dict:
    """Debug: returnerer rå ISE ERS-respons for profilen uden parsing."""
    raw = await service.get_raw(name)
    if raw is None:
        raise HTTPException(status_code=404, detail=f"Profil '{name}' ikke fundet i ISE")
    return raw


@router.get(
    "/{name}",
    response_model=AuthzProfileDetail,
    dependencies=[Depends(require_any)],
)
async def get_authz_profile(
    name: str,
    service: AuthzProfileService = Depends(get_authz_profile_service),
) -> AuthzProfileDetail:
    try:
        detail = await service.get_detail(name)
    except IseApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Profil '{name}' ikke fundet i ISE")
    return detail
