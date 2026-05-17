# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""ISE Profiler profile name lookup.

Resolves profileId (UUID) → human-readable profile name via the ERS
profilerprofile resource. Results are cached in-memory.

Design: callers NEVER block waiting for the cache to load.
- Background bulk load: ``ensure_loaded(client)`` kicks off a full cache
  population in the background. Until it completes, individual lookups
  fall back to the lazy per-UUID path.
- Lazy per-UUID fetch: ``resolve_name_lazy(client, profile_id)`` fetches a
  single profile by UUID directly (small request, low timeout risk). Used
  in endpoint detail fetches so profile names resolve even when the bulk
  list endpoint is unavailable.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_PROFILER_PROFILES = "/ers/config/profilerprofile"

_cache: dict[str, str] = {}
_all_loaded: bool = False
_loading: bool = False          # True while background task is running
_lazy_pending: set[str] = set() # UUIDs currently being lazily fetched


def resolve_name_sync(profile_id: str) -> str:
    """Synchronous cache-only lookup — never triggers an ISE call.

    Returns the profile name if already cached, otherwise "".
    Call ``ensure_loaded(client)`` once to kick off the background load.
    """
    if not profile_id:
        return ""
    return _cache.get(profile_id, "")


async def resolve_name_lazy(client: IseClient, profile_id: str) -> str:
    """Return the profile name for a given profileId UUID.

    Checks cache first. On miss, fetches the single profile by UUID from
    ISE directly (much smaller request than the full list). Caches the
    result for subsequent calls.

    Also starts the background bulk load (best-effort) so future Browse
    pages benefit from a warm cache.
    """
    if not profile_id:
        return ""
    cached = _cache.get(profile_id)
    if cached is not None:
        return cached

    # Kick off the bulk load in the background (no-op if already running/done).
    ensure_loaded(client)

    # Lazy fetch this specific UUID — avoid duplicate concurrent requests.
    if profile_id in _lazy_pending:
        # Another coroutine is already fetching this UUID; return what we have.
        return _cache.get(profile_id, "")

    _lazy_pending.add(profile_id)
    try:
        data = await client.get(f"{ERS_PROFILER_PROFILES}/{profile_id}")
        profile = (data or {}).get("ProfilerProfile", data or {})
        name = profile.get("name", "")
        if name:
            _cache[profile_id] = name
            logger.debug("profiler lazy: %s → %s", profile_id, name)
        else:
            _cache[profile_id] = ""  # cache negative result to avoid repeated calls
    except Exception as exc:  # noqa: BLE001
        logger.debug("profiler lazy fetch failed for %s: %s", profile_id, exc)
        _cache[profile_id] = ""  # cache failure to avoid hammering ISE
    finally:
        _lazy_pending.discard(profile_id)

    return _cache.get(profile_id, "")


async def resolve_name(client: IseClient, profile_id: str) -> str:
    """Return the profile name for a given profileId UUID.

    Non-blocking: returns "" immediately if the cache is not yet populated
    and schedules a background load. Subsequent calls after the load
    completes will return the real name.
    """
    if not profile_id:
        return ""
    if profile_id in _cache:
        return _cache[profile_id]
    # Kick off a background load if not already running or done.
    ensure_loaded(client)
    return ""


def ensure_loaded(client: IseClient) -> None:
    """Start the background profiler-cache load if not already running/done."""
    global _loading, _all_loaded
    if _all_loaded or _loading:
        return
    _loading = True
    asyncio.ensure_future(_load_all(client))


async def _load_all(client: IseClient) -> None:
    """Fetch all profiler profiles from ISE and populate the cache.

    Runs as a background task — exceptions are logged and swallowed so a
    broken/missing profiler endpoint never affects endpoint detail loading.
    """
    global _all_loaded, _loading
    try:
        page = 1
        while True:
            data = await client.get(
                ERS_PROFILER_PROFILES,
                params=[("page", page), ("size", 100)],
            )
            sr = (data or {}).get("SearchResult", {})
            resources: list[dict[str, Any]] = sr.get("resources", [])
            total: int = int(sr.get("total", len(resources)))
            for r in resources:
                rid = r.get("id", "")
                rname = r.get("name", "")
                if rid:
                    _cache[rid] = rname
            if not resources or len(_cache) >= total:
                break
            page += 1
        _all_loaded = True
        logger.info("profiler cache loaded: %d profiles", len(_cache))
    except Exception as exc:  # noqa: BLE001
        logger.warning("profiler cache load failed (names will be empty): %s", exc)
    finally:
        _loading = False


def store(profile_id: str, name: str) -> None:
    """Populate cache with a known UUID→name pair (e.g. from Open API response)."""
    if profile_id and name:
        _cache[profile_id] = name


def invalidate() -> None:
    """Clear the profiler name cache (call after ISE settings change)."""
    global _all_loaded, _loading
    _cache.clear()
    _all_loaded = False
    _loading = False
    _lazy_pending.clear()
