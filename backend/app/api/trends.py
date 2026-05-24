# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Trend-analyse API — endpoint tilgang/fragang og LAA (private MAC) historik.

Spørger audit_events-tabellen for create/delete-events på endpoints inden for
en valgbar periode (7d / 30d / 90d / 365d) og returnerer daglige tæller.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_any
from app.core import first_seen_store
from app.core.endpoint_cache import get_cache
from app.schemas.user import User
from app.services.cache_prewarm import get_worker as get_prewarm_worker

router = APIRouter(prefix="/trends", tags=["trends"])

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}


def _is_laa(mac: str) -> bool:
    try:
        first = int(mac.replace(":", "").replace("-", "")[:2], 16)
        return bool(first & 0x02)
    except (ValueError, IndexError):
        return False



@router.get("", dependencies=[Depends(require_any)])
async def get_trends(
    period: str = Query("30d"),
    _user: User = Depends(require_any),
) -> dict:
    """Returnerer daglige endpoint-tilgang/fragang og LAA-tæller for valgt periode."""
    days = _PERIOD_DAYS.get(period, 30)

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    # Byg dato-labels (YYYY-MM-DD) for perioden
    labels = [
        (start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days + 1)
    ]

    # Forespørg first_seen_store — afspejler alle ISE-endpoints portalen har set
    added_by_day: dict[str, int] = defaultdict(int)
    removed_by_day: dict[str, int] = defaultdict(int)
    laa_added_by_day: dict[str, int] = defaultdict(int)
    laa_removed_by_day: dict[str, int] = defaultdict(int)

    start_ts = start.timestamp()

    try:
        for mac, ts in first_seen_store.get_added_since(start_ts):
            day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            added_by_day[day] += 1
            if _is_laa(mac):
                laa_added_by_day[day] += 1

        for mac, ts in first_seen_store.get_removed_since(start_ts):
            day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            removed_by_day[day] += 1
            if _is_laa(mac):
                laa_removed_by_day[day] += 1
    except Exception:
        pass

    added = [added_by_day.get(d, 0) for d in labels]
    removed = [removed_by_day.get(d, 0) for d in labels]
    net = [a - r for a, r in zip(added, removed)]
    laa_added = [laa_added_by_day.get(d, 0) for d in labels]
    laa_removed = [laa_removed_by_day.get(d, 0) for d in labels]

    # Aktuel snapshot fra cache
    cache = get_cache()
    total = 0
    laa_now = 0
    if cache:
        details = cache._details
        total = len(details)
        for entry in details.values():
            ep = entry.value
            if not ep:
                continue
            mac = (
                ep.get("mac") or ep.get("name", "")
                if isinstance(ep, dict)
                else getattr(ep, "mac", None) or getattr(ep, "name", "") or ""
            )
            try:
                if mac and int(str(mac).replace(":", "").replace("-", "")[:2], 16) & 0x02:
                    laa_now += 1
            except (ValueError, IndexError):
                pass

    cache_loading = total == 0 and not get_prewarm_worker().cache_ready
    prewarm_status = get_prewarm_worker().status
    last_scan_at = prewarm_status.last_full_scan_at

    return {
        "period": period,
        "labels": labels,
        "added": added,
        "removed": removed,
        "net": net,
        "laa_added": laa_added,
        "laa_removed": laa_removed,
        "snapshot": {
            "total": total,
            "laa": laa_now,
            "laa_pct": round(laa_now / total * 100, 1) if total else 0.0,
            "cache_loading": cache_loading,
        },
        "last_scan_at": last_scan_at,
    }
