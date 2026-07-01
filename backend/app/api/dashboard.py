# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Dashboard-API: aggregeret overblik over portal-sundhed."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from app.api.deps import require_any
from app.core import audit_store
from app.core.endpoint_cache import get_cache

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", dependencies=[Depends(require_any)])
async def get_dashboard() -> dict:
    """Aggregeret portal-status: endpoints, sessioner, circuit breaker, cache og seneste events."""
    cache = get_cache()
    stats = cache.stats()

    # Pre-warm worker status
    prewarm_data: dict = {}
    try:
        from app.services.cache_prewarm import get_worker
        pw = get_worker().status
        now = time.time()
        prewarm_data = {
            "scan_number": pw.scan_number,
            "total_endpoints": pw.total_endpoints,
            "last_full_scan_age_s": round(now - pw.last_full_scan_at, 0) if pw.last_full_scan_at else None,
            "drip_cycle_s": pw.drip_estimated_full_cycle_s,
            "drip_sleep_s": pw.drip_current_sleep_s,
            "drip_refreshed_total": pw.drip_refreshed_total,
            "drip_skipped_total": pw.drip_skipped_total,
            "scanning": pw.scanning,
            "disk_loaded_at_startup": pw.disk_loaded,
            "hot_queue_size": pw.hot_queue_size,
        }
    except Exception:  # noqa: BLE001
        pass

    # pxGrid session count
    session_count = 0
    try:
        from app.pxgrid.session_cache import get_cache as get_sess_cache
        sess_stats = get_sess_cache().stats()
        session_count = sess_stats.get("size", 0)
    except Exception:  # noqa: BLE001
        pass

    # Circuit breaker state (0=closed, 1=half_open, 2=open)
    cb_state = 0
    try:
        from app.core.metrics import CIRCUIT_STATE
        for mf in CIRCUIT_STATE.collect():
            for sample in mf.samples:
                cb_state = int(sample.value)
    except Exception:  # noqa: BLE001
        pass

    # ISE auth status — eksponerer consecutive 401-tæller og lockout-tidspunkt
    ise_auth: dict = {"status": "ok", "consecutive_401s": 0, "locked_since": None}
    try:
        from app.ise.client import get_ise_client
        ise_auth = get_ise_client().auth_status()
    except Exception:  # noqa: BLE001
        pass

    # Hit rate
    hits = stats.get("hits", 0)
    misses = stats.get("misses", 0)
    stale_serves = stats.get("stale_serves", 0)
    total_req = hits + misses + stale_serves
    hit_rate_pct = round((hits + stale_serves) / total_req * 100, 1) if total_req > 0 else None

    # Recent audit events
    recent_rows, _ = await audit_store.query(limit=5, offset=0)
    recent_events = [
        {
            "id": r["id"],
            "ts": r["ts"],
            "actor_username": r["actor_username"],
            "action": r["action"],
            "resource_type": r["resource_type"],
            "resource_id": r.get("resource_id"),
        }
        for r in recent_rows
    ]

    return {
        "endpoints": {
            "total": stats["detail_entries"],
            "staleness": stats.get("staleness", {}),
        },
        "sessions": {
            "active": session_count,
        },
        "circuit_breaker": {
            "state": cb_state,
            "state_label": ["closed", "half_open", "open"][cb_state] if cb_state in (0, 1, 2) else "unknown",
        },
        "cache": {
            "hit_rate_pct": hit_rate_pct,
            "hits": hits,
            "misses": misses,
            "stale_serves": stale_serves,
            "disk_stale": stats.get("disk_stale_entries", 0),
            "disk_loaded_at_startup": prewarm_data.get("disk_loaded_at_startup", 0),
            "detail_entries": stats.get("detail_entries", 0),
            "tiers": stats.get("tiers", {}),
            "staleness": stats.get("staleness", {}),
            "total_bytes": stats.get("total_bytes", 0),
            "max_memory_bytes": stats.get("max_memory_bytes", 0),
            "inflight": stats.get("inflight_detail_refreshes", 0),
            "evictions": stats.get("evictions", 0),
            "ttl_seconds": stats.get("ttl_seconds", 0),
        },
        "prewarm": prewarm_data,
        "recent_events": recent_events,
        "ise_auth": ise_auth,
    }
