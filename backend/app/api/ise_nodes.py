# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""ISE node-status API."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_admin
from app.ise.client import get_ise_client
from app.ise.nodes import list_nodes

router = APIRouter(prefix="/ise", tags=["ise"])


@router.get("/nodes", dependencies=[Depends(require_admin)])
async def get_ise_nodes() -> dict:
    """Returnér alle ISE-noder med roller, services og reachability."""
    nodes = await list_nodes(get_ise_client())
    return {
        "nodes": nodes,
        "total": len(nodes),
        "reachable": sum(1 for n in nodes if n.get("reachable")),
    }


@router.get("/connection", dependencies=[Depends(require_admin)])
async def get_ise_connection() -> dict:
    """Live Primary/Secondary(læse-host) kommunikations-status ud fra seneste
    rigtige ISE-trafik. Ingen ekstra ISE-kald — instant."""
    return get_ise_client().node_status()


@router.post("/connection/probe", dependencies=[Depends(require_admin)])
async def probe_ise_connection() -> dict:
    """Aktiv probe: rå ERS-GET mod hver konfigureret node (parallelt). Til
    'Test nu'-knappen — bekræfter om Primary/læse-host svarer lige nu."""
    return await get_ise_client().probe()
