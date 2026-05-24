# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Admin endpoints for endpoint/group cache og pre-warm worker."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from app.api.deps import require_admin
from app.core.endpoint_cache import get_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get("/stats", dependencies=[Depends(require_admin)])
async def cache_stats() -> dict:
    """Cache-statistik inkl. pre-warm worker status."""
    stats = get_cache().stats()
    # Tilføj pre-warm worker status
    try:
        from app.services.cache_prewarm import get_worker
        pw = get_worker()
        s = pw.status
        now = time.time()
        stats["prewarm"] = {
            "running":             s.running,
            "scanning":            s.scanning,
            "scan_number":         s.scan_number,
            "total_endpoints":     s.total_endpoints,
            "scanned":             s.scanned,
            "skipped":             s.skipped,
            "deleted":             s.deleted,
            "disk_loaded":         s.disk_loaded,
            "hot_queue_size":      s.hot_queue_size,
            "last_error":          s.last_error,
            "last_full_scan_at":   s.last_full_scan_at,
            "last_disk_save_at":   s.last_disk_save_at,
            "last_full_scan_age_s": round(now - s.last_full_scan_at, 0) if s.last_full_scan_at else None,
            # Drip-refresh metrics
            "drip_refreshed_total":       s.drip_refreshed_total,
            "drip_skipped_total":         s.drip_skipped_total,
            "drip_current_sleep_s":       round(s.drip_current_sleep_s, 2),
            "drip_estimated_full_cycle_s": round(s.drip_estimated_full_cycle_s, 0) if s.drip_estimated_full_cycle_s is not None else None,
        }
    except Exception:  # noqa: BLE001
        stats["prewarm"] = None
    return stats


@router.post("/invalidate", dependencies=[Depends(require_admin)])
async def cache_invalidate() -> dict:
    get_cache().invalidate_all()
    return {"status": "cleared"}
