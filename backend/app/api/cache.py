"""Admin endpoints for the endpoint/group cache (2.8.0).

Stats are useful for tuning TTL and verifying hit-rate; the invalidate
endpoint is a manual escape hatch when the cache needs to be dropped
without bouncing the backend.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_admin, require_any
from app.core.endpoint_cache import get_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get("/stats", dependencies=[Depends(require_admin)])
async def cache_stats() -> dict[str, object]:
    return get_cache().stats()


@router.post("/invalidate", dependencies=[Depends(require_any)])
async def cache_invalidate() -> dict[str, str]:
    get_cache().invalidate_all()
    return {"status": "cleared"}
