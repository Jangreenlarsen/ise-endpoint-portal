# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""nmap-scan API — POST /nmap/scan."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import require_register_lookup
from app.core.users import User
from app.services import nmap_service

router = APIRouter(prefix="/nmap", tags=["nmap"])


class NmapScanRequest(BaseModel):
    ip: str = Field(..., description="IP-adresse der skal scannes")
    preset: str | None = Field(None, description="ping | top1000 | service | os")
    custom_flags: str | None = Field(None, description="Brugerdefinerede nmap-flag (valgfrit)")


class NmapScanResult(BaseModel):
    ip: str
    cmd: str
    output: str
    returncode: int
    duration: float


@router.post("/scan", response_model=NmapScanResult)
async def scan(req: NmapScanRequest, user: User = Depends(require_register_lookup)) -> NmapScanResult:
    """Kør nmap mod req.ip med det valgte preset eller custom flags."""
    try:
        result = await nmap_service.run_scan(req.ip, req.preset, req.custom_flags)
    except nmap_service.NmapError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return NmapScanResult(**result)
