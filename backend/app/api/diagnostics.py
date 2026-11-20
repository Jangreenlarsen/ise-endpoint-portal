# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from fastapi import APIRouter, Depends, Query

from app.api.deps import require_admin, require_any
from app.services import diagnostics_service, endpoint_fetch_probe

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/quick", dependencies=[Depends(require_any)])
async def get_diagnostics_quick() -> dict:
    """Hurtig system-status til dashboard — ingen live ISE-GET, ingen git subprocess."""
    return await diagnostics_service.run_quick()


@router.get("", dependencies=[Depends(require_admin)])
async def get_diagnostics() -> dict:
    """Kør fuld systemdiagnostik: alle afhængigheder og tjenester."""
    return await diagnostics_service.run_all()


@router.post("/endpoint-fetch-probe", dependencies=[Depends(require_admin)])
async def run_endpoint_fetch_probe(
    pages: int = Query(3, ge=0, le=endpoint_fetch_probe.MAX_EXTRA_PAGES),
) -> dict:
    """Test om Open API-listen kan erstatte ERS N+1 ved cache-scanning.

    Kun GET-kald mod ISE (højst ca. 20). `pages` = ekstra Open API-sider til
    gennemløbsmålingen.
    """
    return await endpoint_fetch_probe.run_probe(extra_pages=pages)
