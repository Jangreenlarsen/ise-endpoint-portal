"""ISE Profiler profile name lookup.

Resolves profileId (UUID) → human-readable profile name via the ERS
profilerprofile resource. Results are cached in-memory.

Design: callers NEVER block waiting for the cache to load.
On first call the load is kicked off as a background asyncio task.
Until it completes every lookup returns "". Subsequent Browse loads
will show the resolved names once the task finishes (typically < 5s).
This prevents the profiler load from serialising concurrent
endpoint-detail fetches and triggering the ISE circuit breaker.
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


def resolve_name_sync(profile_id: str) -> str:
    """Synchronous cache-only lookup — never triggers an ISE call.

    Returns the profile name if already cached, otherwise "".
    Call ``ensure_loaded(client)`` once to kick off the background load.
    """
    if not profile_id:
        return ""
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


def invalidate() -> None:
    """Clear the profiler name cache (call after ISE settings change)."""
    global _all_loaded, _loading
    _cache.clear()
    _all_loaded = False
    _loading = False
