"""OUI → vendor lookup API (2.11.0).

Used by the Create form to auto-suggest Type/PlatformType from the MAC.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_register_lookup
from app.core.oui_lookup import lookup, stats

router = APIRouter(prefix="/oui", tags=["oui"])


@router.get("/stats", dependencies=[Depends(require_register_lookup)])
async def oui_stats() -> dict[str, int]:
    return stats()


@router.get("/{mac}", dependencies=[Depends(require_register_lookup)])
async def oui_lookup_one(mac: str) -> dict[str, str]:
    vendor = lookup(mac)
    return {"mac": mac, "vendor": vendor}
