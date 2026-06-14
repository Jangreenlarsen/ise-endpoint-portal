# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from fastapi import APIRouter, Depends

from app.core.auth import require_admin
from app.services import diagnostics_service

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("", dependencies=[Depends(require_admin)])
async def get_diagnostics() -> dict:
    """Kør systemdiagnostik: tjek alle afhængigheder og system-sundhed."""
    return await diagnostics_service.run_all()
