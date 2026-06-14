# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from fastapi import APIRouter, Depends

from app.api.deps import require_admin, require_any
from app.services import diagnostics_service

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/quick", dependencies=[Depends(require_any)])
async def get_diagnostics_quick() -> dict:
    """Hurtig system-status til dashboard — ingen live ISE-GET, ingen git subprocess."""
    return await diagnostics_service.run_quick()


@router.get("", dependencies=[Depends(require_admin)])
async def get_diagnostics() -> dict:
    """Kør fuld systemdiagnostik: alle afhængigheder og tjenester."""
    return await diagnostics_service.run_all()
