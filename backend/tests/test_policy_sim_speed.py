# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Hastighed af policy-simulering: parallel regel-hentning, SWR-cache og tidsmåling.

ISE-kaldene mockes med en kunstig forsinkelse (DELAY), så testene måler at kald
sker parallelt / fra cachen frem for i serie.
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import policy_service as ps_mod
from app.services.policy_service import PolicyService

DELAY = 0.2


@pytest.fixture(autouse=True)
def _clear():
    ps_mod.invalidate_policy_cache()
    yield
    ps_mod.invalidate_policy_cache()


def _sets(n=3):
    return [{"id": f"ps{i}", "name": f"Set {i}", "rank": i} for i in range(n)]


def _rules_for(ps_id):
    # Kun det sidste set har en regel der matcher (catch-all), så alle sets evalueres.
    if ps_id == "ps2":
        return [{"rule": {"id": "r1", "name": "Default", "rank": 0, "state": "enabled", "condition": None},
                 "profile": ["PermitAccess"]}]
    return []


class FakePolicyApi:
    def __init__(self, n_sets=3):
        self.n_sets = n_sets
        self.calls: list[str] = []

    async def list_policy_sets(self, client):
        self.calls.append("sets")
        await asyncio.sleep(DELAY)
        return _sets(self.n_sets)

    async def get_policy_set(self, client, ps_id):
        self.calls.append(f"ps:{ps_id}")
        await asyncio.sleep(DELAY)
        return {"id": ps_id, "name": f"Set {ps_id}"}

    async def list_authorization_rules(self, client, ps_id):
        self.calls.append(f"rules:{ps_id}")
        await asyncio.sleep(DELAY)
        return _rules_for(ps_id)


def _svc():
    return PolicyService(MagicMock())


async def _slow_ep(self, endpoint_id):
    await asyncio.sleep(DELAY)
    return {"owner": "x"}


def test_auto_kold_cache_henter_regler_parallelt_og_uden_policy_set_opslag():
    api = FakePolicyApi(n_sets=3)

    async def run():
        with patch.object(ps_mod, "policy_api", api), \
             patch.object(PolicyService, "_fetch_ep_from_ise", _slow_ep):
            t = time.perf_counter()
            r = await _svc().match_all({"endpoint_id": "e1"})
            return r, time.perf_counter() - t

    r, elapsed = asyncio.run(run())
    assert r.matched_rule_name == "Default"
    # Sekventielt før: sets + 3 × (ps + rules) + endpoint = 8 × DELAY.
    # Nu: sets → regler parallelt, endpoint samtidig = ca. 2 × DELAY.
    assert elapsed < 4 * DELAY
    assert not any(c.startswith("ps:") for c in api.calls)
    assert r.timing["cache"] == "cold"
    assert r.timing["ise_policy_calls"] == 4  # sets + 3 × rules
    assert r.timing["total_ms"] >= r.timing["rules_ms"]


def test_varm_cache_giver_ingen_policy_kald():
    api = FakePolicyApi()

    async def run():
        with patch.object(ps_mod, "policy_api", api), \
             patch.object(PolicyService, "_fetch_ep_from_ise", AsyncMock(return_value={})):
            await _svc().match_all({"endpoint_id": "e1"})
            n = len(api.calls)
            r = await _svc().match_all({"endpoint_id": "e1"})
            return r, len(api.calls) - n

    r, extra_calls = asyncio.run(run())
    assert extra_calls == 0
    assert r.timing["cache"] == "warm"
    assert r.timing["ise_policy_calls"] == 0


def test_forældet_cache_svarer_straks_og_opdaterer_i_baggrunden():
    api = FakePolicyApi()
    old = time.time() - ps_mod._POLICY_CACHE_TTL - 10
    ps_mod._cache["sets"] = (old, _sets())
    for s in _sets():
        ps_mod._cache[f"rules:{s['id']}"] = (old, _rules_for(s["id"]))

    async def run():
        with patch.object(ps_mod, "policy_api", api), \
             patch.object(PolicyService, "_fetch_ep_from_ise", AsyncMock(return_value={})):
            t = time.perf_counter()
            r = await _svc().match_all({"endpoint_id": "e1"})
            elapsed = time.perf_counter() - t
            await asyncio.gather(*list(ps_mod._background))
            return r, elapsed

    r, elapsed = asyncio.run(run())
    assert elapsed < DELAY  # ventede ikke på ISE
    assert r.timing["cache"] == "stale"
    assert set(api.calls) == {"sets", "rules:ps0", "rules:ps1", "rules:ps2"}  # opdateret i baggrunden
    assert time.time() - ps_mod._cache["sets"][0] < 5


def test_for_gammel_cache_hentes_friskt():
    api = FakePolicyApi()
    ps_mod._cache["sets"] = (time.time() - ps_mod._POLICY_CACHE_MAX_STALE - 10, [])

    async def run():
        with patch.object(ps_mod, "policy_api", api):
            return await _svc()._cached_policy_sets()

    assert len(asyncio.run(run())) == 3


def test_samtidige_forespørgsler_deler_et_kald():
    api = FakePolicyApi()

    async def run():
        with patch.object(ps_mod, "policy_api", api):
            await asyncio.gather(*(_svc()._cached_rules("ps2") for _ in range(5)))

    asyncio.run(run())
    assert api.calls.count("rules:ps2") == 1


def test_invalidering_under_hentning_gemmer_ikke_gammelt_svar():
    api = FakePolicyApi()

    async def run():
        with patch.object(ps_mod, "policy_api", api):
            fut = ps_mod._start_fetch("rules:ps2", lambda: api.list_authorization_rules(None, "ps2"))
            ps_mod.invalidate_policy_cache("ps2")
            await fut

    asyncio.run(run())
    assert "rules:ps2" not in ps_mod._cache


def test_policy_set_listen_varmer_reglerne_op():
    api = FakePolicyApi()

    async def run():
        with patch.object(ps_mod, "policy_api", api):
            await _svc().list_policy_sets()
            await asyncio.gather(*list(ps_mod._background))

    asyncio.run(run())
    assert all(f"rules:ps{i}" in ps_mod._cache for i in range(3))


def test_enkelt_set_simulering_bruger_navn_fra_listen_naar_den_er_cachet():
    api = FakePolicyApi()
    ps_mod._cache["sets"] = (time.time(), _sets())

    async def run():
        with patch.object(ps_mod, "policy_api", api):
            return await _svc().match_endpoint("ps2", {})

    r = asyncio.run(run())
    assert r.policy_set_name == "Set 2"
    assert "ps:ps2" not in api.calls
    assert r.timing is not None
