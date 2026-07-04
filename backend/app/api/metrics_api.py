# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Prometheus metrics scrape endpoint.

GET /metrics  — text/plain; version=0.0.4 (standard Prometheus format)

Protected by require_any — Prometheus scraper skal bruge en gyldig session-cookie
eller sende Authorization: Bearer <token> med en portalbruger-konto.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.api.deps import require_any
from app.core import metrics_store

router = APIRouter(tags=["metrics"])


@router.get("/metrics", include_in_schema=False, dependencies=[Depends(require_any)])
async def prometheus_metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@router.get("/api/metrics/history", dependencies=[Depends(require_any)])
async def metrics_history(
    names: list[str] = Query(
        default=[
            "cache_entries", "cache_stale_pct", "ise_requests_total", "circuit_state",
            "adaptive_speed_factor", "effective_ttl_s", "portal_idle_s", "drip_sleep_s",
        ],
    ),
    limit: int = Query(120, ge=1, le=1440),
) -> dict:
    """Returnér tidsseriedata for de angivne metrikker (maks. 10 serier, 1440 punkter).

    Hvert punkt er ``{ts: ISO8601, value: float}``, ældst først.
    Tilladt ``names``:
    - cache_entries, cache_stale_pct, cache_avg_age_s, cache_memory_mb,
      circuit_state, ise_requests_total, ise_retries_total, drip_sleep_s,
      adaptive_speed_factor, effective_ttl_s, portal_idle_s
    """
    result: dict = {}
    for name in names[:10]:
        result[name] = await metrics_store.get_history(name, limit)
    return result
