# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""System-ressource info — GET /api/sysinfo."""
from fastapi import APIRouter, Depends

from app.api.deps import require_any
from app.services import sysinfo_service

router = APIRouter(prefix="/sysinfo", tags=["sysinfo"])


@router.get("", dependencies=[Depends(require_any)])
async def get_sysinfo() -> dict:
    """CPU-, RAM- og disk-forbrug til dashboard."""
    return await sysinfo_service.get_sysinfo()
