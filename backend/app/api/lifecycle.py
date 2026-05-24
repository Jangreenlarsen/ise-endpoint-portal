# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Endpoint livscyklus: find endpoints med ingen portal-aktivitet i X dage."""
from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_admin
from app.core.audit_store import DB_PATH
from app.core.endpoint_cache import get_cache
from app.core import first_seen_store
from app.services.cache_prewarm import get_worker as get_prewarm_worker

router = APIRouter(prefix="/lifecycle", tags=["lifecycle"])


@router.get("/stale", dependencies=[Depends(require_admin)])
async def get_stale_endpoints(
    days: int = Query(90, ge=1, le=730),
) -> dict:
    """Returnér endpoints fra cachen der ikke har haft portal-aktivitet i `days` dage.

    "Aktivitet" = audit-event (opret, opdatér, slet) registreret i audit-loggen.
    Endpoints uden nogen audit-records tæller altid som stale.
    """
    cache = get_cache()
    all_ids = set(cache.detail_ids())
    total_cached = len(all_ids)

    if not all_ids:
        cache_loading = not get_prewarm_worker().cache_ready
        return {
            "stale": [], "total_cached": 0, "stale_count": 0,
            "threshold_days": days, "cache_loading": cache_loading,
        }

    threshold_iso = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(
        "%Y-%m-%dT%H:%M:%S"
    )

    # Find endpoints med nylig aktivitet i audit-loggen
    id_list = list(all_ids)
    placeholders = ",".join("?" * len(id_list))
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT resource_id, MAX(ts) AS last_ts "
            f"FROM audit_events "
            f"WHERE resource_type='endpoint' AND resource_id IN ({placeholders}) "
            f"GROUP BY resource_id "
            f"HAVING MAX(ts) >= ?",
            id_list + [threshold_iso],
        ).fetchall()
        conn.close()
        active_ids = {r["resource_id"] for r in rows}
    except Exception:  # noqa: BLE001
        active_ids = set()

    stale_ids = all_ids - active_ids

    # Byg stale-liste med endpoint-detaljer fra cache
    stale = []
    now = time.time()
    for ep_id in stale_ids:
        age_s = cache.detail_age(ep_id)
        entry = cache._details.get(ep_id)
        value = entry.value if entry else None
        stale.append({
            "id": ep_id,
            "mac": getattr(value, "mac", None) or ep_id,
            "group_name": getattr(value, "group_name", None) or "",
            "profile": getattr(value, "profile", None) or "",
            "owner": getattr(value, "owner", None) or "",
            "cache_age_s": round(age_s, 0) if age_s is not None else None,
        })

    stale.sort(key=lambda x: x["mac"])

    # Tilføj first_seen_at fra first_seen_store (batch-lookup)
    fs_map = first_seen_store.get_many([ep["mac"] for ep in stale])
    for ep in stale:
        ep["first_seen_at"] = fs_map.get(ep["mac"].upper().strip())

    return {
        "stale": stale,
        "total_cached": total_cached,
        "stale_count": len(stale),
        "threshold_days": days,
        "cache_loading": False,
    }
