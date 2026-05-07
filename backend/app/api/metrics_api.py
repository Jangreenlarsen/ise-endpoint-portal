"""Prometheus metrics scrape endpoint.

GET /metrics  — text/plain; version=0.0.4 (standard Prometheus format)

Not protected by authentication — this endpoint is typically scraped from
an internal Prometheus server and should be firewalled from public access.
"""
from __future__ import annotations

from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

router = APIRouter(tags=["metrics"])


@router.get("/metrics", include_in_schema=False)
async def prometheus_metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
