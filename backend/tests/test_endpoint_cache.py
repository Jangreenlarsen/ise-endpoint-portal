"""Unit tests for EndpointCache.

Dækker: put/get (fresh hit), TTL udløb (miss), stale-while-revalidate,
FIFO-eviction ved cache_max_entries, roles_index, invalidation.
Ingen ISE-forbindelser — fetch_fn er altid en simpel coroutine.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import patch

import pytest

from app.core.endpoint_cache import CachedEntry, EndpointCache


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def make_cache(max_entries: int = 100, ttl: float = 60.0, swr: bool = True) -> EndpointCache:
    """Returner en frisk EndpointCache med patchede settings."""
    cache = EndpointCache()
    patch("app.core.config.settings.cache_enabled", True).start()
    patch("app.core.config.settings.cache_max_entries", max_entries).start()
    patch("app.core.config.settings.cache_ttl_seconds", ttl).start()
    patch("app.core.config.settings.cache_stale_while_revalidate", swr).start()
    return cache


def simple_value(name: str = "test") -> Any:
    """Simpelt objekt uden roles — bruges som endpoint-detail-surrogat."""
    class _Val:
        roles = None
        cache_stale = False
        def model_copy(self, *, update=None):
            return self
    v = _Val()
    v.name = name
    return v


async def fetcher(value: Any):
    """Returner value som en coroutine (simulerer ISE-kald)."""
    return value


# ------------------------------------------------------------------ #
# Fresh hit                                                            #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_fresh_hit_returns_cached_value():
    cache = make_cache()
    val = simple_value("ep1")
    cache.put_detail("id-1", val)

    result = await cache.get_detail("id-1", lambda: fetcher(simple_value("stale")))
    assert result is val
    assert cache.stats()["hits"] == 1
    assert cache.stats()["misses"] == 0


# ------------------------------------------------------------------ #
# TTL miss                                                             #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_expired_entry_triggers_miss():
    cache = make_cache(ttl=0.01, swr=False)
    old_val = simple_value("old")
    new_val = simple_value("new")
    cache.put_detail("id-2", old_val)

    await asyncio.sleep(0.05)  # lad TTL udløbe

    result = await cache.get_detail("id-2", lambda: fetcher(new_val))
    assert result is new_val
    assert cache.stats()["misses"] >= 1


# ------------------------------------------------------------------ #
# Stale-while-revalidate                                              #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_swr_returns_stale_and_spawns_refresh():
    cache = make_cache(ttl=0.01, swr=True)
    stale_val = simple_value("stale")
    fresh_val = simple_value("fresh")
    cache.put_detail("id-3", stale_val)

    await asyncio.sleep(0.05)  # TTL udløbet, men stadig inden STALE_MAX_FACTOR

    result = await cache.get_detail("id-3", lambda: fetcher(fresh_val))
    # SWR: stale value returneres øjeblikkeligt
    assert result is stale_val
    assert cache.stats()["stale_serves"] == 1
    # Lad baggrunds-refresh fuldføre
    await asyncio.sleep(0.05)
    assert cache.stats()["bg_refreshes"] >= 1


# ------------------------------------------------------------------ #
# FIFO eviction                                                        #
# ------------------------------------------------------------------ #

def test_fifo_eviction_removes_oldest_entry():
    cache = make_cache(max_entries=3)
    for i in range(3):
        cache.put_detail(f"id-{i}", simple_value(f"ep{i}"))
    assert cache.detail_count() == 3

    # Indsæt én mere — id-0 (ældste) skal evictes
    cache.put_detail("id-new", simple_value("new"))
    assert cache.detail_count() == 3
    assert "id-0" not in cache.detail_ids()
    assert "id-new" in cache.detail_ids()
    assert cache.stats()["evictions"] == 1


def test_no_eviction_when_updating_existing_entry():
    cache = make_cache(max_entries=3)
    for i in range(3):
        cache.put_detail(f"id-{i}", simple_value(f"ep{i}"))

    # Opdater eksisterende — ingen eviction
    cache.put_detail("id-1", simple_value("updated"))
    assert cache.detail_count() == 3
    assert cache.stats()["evictions"] == 0


def test_eviction_counter_increments_per_eviction():
    cache = make_cache(max_entries=2)
    cache.put_detail("id-a", simple_value())
    cache.put_detail("id-b", simple_value())
    cache.put_detail("id-c", simple_value())  # eviction 1
    cache.put_detail("id-d", simple_value())  # eviction 2
    assert cache.stats()["evictions"] == 2


def test_zero_max_entries_means_unlimited():
    cache = make_cache(max_entries=0)
    for i in range(200):
        cache.put_detail(f"id-{i}", simple_value())
    assert cache.detail_count() == 200
    assert cache.stats()["evictions"] == 0


# ------------------------------------------------------------------ #
# Invalidation                                                         #
# ------------------------------------------------------------------ #

def test_invalidate_detail_removes_entry():
    cache = make_cache()
    cache.put_detail("id-x", simple_value())
    assert cache.detail_count() == 1

    cache.invalidate_detail("id-x")
    assert cache.detail_count() == 0
    assert "id-x" not in cache.detail_ids()


def test_invalidate_all_clears_cache():
    cache = make_cache()
    for i in range(5):
        cache.put_detail(f"id-{i}", simple_value())
    cache.invalidate_all()
    assert cache.detail_count() == 0
    assert cache.stats()["invalidations"] == 1


# ------------------------------------------------------------------ #
# Roles index                                                          #
# ------------------------------------------------------------------ #

def test_roles_index_populated_on_put():
    cache = make_cache()

    class _ValWithRoles:
        roles = ["netops", "helpdesk"]
        cache_stale = False

    cache.put_detail("id-r1", _ValWithRoles())
    ids = cache.get_ids_for_roles(["netops"])
    assert "id-r1" in ids


def test_roles_index_cleaned_on_invalidate():
    cache = make_cache()

    class _ValWithRoles:
        roles = ["netops"]
        cache_stale = False

    cache.put_detail("id-r2", _ValWithRoles())
    cache.invalidate_detail("id-r2")
    ids = cache.get_ids_for_roles(["netops"])
    assert "id-r2" not in ids


def test_roles_index_case_insensitive():
    cache = make_cache()

    class _ValWithRoles:
        roles = ["NetOps"]
        cache_stale = False

    cache.put_detail("id-r3", _ValWithRoles())
    assert "id-r3" in cache.get_ids_for_roles(["netops"])
    assert "id-r3" in cache.get_ids_for_roles(["NETOPS"])


# ------------------------------------------------------------------ #
# Disabled cache                                                       #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_disabled_cache_always_calls_fetch_fn():
    cache = EndpointCache()
    with patch("app.core.config.settings.cache_enabled", False):
        called = []
        async def counting_fetcher():
            called.append(1)
            return simple_value("live")
        await cache.get_detail("id-disabled", counting_fetcher)
        await cache.get_detail("id-disabled", counting_fetcher)
    assert len(called) == 2
