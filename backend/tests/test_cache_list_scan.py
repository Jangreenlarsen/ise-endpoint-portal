# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Cache-scanning fra Open API-listen (cache_scan_source=openapi_list)."""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.core import config
from app.core.endpoint_cache import EndpointCache
from app.core.exceptions import IseApiError
from app.schemas.endpoint import EndpointDetail
from app.services import cache_prewarm
from app.services.endpoint_service import EndpointService, ListSourceUnusable


# ── list_full_endpoints_openapi ───────────────────────────────────────────────

class ListClient:
    """Svarer på GET /api/v1/endpoint med `items` i sider; total er altid 0 (som ISE 3.5).

    `overflow_400=True` efterligner ISE Open API: en side efter den sidste giver
    400 i stedet for en tom liste (P-10). `errors` = {side: IseApiError}.
    """

    def __init__(self, items, overflow_400=False, errors=None):
        self.items = items
        self.overflow_400 = overflow_400
        self.errors = errors or {}
        self.pages: list[int] = []

    async def get(self, path, params=None):
        p = dict(params)
        page, size = int(p["page"]), int(p["size"])
        self.pages.append(page)
        if page in self.errors:
            raise self.errors[page]
        chunk = self.items[(page - 1) * size: page * size]
        if self.overflow_400 and page > 1 and not chunk:
            raise IseApiError(400, "")
        return {"response": chunk, "total": 0}


def _items(n, **extra):
    return [{"id": f"id-{i}", "mac": f"m{i}", "customAttributes": {"A": str(i)}, **extra} for i in range(n)]


def _list(items, conc=5, **kw):
    client = ListClient(items, **kw)
    svc = EndpointService.__new__(EndpointService)
    svc.client = client
    return asyncio.run(svc.list_full_endpoints_openapi(concurrency=conc)), client


def test_stopper_ved_kort_side_og_ignorerer_total_0():
    items, client = _list(_items(250))
    assert len(items) == 250
    assert sorted(client.pages) == [1, 2, 3, 4, 5, 6]  # side 1 alene, så én bølge à 5


def test_p10_ise_svarer_400_paa_side_efter_den_sidste():
    # Produktion: 132 endpoints, concurrency 5 → side 3-6 giver 400 fra ISE.
    items, client = _list(_items(132), overflow_400=True)
    assert len(items) == 132
    assert sorted(client.pages) == [1, 2, 3, 4, 5, 6]


def test_p10_praecis_fuld_sidste_side_og_400_bagefter():
    items, _ = _list(_items(200), conc=3, overflow_400=True)
    assert len(items) == 200


def test_p10_kun_en_side_henter_ikke_flere():
    items, client = _list(_items(40), overflow_400=True)
    assert len(items) == 40
    assert client.pages == [1]


def test_p10_fejl_paa_side_1_kan_ikke_bruges():
    with pytest.raises(ListSourceUnusable, match="side 1"):
        _list(_items(10), errors={1: IseApiError(400, "bad")})


def test_p10_serverfejl_midt_i_listen_kan_ikke_bruges():
    with pytest.raises(ListSourceUnusable, match="side 2"):
        _list(_items(350), errors={2: IseApiError(500, "boom")})


def test_p10_400_midt_i_listen_med_data_bagefter_er_inkonsistent():
    with pytest.raises(ListSourceUnusable, match="inkonsistent"):
        _list(_items(450), errors={2: IseApiError(400, "")})


def test_praecis_fuld_side_stopper_ved_tom_naeste_side():
    items, client = _list(_items(200), conc=2)
    assert len(items) == 200
    assert sorted(client.pages) == [1, 2, 3]


def test_ingen_endpoints():
    items, _ = _list([])
    assert items == []


def test_manglende_custom_attributes_kan_ikke_bruges():
    data = _items(3)
    del data[1]["customAttributes"]
    with pytest.raises(ListSourceUnusable, match="customAttributes"):
        _list(data)


def test_dubletter_kan_ikke_bruges():
    data = _items(3)
    data[2]["id"] = "id-0"
    with pytest.raises(ListSourceUnusable, match="dubletter"):
        _list(data)


# ── _full_scan i begge tilstande ──────────────────────────────────────────────

def _detail(raw, ep_id):
    return EndpointDetail(id=ep_id, name=raw.get("mac", ""), mac=raw.get("mac", ""),
                          profile_id=raw.get("profileId", ""), profiler_name=raw.get("profileName", ""))


def _scan(monkeypatch, source, *, list_result=None, list_error=None, cache=None, ers_ids=None):
    monkeypatch.setattr(config.settings, "cache_scan_source", source, raising=False)
    monkeypatch.setattr(config.settings, "cache_prewarm_skip_fresh_s", 0, raising=False)
    cache = cache or EndpointCache()
    worker = cache_prewarm.PrewarmWorker()
    worker._save_to_disk = AsyncMock()
    worker._fetch_all_ids = AsyncMock(return_value=ers_ids or [])
    list_mock = AsyncMock(return_value=list_result, side_effect=list_error)
    fetch_mock = AsyncMock(side_effect=lambda ep_id: EndpointDetail(id=ep_id, name=ep_id))
    with patch.object(cache_prewarm, "get_cache", return_value=cache), \
         patch.object(cache_prewarm, "get_ise_client"), \
         patch.object(EndpointService, "__init__", lambda self, client: None), \
         patch.object(EndpointService, "_get_group_names", AsyncMock(return_value={})), \
         patch.object(EndpointService, "list_full_endpoints_openapi", list_mock), \
         patch.object(EndpointService, "_detail_from_raw", AsyncMock(side_effect=_detail)), \
         patch.object(EndpointService, "_fetch_endpoint_detail", fetch_mock), \
         patch("app.core.first_seen_store.delete"):
        asyncio.run(worker._full_scan())
    return worker, cache, list_mock, fetch_mock


def test_liste_tilstand_bruger_listen_uden_detaljekald(monkeypatch):
    raw = [{"id": "a", "mac": "AA", "profileId": "p1", "profileName": "Win"},
           {"id": "b", "mac": "BB", "profileId": "p2", "profileName": "Mac"}]
    worker, cache, list_mock, fetch_mock = _scan(monkeypatch, "openapi_list", list_result=raw)
    assert worker.status.scan_source == "openapi_list"
    assert worker.status.scan_fallback_reason == ""
    assert worker.status.scanned == 2
    assert worker.status.last_scan_duration_s is not None
    fetch_mock.assert_not_awaited()
    worker._fetch_all_ids.assert_not_awaited()
    assert cache.peek_detail("a").profiler_name == "Win"


def test_liste_tilstand_beholder_kendt_profil_naar_listen_mangler_den(monkeypatch):
    cache = EndpointCache()
    cache.put_detail("a", EndpointDetail(id="a", name="AA", profile_id="p1", profiler_name="Win", vendor="Dell"))
    raw = [{"id": "a", "mac": "AA"}]  # profileId udeladt i listen
    worker, cache, *_ = _scan(monkeypatch, "openapi_list", list_result=raw, cache=cache)
    d = cache.peek_detail("a")
    assert (d.profile_id, d.profiler_name, d.vendor) == ("p1", "Win", "Dell")
    assert worker.status.list_profile_kept == 1


def test_liste_tilstand_fjerner_slettede_endpoints(monkeypatch):
    cache = EndpointCache()
    cache.put_detail("gone", EndpointDetail(id="gone", name="GG", mac="GG"))
    worker, cache, *_ = _scan(monkeypatch, "openapi_list", list_result=[{"id": "a", "mac": "AA"}], cache=cache)
    assert cache.peek_detail("gone") is None
    assert worker.status.deleted == 1


def test_fejl_i_listen_falder_tilbage_til_ers(monkeypatch):
    worker, cache, list_mock, fetch_mock = _scan(
        monkeypatch, "openapi_list",
        list_error=ListSourceUnusable("Open API-listen mangler customAttributes for x"),
        ers_ids=["e1", "e2"],
    )
    assert worker.status.scan_source == "ers"
    assert "customAttributes" in worker.status.scan_fallback_reason
    assert fetch_mock.await_count == 2
    assert cache.peek_detail("e1") is not None


def test_ers_tilstand_kalder_ikke_listen(monkeypatch):
    worker, _, list_mock, fetch_mock = _scan(monkeypatch, "ers", ers_ids=["e1"])
    list_mock.assert_not_awaited()
    assert worker.status.scan_source == "ers"
    assert fetch_mock.await_count == 1


def test_afkortet_liste_sletter_ikke_cachen(monkeypatch):
    cache = EndpointCache()
    for i in range(30):
        cache.put_detail(f"e{i}", EndpointDetail(id=f"e{i}", name=f"E{i}", mac=f"E{i}"))
    worker, cache, _, fetch_mock = _scan(
        monkeypatch, "openapi_list", list_result=[{"id": "e0", "mac": "E0"}],
        cache=cache, ers_ids=[f"e{i}" for i in range(30)],
    )
    assert worker.status.scan_source == "ers"
    assert "kun 1 endpoints" in worker.status.scan_fallback_reason
    assert worker.status.deleted == 0
    assert cache.peek_detail("e29") is not None
