# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""To-faset funktionsgennemgang — GET /feature-check/phase1 og /phase2."""
from fastapi import APIRouter, Depends

from app.api.deps import require_admin
from app.services import feature_check_service

router = APIRouter(prefix="/feature-check", tags=["feature-check"])


@router.get("/phase1", dependencies=[Depends(require_admin)])
async def get_phase1() -> dict:
    """Fase 1: statiske tjek — ingen netværkskald, < 200 ms."""
    return await feature_check_service.run_phase1()


@router.get("/phase2", dependencies=[Depends(require_admin)])
async def get_phase2() -> dict:
    """Fase 2: live ISE-test — netværkskald, 5-15 s."""
    return await feature_check_service.run_phase2()
