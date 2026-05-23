# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Trend-analyse API — endpoint tilgang/fragang og LAA (private MAC) historik.

Spørger audit_events-tabellen for create/delete-events på endpoints inden for
en valgbar periode (7d / 30d / 90d / 365d) og returnerer daglige tæller.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_any
from app.core.audit_store import DB_PATH
from app.core.endpoint_cache import get_cache
from app.schemas.user import User

router = APIRouter(prefix="/trends", tags=["trends"])

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}


def _is_laa(mac: str) -> bool:
    try:
        first = int(mac.replace(":", "").replace("-", "")[:2], 16)
        return bool(first & 0x02)
    except (ValueError, IndexError):
        return False


def _mac_from_json(blob: str | None) -> str:
    if not blob:
        return ""
    try:
        d = json.loads(blob)
        return d.get("mac") or d.get("name") or d.get("macAddress") or ""
    except Exception:
        return ""


@router.get("", dependencies=[Depends(require_any)])
async def get_trends(
    period: str = Query("30d"),
    _user: User = Depends(require_any),
) -> dict:
    """Returnerer daglige endpoint-tilgang/fragang og LAA-tæller for valgt periode."""
    days = _PERIOD_DAYS.get(period, 30)

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    start_str = start.isoformat()

    # Byg dato-labels (YYYY-MM-DD) for perioden
    labels = [
        (start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days + 1)
    ]

    # Forespørg audit-events
    added_by_day: dict[str, int] = defaultdict(int)
    removed_by_day: dict[str, int] = defaultdict(int)
    laa_added_by_day: dict[str, int] = defaultdict(int)
    laa_removed_by_day: dict[str, int] = defaultdict(int)

    try:
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT ts, action, after_json, before_json
                FROM audit_events
                WHERE resource_type = 'endpoint'
                  AND action IN ('create', 'delete')
                  AND ts >= ?
                ORDER BY ts
                """,
                (start_str,),
            )
            rows = cur.fetchall()
        finally:
            conn.close()
    except Exception:
        rows = []

    for ts, action, after_json, before_json in rows:
        day = ts[:10]
        if action == "create":
            added_by_day[day] += 1
            mac = _mac_from_json(after_json)
            if mac and _is_laa(mac):
                laa_added_by_day[day] += 1
        elif action == "delete":
            removed_by_day[day] += 1
            mac = _mac_from_json(before_json)
            if mac and _is_laa(mac):
                laa_removed_by_day[day] += 1

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
        },
    }
