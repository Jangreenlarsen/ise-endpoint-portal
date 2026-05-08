"""ISE Profiler profile name lookup.

Resolves profileId (UUID) → human-readable profile name via the ERS
profilerprofile resource. Results are cached in-memory for the lifetime of
the process to avoid repeated ISE calls (profile definitions rarely change).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_PROFILER_PROFILES = "/ers/config/profilerprofile"

# Process-level cache: profileId → name.
_cache: dict[str, str] = {}
_cache_lock = asyncio.Lock()
_all_loaded = False


async def resolve_name(client: IseClient, profile_id: str) -> str:
    """Return the profile name for a given profileId UUID.

    Fetches the full profile list on first call and caches it. Subsequent
    calls are served from the in-memory cache (sub-millisecond). Returns an
    empty string if the profile is not found or ISE returns an error.
    """
    if not profile_id:
        return ""
    global _all_loaded

    async with _cache_lock:
        if profile_id in _cache:
            return _cache[profile_id]
        if not _all_loaded:
            await _load_all(client)
        return _cache.get(profile_id, "")


async def _load_all(client: IseClient) -> None:
    """Fetch all profiler profiles from ISE and populate the cache."""
    global _all_loaded
    try:
        page = 1
        while True:
            data = await client.get(
                ERS_PROFILER_PROFILES,
                params=[("page", page), ("size", 100)],
            )
            sr = (data or {}).get("SearchResult", {})
            resources: list[dict[str, Any]] = sr.get("resources", [])
            total: int = sr.get("total", len(resources))
            for r in resources:
                rid = r.get("id", "")
                rname = r.get("name", "")
                if rid:
                    _cache[rid] = rname
            if len(_cache) >= total or not resources:
                break
            page += 1
        _all_loaded = True
        logger.info("profiler cache loaded: %d profiles", len(_cache))
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not load profiler profiles from ISE: %s", exc)


def invalidate() -> None:
    """Clear the profiler name cache (e.g. after ISE settings change)."""
    global _all_loaded
    _cache.clear()
    _all_loaded = False
