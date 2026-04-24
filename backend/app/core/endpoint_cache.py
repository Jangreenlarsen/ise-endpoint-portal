"""Short-lived in-memory cache for ISE endpoint + group reads.

Targets the N+1 ISE-call problem in Browse/Edit: every filter toggle,
refresh, or tab-switch previously re-fetched 1 list + N per-endpoint
GETs. With the cache in place, repeated reads within the TTL window
return instantly from memory, and stale entries can still be served
while a background refresh repopulates them.

Policy per read:
  - fresh (age <= ttl)      → return cache value, count a hit
  - stale + SWR enabled     → return cache value, spawn bg-refresh,
                              count a stale-serve
  - stale + SWR disabled    → synchronous fetch + cache put
  - too stale (10x ttl)     → synchronous fetch + cache put
  - cache disabled          → passthrough to fetch_fn, no caching

Write-invalidation is the responsibility of callers (endpoint_service):
after a successful create/update/delete they call invalidate_detail /
invalidate_groups / invalidate_all so the next read sees the new state
without waiting for the TTL to expire.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Generic, TypeVar

from app.core import config

logger = logging.getLogger(__name__)

T = TypeVar("T")

STALE_MAX_FACTOR = 10.0


@dataclass
class CachedEntry(Generic[T]):
    value: T
    fetched_at: float


class EndpointCache:
    def __init__(self) -> None:
        self._details: dict[str, CachedEntry[Any]] = {}
        self._groups: CachedEntry[Any] | None = None
        self._inflight_detail: dict[str, asyncio.Task[Any]] = {}
        self._inflight_groups: asyncio.Task[Any] | None = None
        self._stats: dict[str, int] = {
            "hits": 0,
            "misses": 0,
            "stale_serves": 0,
            "bg_refreshes": 0,
            "invalidations": 0,
        }
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

    async def get_detail(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> Any:
        if not self.enabled():
            return await fetch_fn()
        entry = self._details.get(endpoint_id)
        if entry and self._fresh(entry):
            self._stats["hits"] += 1
            return entry.value
        if entry and self._swr() and self._stale_servable(entry):
            self._stats["stale_serves"] += 1
            self._spawn_detail_refresh(endpoint_id, fetch_fn)
            return entry.value
        self._stats["misses"] += 1
        value = await fetch_fn()
        self._details[endpoint_id] = CachedEntry(value, self._now())
        return value

    def _spawn_detail_refresh(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> None:
        existing = self._inflight_detail.get(endpoint_id)
        if existing and not existing.done():
            return

        async def _refresh() -> None:
            try:
                value = await fetch_fn()
                self._details[endpoint_id] = CachedEntry(value, self._now())
                self._stats["bg_refreshes"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "cache bg-refresh failed id=%s err=%s", endpoint_id, exc
                )
            finally:
                self._inflight_detail.pop(endpoint_id, None)

        try:
            task = asyncio.create_task(_refresh())
            self._inflight_detail[endpoint_id] = task
        except RuntimeError:
            pass

    def put_detail(self, endpoint_id: str, value: Any) -> None:
        if not self.enabled():
            return
        self._details[endpoint_id] = CachedEntry(value, self._now())

    def invalidate_detail(self, endpoint_id: str) -> None:
        if self._details.pop(endpoint_id, None) is not None:
            self._stats["invalidations"] += 1

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
            self._spawn_groups_refresh(fetch_fn)
            return self._groups.value
        self._stats["misses"] += 1
        value = await fetch_fn()
        self._groups = CachedEntry(value, self._now())
        return value

    def _spawn_groups_refresh(
        self, fetch_fn: Callable[[], Awaitable[Any]]
    ) -> None:
        if self._inflight_groups and not self._inflight_groups.done():
            return

        async def _refresh() -> None:
            try:
                value = await fetch_fn()
                self._groups = CachedEntry(value, self._now())
                self._stats["bg_refreshes"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("cache bg-refresh groups failed: %s", exc)
            finally:
                self._inflight_groups = None

        try:
            self._inflight_groups = asyncio.create_task(_refresh())
        except RuntimeError:
            pass

    def invalidate_groups(self) -> None:
        if self._groups is not None:
            self._groups = None
            self._stats["invalidations"] += 1

    def invalidate_all(self) -> None:
        if self._details or self._groups:
            self._details.clear()
            self._groups = None
            self._stats["invalidations"] += 1

    def mark_sync_ok(self) -> None:
        self._last_sync_at = self._now()
        self._last_sync_error = None

    def mark_sync_error(self, err: str) -> None:
        self._last_sync_error = err

    def stats(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled(),
            "ttl_seconds": self._ttl(),
            "stale_while_revalidate": self._swr(),
            "detail_entries": len(self._details),
            "groups_cached": self._groups is not None,
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "stale_serves": self._stats["stale_serves"],
            "bg_refreshes": self._stats["bg_refreshes"],
            "invalidations": self._stats["invalidations"],
            "last_sync_at": self._last_sync_at,
            "last_sync_error": self._last_sync_error,
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
