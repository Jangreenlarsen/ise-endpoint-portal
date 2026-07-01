# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Generic, TypeVar

from app.core import config
from app.core.metrics import (
    CACHE_DISK_STALE,
    CACHE_ENTRIES,
    CACHE_EVICTIONS,
    CACHE_HITS,
    CACHE_MEMORY_BYTES,
    CACHE_MISSES,
    CACHE_STALE_SERVES,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

STALE_MAX_FACTOR = 30.0
DISK_CACHE_VERSION = 4  # v4: tier_emas sektion tilføjet til disk-payload

# 3-tier change-frequency constants.
# change_ema tracks EMA of "did value change?" per drip refresh (0.0–1.0).
TIER_HOT_EMA   = 0.30   # > 30 % af refreshes medførte ændring → hot
TIER_COLD_EMA  = 0.05   # <  5 % af refreshes medførte ændring → cold
TIER_HOT_FACTOR  = 0.5  # hot entries refreshes ved TTL × 0.5
TIER_COLD_FACTOR = 3.0  # cold entries refreshes ved TTL × 3.0
EMA_ALPHA = 0.20         # smoothing; ~5 refreshes halverer/fordob. signalet


def _hash_value(val: Any) -> str:
    """SHA-256 (første 16 hex) af endpoint-data ekskl. cache_stale-flag."""
    try:
        if hasattr(val, "model_dump"):
            raw = json.dumps(
                val.model_dump(exclude={"cache_stale"}),
                default=str, sort_keys=True,
            )
        else:
            raw = json.dumps(val, default=str, sort_keys=True)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
    except Exception:  # noqa: BLE001
        return ""


@dataclass
class CachedEntry(Generic[T]):
    value: T
    fetched_at: float
    from_disk: bool = False
    size_bytes: int = 0
    # 3-tier change tracking
    change_ema: float = 0.0   # EMA af ændrings-sandsynlighed (0=cold, 1=hot)
    value_hash: str = ""      # hash til change-detection på næste refresh


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
        # Tier EMA-værdier der overlever cache-invalidations (portal-saves, deletes).
        # Historisk ændringsfrekvens pr. endpoint_id bevares på tværs af invalidations
        # og konsulteres af put_detail() når en ny entry oprettes efter invalidation.
        self._tier_emas: dict[str, float] = {}
        # O(1) counter so disk_stale_count() avoids iterating _details.
        self._disk_stale_count: int = 0
        self._total_bytes: int = 0
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

    # ------------------------------------------------------------------ #
    # 3-tier change-frequency helpers                                      #
    # ------------------------------------------------------------------ #

    def _effective_ttl_for_entry(self, entry: CachedEntry[Any], base_ttl: float) -> float:
        """Tier-justeret TTL baseret på historisk ændringsfrekvens (EMA).

        Hot  (EMA > 0.30): base_ttl × 0.5  — refreshes hyppigere
        Warm (0.05–0.30):  base_ttl × 1.0  — normal rate
        Cold (EMA < 0.05): base_ttl × 3.0  — refreshes sjældnere
        """
        ema = entry.change_ema
        if ema >= TIER_HOT_EMA:
            return base_ttl * TIER_HOT_FACTOR
        if ema < TIER_COLD_EMA:
            return base_ttl * TIER_COLD_FACTOR
        return base_ttl

    def endpoint_tier(self, endpoint_id: str) -> str:
        """Returnér 'hot' / 'warm' / 'cold' for et endpoint."""
        entry = self._details.get(endpoint_id)
        if entry is None:
            return "warm"
        ema = entry.change_ema
        if ema >= TIER_HOT_EMA:
            return "hot"
        if ema < TIER_COLD_EMA:
            return "cold"
        return "warm"

    def get_priority_stale_ids(
        self,
        base_ttl: float,
        exclude_inflight: set[str],
    ) -> list[str]:
        """Returnér endpoint IDs sorteret efter refresh-prioritet (mest overdue først).

        Prioritet = age / effective_ttl_for_entry.  > 1.0 = due for refresh.
        Hot entries har lavere effective_ttl og optræder derfor tidligere i køen
        ved samme absolutte alder. Cold entries udskydes automatisk.
        """
        now = self._now()
        candidates: list[tuple[str, float]] = []
        for ep_id, entry in self._details.items():
            if ep_id in exclude_inflight:
                continue
            eff_ttl = self._effective_ttl_for_entry(entry, base_ttl)
            age = now - entry.fetched_at
            priority = age / eff_ttl  # > 1.0 → overdue
            if priority > 1.0:
                candidates.append((ep_id, priority))
        candidates.sort(key=lambda x: x[1], reverse=True)
        return [ep_id for ep_id, _ in candidates]

    def mark_changed(self, endpoint_id: str) -> None:
        """Boost change_ema som om endpoint netop skiftede (pxGrid / mutation hook).

        Bruges af pxGrid-handleren og write-paths til at markere et endpoint
        som 'hot' så drip-loopen prioriterer det højere fremover.
        """
        entry = self._details.get(endpoint_id)
        old_ema = entry.change_ema if entry is not None else self._tier_emas.get(endpoint_id, 0.0)
        new_ema = EMA_ALPHA * 1.0 + (1 - EMA_ALPHA) * old_ema
        self._tier_emas[endpoint_id] = new_ema
        if entry is not None:
            entry.change_ema = new_ema

    def forget_tier_ema(self, endpoint_id: str) -> None:
        """Fjern EMA-historik for endpoint slettet permanent fra ISE.
        Forhindrer ubegrænset vækst af _tier_emas over lange driftsperioder.
        """
        self._tier_emas.pop(endpoint_id, None)

    def stale_count_for_ttl(self, ttl: float) -> int:
        """Antal detail-entries ældre end ttl sekunder.
        Public API der erstatter direkte _details-adgang fra cache_prewarm.
        """
        now = self._now()
        return sum(1 for e in self._details.values() if (now - e.fetched_at) > ttl)

    def inflight_ids(self) -> set[str]:
        """Set af endpoint IDs med aktiv ISE-fetch.
        Public API der erstatter direkte _inflight_detail-adgang fra cache_prewarm.
        """
        return {eid for eid, t in self._inflight_detail.items() if not t.done()}

    def effective_skip_threshold(self, endpoint_id: str, base_threshold: float) -> float:
        """Tier-justeret skip_threshold til brug i _full_scan().
        Hot endpoints springes ikke over så nemt (lavere threshold → refreshes oftere).
        """
        entry = self._details.get(endpoint_id)
        if entry is None:
            return base_threshold
        return self._effective_ttl_for_entry(entry, base_threshold)

    def set_fetch_backoff(self, endpoint_id: str) -> None:
        """Back-off ved drip-fetch-fejl: ryk fetched_at frem 60s bag TTL-grænsen
        så loopen vælger et andet endpoint næste iteration i stedet for at låse på dette.
        """
        entry = self._details.get(endpoint_id)
        if entry is not None:
            entry.fetched_at = time.time() - self._ttl() + 60

    def ages_seconds(self) -> list[float]:
        """Liste af alle entry-aldre i sekunder. Bruges til metrics-gauges."""
        now = self._now()
        return [now - e.fetched_at for e in self._details.values()]

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

    def get_all_details(self) -> list[Any]:
        """Return a snapshot of all cached EndpointDetail objects (unmasked)."""
        return [e.value for e in self._details.values()]

    def snapshot_all_details(self) -> list[tuple[str, Any, bool]]:
        """Synchronous snapshot for list views. Returns (ep_id, value, is_stale) tuples.

        Bruger tier-justeret effective_ttl: cold entries vises som friske i op til
        3× TTL, hot entries vises som stale allerede ved 0.5× TTL.
        Does NOT trigger background ISE refreshes — list views must not spawn N concurrent
        fetch-tasks. The pre-warm drip-loop handles refresh.
        """
        now = self._now()
        ttl = self._ttl()
        return [
            (ep_id, entry.value,
             entry.from_disk or (now - entry.fetched_at) > self._effective_ttl_for_entry(entry, ttl))
            for ep_id, entry in list(self._details.items())
            if entry.value is not None
        ]

    def snapshot_details_for_roles(self, effective_roles: list[str]) -> list[tuple[str, Any, bool]]:
        """Like snapshot_all_details but filtered to IDs visible for the given roles."""
        visible_ids = self.get_ids_for_roles(effective_roles)
        now = self._now()
        ttl = self._ttl()
        result: list[tuple[str, Any, bool]] = []
        for ep_id in visible_ids:
            entry = self._details.get(ep_id)
            if entry is None or entry.value is None:
                continue
            result.append((
                ep_id, entry.value,
                entry.from_disk or (now - entry.fetched_at) > self._effective_ttl_for_entry(entry, ttl),
            ))
        return result

    def get_oldest_id(self) -> str | None:
        """Returnér ID på den cachede entry med den ældste fetched_at-timestamp.

        Bruges af drip-refresh-loopen til at prioritere de mest forældede
        endpoints og sikre at alle entries roteres jævnt frem for en stor burst.
        Returnerer None hvis cachen er tom.
        """
        if not self._details:
            return None
        return min(self._details, key=lambda k: self._details[k].fetched_at)

    async def _fetch_and_store(
        self,
        endpoint_id: str,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Fetch from ISE, store in cache, return value. Cleans up inflight entry."""
        try:
            value = await fetch_fn()
            self.put_detail(endpoint_id, value, from_disk=False)
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
        # Tier-justeret freshness: hot entries (eff_ttl = TTL×0.5) trigges til
        # SWR-refresh dobbelt så hurtigt som warm entries ved direkte get_detail-kald.
        # Gør cache-hit/miss konsistent med UI-staleness-badge i snapshot_all_details().
        if entry and not entry.from_disk and not force_fresh and \
                self._age(entry) <= self._effective_ttl_for_entry(entry, self._ttl()):
            self._stats["hits"] += 1
            CACHE_HITS.inc()
            return entry.value
        if entry and entry.from_disk and not force_fresh:
            # Disk-loaded entries are served immediately (stale) regardless of age,
            # and a background refresh is queued. Without this, very old disk entries
            # (> ttl*30, e.g. saved yesterday) would fall through to a blocking ISE
            # fetch in the list view — causing Browse to take 15-30s to load after
            # a portal restart, because _list_all_from_cache awaits all N fetches.
            # The pre-warm worker refreshes all disk entries in the background anyway.
            self._stats["stale_serves"] += 1
            CACHE_STALE_SERVES.inc()
            self._get_or_create_inflight(endpoint_id, fetch_fn)
            val = entry.value
            if hasattr(val, "model_copy"):
                val = val.model_copy(update={"cache_stale": True})
            return val
        if entry and self._swr() and self._stale_servable(entry) and not force_fresh:
            self._stats["stale_serves"] += 1
            CACHE_STALE_SERVES.inc()
            # Fire-and-forget background refresh — coalesces with any existing fetch.
            self._get_or_create_inflight(endpoint_id, fetch_fn)
            return entry.value
        # Miss or force_fresh: coalesce with any existing in-flight fetch so
        # concurrent requests (edit-modal + pre-warm hot-queue, two users)
        # share one ISE call instead of each hammering ISE independently.
        self._stats["misses"] += 1
        CACHE_MISSES.inc()
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
        self.put_detail(endpoint_id, value, from_disk=False)
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

    @staticmethod
    def _max_memory_bytes() -> int:
        mb = int(getattr(config.settings, "cache_max_memory_mb", 300))
        return mb * 1024 * 1024 if mb > 0 else 0

    @staticmethod
    def _estimate_size(value: Any) -> int:
        try:
            if hasattr(value, "model_dump_json"):
                return len(value.model_dump_json().encode())
            return len(json.dumps(value if isinstance(value, dict) else vars(value)).encode())
        except Exception:  # noqa: BLE001
            return 8192  # fallback ~8 KB

    def _evict_oldest(self) -> None:
        """Evict entry med ældst fetched_at (mindst nyligt refreshed). O(n).
        Korrekt LRU-adfærd: en hot entry der refreshes hyppigt evictes ikke
        frem for en kold entry der sidst blev hentet for længe siden.
        """
        oldest_id = min(self._details, key=lambda k: self._details[k].fetched_at)
        oldest_entry = self._details.pop(oldest_id)
        self._remove_from_roles_index(oldest_id, oldest_entry.value)
        if oldest_entry.from_disk:
            self._disk_stale_count -= 1
        self._total_bytes -= oldest_entry.size_bytes
        self._stats["evictions"] += 1
        CACHE_EVICTIONS.inc()

    def put_detail(self, endpoint_id: str, value: Any, from_disk: bool = False) -> None:
        if not self.enabled():
            return
        size_bytes = self._estimate_size(value)
        old = self._details.get(endpoint_id)

        # 3-tier: beregn nyt change_ema baseret på om værdien rent faktisk ændrede sig.
        new_hash = _hash_value(value) if not from_disk else ""
        if old is not None and not from_disk and old.value_hash and new_hash:
            changed = old.value_hash != new_hash
            new_ema = EMA_ALPHA * (1.0 if changed else 0.0) + (1 - EMA_ALPHA) * old.change_ema
        else:
            # Ny entry eller disk-load: arv EMA fra entry, _tier_emas (overlever invalidation), eller 0.
            if old is not None:
                new_ema = old.change_ema
            else:
                new_ema = self._tier_emas.get(endpoint_id, 0.0)

        if old is not None:
            self._remove_from_roles_index(endpoint_id, old.value)
            if old.from_disk:
                self._disk_stale_count -= 1
            self._total_bytes -= old.size_bytes
        else:
            # New entry: enforce both limits before inserting.
            max_entries = self._max_entries()
            max_bytes = self._max_memory_bytes()
            while self._details and (
                (max_entries > 0 and len(self._details) >= max_entries)
                or (max_bytes > 0 and self._total_bytes + size_bytes > max_bytes)
            ):
                self._evict_oldest()
        if from_disk:
            self._disk_stale_count += 1
        self._details[endpoint_id] = CachedEntry(
            value, self._now(), from_disk=from_disk, size_bytes=size_bytes,
            change_ema=new_ema, value_hash=new_hash,
        )
        self._total_bytes += size_bytes
        self._add_to_roles_index(endpoint_id, value)
        CACHE_ENTRIES.set(len(self._details))
        CACHE_DISK_STALE.set(self._disk_stale_count)
        CACHE_MEMORY_BYTES.set(self._total_bytes)

    def invalidate_detail(self, endpoint_id: str) -> None:
        entry = self._details.pop(endpoint_id, None)
        if entry is not None:
            # Gem EMA i _tier_emas så den overlever invalidation og bruges ved næste put_detail.
            self._tier_emas[endpoint_id] = entry.change_ema
            self._remove_from_roles_index(endpoint_id, entry.value)
            if entry.from_disk:
                self._disk_stale_count -= 1
            self._total_bytes -= entry.size_bytes
            self._stats["invalidations"] += 1
            CACHE_ENTRIES.set(len(self._details))
            CACHE_MEMORY_BYTES.set(self._total_bytes)

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
            self._total_bytes = 0
            self._stats["invalidations"] += 1
            CACHE_ENTRIES.set(0)
            CACHE_DISK_STALE.set(0)
            CACHE_MEMORY_BYTES.set(0)

    def detail_ids(self) -> list[str]:
        return list(self._details.keys())

    def detail_age(self, endpoint_id: str) -> float | None:
        entry = self._details.get(endpoint_id)
        return None if entry is None else self._age(entry)

    # ------------------------------------------------------------------ #
    # Disk persistence                                                     #
    # ------------------------------------------------------------------ #

    def _save_snapshot(
        self,
        path: Path,
        snapshot: dict[str, "CachedEntry[Any]"],
        tier_emas_snap: dict[str, float],
    ) -> int:
        """Serialisér pre-taget snapshot til JSON. Kaldt fra event-loop (sync)
        eller thread-pool (async). Parametrene er snapshot-kopier taget på
        event-loop-tråden, så dict-iteration her er thread-safe.
        """
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            entries: dict[str, Any] = {}
            for ep_id, entry in snapshot.items():
                if entry.from_disk:
                    continue  # don't re-persist disk-loaded stale data
                try:
                    value_dict = (
                        entry.value.model_dump()
                        if hasattr(entry.value, "model_dump")
                        else dict(entry.value)
                    )
                    entries[ep_id] = {
                        "fetched_at": entry.fetched_at,
                        "change_ema": entry.change_ema,
                        "value_hash": entry.value_hash,
                        "value": value_dict,
                    }
                except Exception:  # noqa: BLE001
                    pass
            payload = {
                "version": DISK_CACHE_VERSION,
                "saved_at": self._now(),
                "count": len(entries),
                "entries": entries,
                "tier_emas": tier_emas_snap,
            }
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            logger.info("disk cache: saved %d entries to %s", len(entries), path)
            return len(entries)
        except Exception as exc:  # noqa: BLE001
            logger.warning("disk cache: save failed: %s", exc)
            return 0

    def save_to_disk(self, path: Path) -> int:
        """Serialisér alle detail-entries til JSON-fil. Returnerer antal entries.
        Tag snapshot på den kaldende tråd (altid event-loop ved synkron brug).
        """
        snapshot = dict(self._details)
        tier_emas_snap = dict(self._tier_emas)
        return self._save_snapshot(path, snapshot, tier_emas_snap)

    async def save_to_disk_async(self, path: Path) -> int:
        """Non-blocking: snapshot på event-loop-tråden, serialisering i thread-pool.
        Snapshot tages HER så thread-pool ikke itererer det delte _details-dict
        mens event-loopen kan kalde put_detail/invalidate_detail concurrently.
        (300–700 ms ved 10K endpoints — blokerer event-loopen uden executor.)
        """
        snapshot = dict(self._details)
        tier_emas_snap = dict(self._tier_emas)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._save_snapshot, path, snapshot, tier_emas_snap
        )

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
            # Gendan tier EMA-historik for endpoints der ikke allerede er i _tier_emas.
            # Disse værdier gælder for endpoints der var invaliderede ved shutdown.
            saved_emas: dict[str, float] = payload.get("tier_emas", {})
            for ep_id, ema in saved_emas.items():
                if ep_id not in self._tier_emas:
                    self._tier_emas[ep_id] = float(ema)

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
                    self.put_detail(ep_id, value, from_disk=True)
                    # Preserve original timestamp + tier data from disk.
                    entry = self._details.get(ep_id)
                    if entry is not None:
                        entry.fetched_at = fetched_at
                        entry.change_ema = float(raw.get("change_ema", 0.0))
                        entry.value_hash = raw.get("value_hash", "")
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
        # Ryd afsluttede inflight-tasks for at undgå gradvis hukommelseslækage.
        done_keys = [k for k, t in self._inflight_detail.items() if t.done()]
        for k in done_keys:
            del self._inflight_detail[k]

        max_entries = self._max_entries()
        max_bytes = self._max_memory_bytes()

        # Enkelt O(n) pass: alder, staleness-distribution og tier-fordeling.
        # Erstatter tidligere 3 separate list-comprehensions + max/sum-kald.
        now = self._now()
        ttl = self._ttl()
        stale_max = ttl * STALE_MAX_FACTOR
        fresh_count = stale_count = very_stale_count = 0
        tier_hot = tier_warm = tier_cold = 0
        oldest_age = 0.0
        total_age = 0.0
        n = len(self._details)
        for entry in self._details.values():
            age = now - entry.fetched_at
            total_age += age
            if age > oldest_age:
                oldest_age = age
            if age <= ttl:
                fresh_count += 1
            elif age <= stale_max:
                stale_count += 1
            else:
                very_stale_count += 1
            ema = entry.change_ema
            if ema >= TIER_HOT_EMA:
                tier_hot += 1
            elif ema < TIER_COLD_EMA:
                tier_cold += 1
            else:
                tier_warm += 1

        return {
            "enabled": self.enabled(),
            "ttl_seconds": ttl,
            "stale_while_revalidate": self._swr(),
            "detail_entries": n,
            "max_entries": max_entries if max_entries > 0 else "unlimited",
            "total_bytes": self._total_bytes,
            "max_memory_bytes": max_bytes if max_bytes > 0 else "unlimited",
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
            "inflight_detail_refreshes": len(self._inflight_detail),  # done-tasks allerede renset ovenfor
            "inflight_groups_refresh": bool(
                self._inflight_groups and not self._inflight_groups.done()
            ),
            "tiers": {
                "hot":  tier_hot,
                "warm": tier_warm,
                "cold": tier_cold,
            },
            "staleness": {
                "fresh_count": fresh_count,
                "stale_count": stale_count,
                "very_stale_count": very_stale_count,
                "stale_pct": round((stale_count + very_stale_count) / n * 100, 1) if n else 0.0,
                # very_stale_pct: andel UDENFOR SWR-vinduet (age > TTL × 30). I normal drift = 0.
                "very_stale_pct": round(very_stale_count / n * 100, 1) if n else 0.0,
                "oldest_entry_age_s": round(oldest_age, 1) if n else None,
                "average_entry_age_s": round(total_age / n, 1) if n else None,
            },
        }


_cache = EndpointCache()


def get_cache() -> EndpointCache:
    return _cache
