"""Short-lived in-memory cache for ISE endpoint + group reads.

Targets the N+1 ISE-call problem in Browse/Edit: every filter toggle,
refresh, or tab-switch previously re-fetched 1 list + N per-endpoint
GETs. With the cache in place, repeated reads within the TTL window
return instantly from memory, and stale entries can still be served
while a background refresh repopulates them.

Policy per read:
  - fresh (age <= ttl)      → return cache value, count a hit
  - from_disk               → serve value (marked stale), treat as miss
                              so caller gets a bg-refresh or force-fresh
  - stale + SWR enabled     → return cache value, spawn bg-refresh,
                              count a stale-serve
  - stale + SWR disabled    → synchronous fetch + cache put
  - too stale (10x ttl)     → synchronous fetch + cache put
  - cache disabled          → passthrough to fetch_fn, no caching

Disk persistence (offline cache):
  save_to_disk() serialises all detail entries to a JSON file so a
  portal restart can serve data immediately while the background
  pre-warm scan refreshes from ISE. Entries loaded from disk are
  flagged from_disk=True so callers can mark them as stale in the UI.

Write-invalidation is the responsibility of callers (endpoint_service):
after a successful create/update/delete they call invalidate_detail /
invalidate_groups / invalidate_all so the next read sees the new state
without waiting for the TTL to expire.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Generic, TypeVar

from app.core import config

logger = logging.getLogger(__name__)

T = TypeVar("T")

STALE_MAX_FACTOR = 10.0
DISK_CACHE_VERSION = 2


@dataclass
class CachedEntry(Generic[T]):
    value: T
    fetched_at: float
    from_disk: bool = False


class EndpointCache:
    def __init__(self) -> None:
        self._details: dict[str, CachedEntry[Any]] = {}
        self._groups: CachedEntry[Any] | None = None
        # Unified inflight dict: tasks that return the fetched value.
        # Coalesces concurrent requests for the same endpoint — if a fetch
        # is already in-flight (from pre-warm, SWR background, or another
        # user), new requests await the existing task instead of hitting ISE.
        self._inflight_detail: dict[str, asyncio.Task[Any]] = {}
        self._inflight_groups: asyncio.Task[Any] | None = None
        self._stats: dict[str, int] = {
            "hits": 0,
            "misses": 0,
            "stale_serves": 0,
            "bg_refreshes": 0,
            "invalidations": 0,
            "disk_loads": 0,
            "evictions": 0,
        }
        # roles_index maps lowercase role name → set of endpoint_ids that carry
        # that role in their HypervisionRoles custom attribute.  Maintained by
        # put_detail / invalidate_detail / invalidate_all / load_from_disk so
        # non-admin Browse can skip fetching all 10K endpoints just to post-filter.
        self._roles_index: dict[str, set[str]] = {}
        # O(1) counter so disk_stale_count() avoids iterating _details.
        self._disk_stale_count: int = 0
        self._last_sync_at: float | None = None
        self._last_sync_error: str | None = None

    @staticmethod
    def enabled() -> bool:
        return bool(getattr(config.settings, "cache_enabled", True))

    @staticmethod
    def _ttl() -> float:
        return float(getattr(config.settings, "cache_ttl_seconds", 60.0))

    @staticmethod
    def _swr() -> bool:
        return bool(getattr(config.settings, "cache_stale_while_revalidate", True))

    @staticmethod
    def _now() -> float:
        return time.time()

    def _age(self, entry: CachedEntry[Any]) -> float:
        return self._now() - entry.fetched_at

    def _fresh(self, entry: CachedEntry[Any]) -> bool:
        return self._age(entry) <= self._ttl()

    def _stale_servable(self, entry: CachedEntry[Any]) -> bool:
        return self._age(entry) <= self._ttl() * STALE_MAX_FACTOR

    def is_from_disk(self, endpoint_id: str) -> bool:
        entry = self._details.get(endpoint_id)
        return entry is not None and entry.from_disk

    def disk_stale_count(self) -> int:
        return self._disk_stale_count

    # ------------------------------------------------------------------ #
    # Roles index helpers                                                  #
    # ------------------------------------------------------------------ #

    def _add_to_roles_index(self, endpoint_id: str, value: Any) -> None:
        roles = getattr(value, "roles", None)
        if not roles:
            return
        for role in roles:
            if role:
                key = role.lower()
                if key not in self._roles_index:
                    self._roles_index[key] = set()
                self._roles_index[key].add(endpoint_id)

    def _remove_from_roles_index(self, endpoint_id: str, value: Any) -> None:
        roles = getattr(value, "roles", None)
        if not roles:
            return
        for role in roles:
            if role:
                key = role.lower()
                bucket = self._roles_index.get(key)
                if bucket is not None:
                    bucket.discard(endpoint_id)
                    if not bucket:
                        del self._roles_index[key]

    def get_ids_for_roles(self, roles: list[str]) -> set[str]:
        """Return all cached endpoint IDs visible to a user with the given
        effective roles.  Union of all role buckets — case-insensitive."""
        result: set[str] = set()
        for role in roles:
            if role:
                bucket = self._roles_index.get(role.lower())
                if bucket:
                    result |= bucket
        return result

    def detail_count(self) -> int:
        return len(self._details)

    async def _fetch_and_store(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Fetch from ISE, store in cache, return value. Cleans up inflight entry."""
        try:
            value = await fetch_fn()
            self._details[endpoint_id] = CachedEntry(value, self._now(), from_disk=False)
            self._stats["bg_refreshes"] += 1
            return value
        except Exception as exc:  # noqa: BLE001
            logger.warning("cache fetch failed id=%s err=%s", endpoint_id, exc)
            raise
        finally:
            self._inflight_detail.pop(endpoint_id, None)

    def _get_or_create_inflight(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> asyncio.Task[Any] | None:
        """Return an existing in-flight task for endpoint_id, or create a new one.

        Returns None if the event loop is not running (startup edge case).
        The done-callback on new tasks calls task.exception() which marks the
        exception as "retrieved" so asyncio does not log "Task exception was
        never retrieved" for fire-and-forget SWR callers. Direct awaiters still
        receive the exception normally when they await the task.
        """
        existing = self._inflight_detail.get(endpoint_id)
        if existing and not existing.done():
            return existing
        try:
            task = asyncio.create_task(self._fetch_and_store(endpoint_id, fetch_fn))
            self._inflight_detail[endpoint_id] = task
            task.add_done_callback(
                lambda t: t.exception() if not t.cancelled() else None
            )
            return task
        except RuntimeError:
            return None

    async def get_detail(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
        force_fresh: bool = False,
    ) -> Any:
        if not self.enabled():
            return await fetch_fn()
        entry = self._details.get(endpoint_id)
        # Disk-loaded entries are always treated as misses so live ISE data
        # can replace them. They are still *served* from memory for list views.
        if entry and self._fresh(entry) and not entry.from_disk and not force_fresh:
            self._stats["hits"] += 1
            return entry.value
        if entry and self._swr() and self._stale_servable(entry) and not force_fresh:
            self._stats["stale_serves"] += 1
            # Fire-and-forget background refresh — coalesces with any existing fetch.
            self._get_or_create_inflight(endpoint_id, fetch_fn)
            return entry.value
        # Miss or force_fresh: coalesce with any existing in-flight fetch so
        # concurrent requests (edit-modal + pre-warm hot-queue, two users)
        # share one ISE call instead of each hammering ISE independently.
        self._stats["misses"] += 1
        task = self._get_or_create_inflight(endpoint_id, fetch_fn)
        if task is not None:
            try:
                return await task
            except Exception:
                # ISE transport error / timeout: fall back to any cached entry
                # (fresh, stale, or disk) so the user sees data instead of 502.
                # The entry is marked cache_stale so the UI shows the ⏱ badge.
                fallback = self._details.get(endpoint_id)
                if fallback is not None:
                    val = fallback.value
                    if hasattr(val, "model_copy"):
                        val = val.model_copy(update={"cache_stale": True})
                    return val
                raise  # no cached data at all — propagate so caller can 502
        # Fallback: no event loop (shouldn't happen at runtime).
        value = await fetch_fn()
        self._details[endpoint_id] = CachedEntry(value, self._now(), from_disk=False)
        return value

    def _spawn_detail_refresh(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> None:
        self._get_or_create_inflight(endpoint_id, fetch_fn)

    @staticmethod
    def _max_entries() -> int:
        return int(getattr(config.settings, "cache_max_entries", 5000))

    def _evict_oldest(self) -> None:
        """Evict the oldest (first-inserted) entry. FIFO — O(1) with ordered dict."""
        oldest_id, oldest_entry = next(iter(self._details.items()))
        self._remove_from_roles_index(oldest_id, oldest_entry.value)
        if oldest_entry.from_disk:
            self._disk_stale_count -= 1
        del self._details[oldest_id]
        self._stats["evictions"] += 1

    def put_detail(self, endpoint_id: str, value: Any, from_disk: bool = False) -> None:
        if not self.enabled():
            return
        old = self._details.get(endpoint_id)
        if old is not None:
            self._remove_from_roles_index(endpoint_id, old.value)
            if old.from_disk:
                self._disk_stale_count -= 1
        else:
            # New entry: enforce size limit before inserting.
            max_entries = self._max_entries()
            if max_entries > 0:
                while len(self._details) >= max_entries:
                    self._evict_oldest()
        if from_disk:
            self._disk_stale_count += 1
        self._details[endpoint_id] = CachedEntry(value, self._now(), from_disk=from_disk)
        self._add_to_roles_index(endpoint_id, value)

    def invalidate_detail(self, endpoint_id: str) -> None:
        entry = self._details.pop(endpoint_id, None)
        if entry is not None:
            self._remove_from_roles_index(endpoint_id, entry.value)
            if entry.from_disk:
                self._disk_stale_count -= 1
            self._stats["invalidations"] += 1

    async def _fetch_and_store_groups(
        self,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Fetch groups from ISE, store in cache, return value."""
        try:
            value = await fetch_fn()
            self._groups = CachedEntry(value, self._now())
            self._stats["bg_refreshes"] += 1
            return value
        except Exception as exc:  # noqa: BLE001
            logger.warning("cache bg-refresh groups failed: %s", exc)
            raise
        finally:
            self._inflight_groups = None

    def _get_or_create_groups_inflight(
        self,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> asyncio.Task[Any] | None:
        if self._inflight_groups and not self._inflight_groups.done():
            return self._inflight_groups
        try:
            task = asyncio.create_task(self._fetch_and_store_groups(fetch_fn))
            self._inflight_groups = task
            task.add_done_callback(
                lambda t: t.exception() if not t.cancelled() else None
            )
            return task
        except RuntimeError:
            return None

    async def get_groups(
        self,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> Any:
        if not self.enabled():
            return await fetch_fn()
        if self._groups and self._fresh(self._groups):
            self._stats["hits"] += 1
            return self._groups.value
        if self._groups and self._swr() and self._stale_servable(self._groups):
            self._stats["stale_serves"] += 1
            self._get_or_create_groups_inflight(fetch_fn)  # fire-and-forget
            return self._groups.value
        # Miss — coalesce concurrent fetches so only one hits ISE.
        self._stats["misses"] += 1
        task = self._get_or_create_groups_inflight(fetch_fn)
        if task is not None:
            return await task
        value = await fetch_fn()
        self._groups = CachedEntry(value, self._now())
        return value

    def _spawn_groups_refresh(
        self, fetch_fn: Callable[[], Awaitable[Any]]
    ) -> None:
        self._get_or_create_groups_inflight(fetch_fn)

    def invalidate_groups(self) -> None:
        if self._groups is not None:
            self._groups = None
            self._stats["invalidations"] += 1

    def invalidate_all(self) -> None:
        if self._details or self._groups:
            self._details.clear()
            self._groups = None
            self._roles_index.clear()
            self._disk_stale_count = 0
            self._stats["invalidations"] += 1

    def detail_ids(self) -> list[str]:
        return list(self._details.keys())

    def detail_age(self, endpoint_id: str) -> float | None:
        entry = self._details.get(endpoint_id)
        return None if entry is None else self._age(entry)

    # ------------------------------------------------------------------ #
    # Disk persistence                                                     #
    # ------------------------------------------------------------------ #

    def save_to_disk(self, path: Path) -> int:
        """Serialise all detail entries to a JSON file. Returns entry count."""
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            entries: dict[str, Any] = {}
            for ep_id, entry in self._details.items():
                if entry.from_disk:
                    continue  # don't re-persist disk-loaded stale data
                try:
                    # value may be a Pydantic model or plain dict
                    value_dict = (
                        entry.value.model_dump()
                        if hasattr(entry.value, "model_dump")
                        else dict(entry.value)
                    )
                    entries[ep_id] = {
                        "fetched_at": entry.fetched_at,
                        "value": value_dict,
                    }
                except Exception:  # noqa: BLE001
                    pass
            payload = {
                "version": DISK_CACHE_VERSION,
                "saved_at": self._now(),
                "count": len(entries),
                "entries": entries,
            }
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            logger.info("disk cache: saved %d entries to %s", len(entries), path)
            return len(entries)
        except Exception as exc:  # noqa: BLE001
            logger.warning("disk cache: save failed: %s", exc)
            return 0

    async def save_to_disk_async(self, path: Path) -> int:
        """Non-blocking variant: offload save_to_disk to a thread-pool executor
        so the event loop is not held while json.dumps + file write run (can
        take 300–700 ms at 10K endpoints)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.save_to_disk, path)

    def load_from_disk(self, path: Path) -> int:
        """Load detail entries from a JSON file, flagged as from_disk=True.
        Existing in-memory (live) entries are NOT overwritten.
        Returns count of entries loaded."""
        if not path.exists():
            return 0
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("version") != DISK_CACHE_VERSION:
                logger.info("disk cache: version mismatch, skipping %s", path)
                return 0
            entries = payload.get("entries", {})
            loaded = 0
            for ep_id, raw in entries.items():
                if ep_id in self._details:
                    continue  # live entry takes precedence
                try:
                    from app.schemas.endpoint import EndpointDetail
                    value = EndpointDetail.model_validate(raw["value"])
                    value.cache_stale = True
                    fetched_at = float(raw.get("fetched_at", 0.0))
                    self._details[ep_id] = CachedEntry(
                        value, fetched_at, from_disk=True
                    )
                    self._add_to_roles_index(ep_id, value)
                    self._disk_stale_count += 1
                    loaded += 1
                except Exception:  # noqa: BLE001
                    pass
            self._stats["disk_loads"] += loaded
            saved_at = payload.get("saved_at", 0)
            age_min = (self._now() - saved_at) / 60
            logger.info(
                "disk cache: loaded %d entries from %s (saved %.0f min ago)",
                loaded, path, age_min,
            )
            return loaded
        except Exception as exc:  # noqa: BLE001
            logger.warning("disk cache: load failed: %s", exc)
            return 0

    def mark_sync_ok(self) -> None:
        self._last_sync_at = self._now()
        self._last_sync_error = None

    def mark_sync_error(self, err: str) -> None:
        self._last_sync_error = err

    def stats(self) -> dict[str, Any]:
        max_entries = self._max_entries()
        return {
            "enabled": self.enabled(),
            "ttl_seconds": self._ttl(),
            "stale_while_revalidate": self._swr(),
            "detail_entries": len(self._details),
            "max_entries": max_entries if max_entries > 0 else "unlimited",
            "disk_stale_entries": self.disk_stale_count(),
            "groups_cached": self._groups is not None,
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "stale_serves": self._stats["stale_serves"],
            "bg_refreshes": self._stats["bg_refreshes"],
            "invalidations": self._stats["invalidations"],
            "disk_loads": self._stats["disk_loads"],
            "evictions": self._stats["evictions"],
            "last_sync_at": self._last_sync_at,
            "last_sync_error": self._last_sync_error,
            "roles_index_roles": len(self._roles_index),
            "inflight_detail_refreshes": sum(
                1 for t in self._inflight_detail.values() if not t.done()
            ),
            "inflight_groups_refresh": bool(
                self._inflight_groups and not self._inflight_groups.done()
            ),
        }


_cache = EndpointCache()


def get_cache() -> EndpointCache:
    return _cache
