# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Sliding-window per-IP rate limiter middleware.

Blokerer en IP-adresse der sender mere end `rate_limit_per_minute` requests
til /api/-stier inden for ét rullende 60-sekunders vindue.

Asyncio-sikkerhed: deque-operationer og dict-opslag er atomiske i ét
cooperative event-loop — ingen locks nødvendige.

Memory: én deque pr. aktiv IP, automatisk ryddet når vinduet er tomt.
~200 bytes pr. IP i peak. 10.000 samtidige IPs ≈ 2 MB.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core import config
from app.core.metrics import RATE_LIMIT_BLOCKED

_WINDOW = 60.0  # sekunder


class _SlidingWindow:
    """Letvægt sliding-window counter, bruges direkte af middlewaren."""

    def __init__(self) -> None:
        self._buckets: dict[str, deque[float]] = defaultdict(deque)

    def is_allowed(self, key: str, limit: int) -> bool:
        now = time.time()
        q = self._buckets[key]
        cutoff = now - _WINDOW
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

    def remaining(self, key: str, limit: int) -> int:
        q = self._buckets.get(key)
        if not q:
            return limit
        now = time.time()
        cutoff = now - _WINDOW
        active = sum(1 for ts in q if ts >= cutoff)
        return max(0, limit - active)


_window = _SlidingWindow()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Afviser requests med 429 når IP-grænsen overskrides."""

    async def dispatch(self, request: Request, call_next: object) -> Response:
        limit = int(getattr(config.settings, "rate_limit_per_minute", 200))
        if limit <= 0 or not request.url.path.startswith("/api"):
            return await call_next(request)  # type: ignore[operator]

        direct_ip = request.client.host if request.client else "unknown"
        trusted = set(getattr(config.settings, "trusted_proxy_ips", []))
        if trusted and direct_ip in trusted:
            forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            ip = forwarded or direct_ip
        else:
            ip = direct_ip

        if not _window.is_allowed(ip, limit):
            RATE_LIMIT_BLOCKED.inc()
            remaining_s = int(_WINDOW)
            return Response(
                content='{"detail":"Too many requests — vent 60 sekunder og prøv igen."}',
                status_code=429,
                media_type="application/json",
                headers={
                    "Retry-After": str(remaining_s),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response: Response = await call_next(request)  # type: ignore[assignment]
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(
            _window.remaining(ip, limit)
        )
        return response


def get_window() -> _SlidingWindow:
    """Returnerer den globale sliding-window instans (til tests)."""
    return _window
