# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Tests for IseClient læs/skriv-node-split + auto-fallback (v6.31.0740).

Dækker: GET → read-host, skriv → primary, auto-fallback ved read transport-fejl
og read-CB-open, INGEN fallback ved autoritativt HTTP-svar (404), og at split
er inaktiv (delt klient-objekt) når read-url er tom eller = base-url.

Ingen netværk: httpx-klienternes `.request` mockes.
"""
from __future__ import annotations

import httpx
import pytest
from unittest.mock import AsyncMock, patch

from app.core.exceptions import IseApiError
from app.ise.client import IseClient


def _resp(status: int = 200, body: bytes = b'{"ok": true}') -> httpx.Response:
    return httpx.Response(status_code=status, content=body)


def _make_client(
    read_url: str = "https://secondary.example",
    base_url: str = "https://primary.example",
) -> IseClient:
    """Byg en IseClient med patchede settings (ingen h2, ingen retry-sleep)."""
    with patch.multiple(
        "app.core.config.settings",
        ise_base_url=base_url,
        ise_read_base_url=read_url,
        ise_username="u",
        ise_password="p",
        ise_http2=False,
        ise_retry_attempts=1,   # ingen retry-back-off → hurtige transport-fejl-tests
        ise_verify_tls=False,
        ise_ca_bundle="",
    ):
        return IseClient()


@pytest.fixture
def split_client() -> IseClient:
    c = _make_client()
    c._http.request = AsyncMock(return_value=_resp(200, b'{"which": "primary"}'))
    c._http_read.request = AsyncMock(return_value=_resp(200, b'{"which": "read"}'))
    return c


# ── Konfiguration ─────────────────────────────────────────────────────────────

def test_split_active_with_distinct_read_host(split_client):
    assert split_client._split is True
    assert split_client._http_read is not split_client._http
    assert split_client._cb_read is not split_client._cb


def test_no_split_when_read_host_empty():
    c = _make_client(read_url="")
    assert c._split is False
    assert c._http_read is c._http
    assert c._cb_read is c._cb


def test_no_split_when_read_equals_base():
    c = _make_client(read_url="https://primary.example")
    assert c._split is False
    assert c._http_read is c._http


# ── Routing ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_routes_to_read_host(split_client):
    data = await split_client.get("/ers/config/endpoint")
    assert data == {"which": "read"}
    split_client._http_read.request.assert_awaited_once()
    split_client._http.request.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("verb", ["post", "put", "delete"])
async def test_writes_route_to_primary(split_client, verb):
    await getattr(split_client, verb)("/ers/config/endpoint")
    split_client._http.request.assert_awaited_once()
    split_client._http_read.request.assert_not_awaited()


# ── Auto-fallback ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_read_transport_error_falls_back_to_primary(split_client):
    split_client._http_read.request = AsyncMock(side_effect=httpx.ConnectError("boom"))
    data = await split_client.get("/ers/config/endpoint")
    assert data == {"which": "primary"}          # serveret af primary
    split_client._http.request.assert_awaited_once()


@pytest.mark.asyncio
async def test_read_cb_open_fast_fails_to_primary(split_client):
    # Tving read-CB åben — GET skal fast-fail og gå direkte til primary
    while not split_client._cb_read.is_open():
        split_client._cb_read.record_failure()
    data = await split_client.get("/ers/config/endpoint")
    assert data == {"which": "primary"}
    split_client._http.request.assert_awaited_once()
    split_client._http_read.request.assert_not_awaited()  # slet ikke forsøgt


@pytest.mark.asyncio
async def test_read_http_error_does_not_fall_back(split_client):
    # 404 fra ISE er et autoritativt svar → ingen fallback til primary
    split_client._http_read.request = AsyncMock(return_value=_resp(404, b'{"message": "nope"}'))
    with pytest.raises(IseApiError) as exc:
        await split_client.get("/ers/config/endpoint")
    assert exc.value.status_code == 404
    split_client._http.request.assert_not_awaited()


@pytest.mark.asyncio
async def test_writes_never_fall_back(split_client):
    # En skrive-fejl mod primary skal boble op (ingen read-host at falde tilbage på)
    split_client._http.request = AsyncMock(side_effect=httpx.ConnectError("boom"))
    with pytest.raises(IseApiError) as exc:
        await split_client.post("/ers/config/endpoint")
    assert exc.value.status_code == 0
    split_client._http_read.request.assert_not_awaited()


# ── Node-status / probe (link-synlighed) ──────────────────────────────────────

def test_node_status_initial_unknown(split_client):
    st = split_client.node_status()
    assert st["split_active"] is True
    assert [n["role"] for n in st["nodes"]] == ["primary", "read"]
    assert all(n["status"] == "unknown" for n in st["nodes"])


def test_node_status_single_host_no_read():
    c = _make_client(read_url="")
    st = c.node_status()
    assert st["split_active"] is False
    assert [n["role"] for n in st["nodes"]] == ["primary"]


@pytest.mark.asyncio
async def test_node_status_reflects_real_traffic(split_client):
    await split_client.get("/ers/config/endpoint")   # → read-host, 200
    await split_client.post("/ers/config/endpoint")  # → primary, 200
    st = {n["role"]: n for n in split_client.node_status()["nodes"]}
    assert st["read"]["status"] == "up"
    assert st["primary"]["status"] == "up"
    assert st["read"]["last_latency_ms"] is not None


_ERS_BODY = b'{"SearchResult":{"total":1,"resources":[]}}'


@pytest.mark.asyncio
async def test_probe_reports_up_and_down_per_node(split_client):
    split_client._http.request = AsyncMock(return_value=_resp(200, _ERS_BODY))
    split_client._http_read.request = AsyncMock(side_effect=httpx.ConnectError("boom"))
    res = await split_client.probe()
    by = {n["role"]: n for n in res["nodes"]}
    assert by["primary"]["ok"] is True
    assert by["read"]["ok"] is False and by["read"]["error"] == "ConnectError"
    # den passive status afspejler probe-resultatet
    st = {n["role"]: n for n in split_client.node_status()["nodes"]}
    assert st["primary"]["status"] == "up"
    assert st["read"]["status"] == "down" and st["read"]["last_error"] == "ConnectError"


@pytest.mark.asyncio
async def test_probe_flags_http_error_as_not_ok(split_client):
    split_client._http.request = AsyncMock(return_value=_resp(401, b'{"m":"no"}'))
    res = await split_client.probe()
    prim = next(n for n in res["nodes"] if n["role"] == "primary")
    assert prim["ok"] is False and prim["error"] == "HTTP 401"


@pytest.mark.asyncio
async def test_probe_flags_redirect_as_not_ok(split_client):
    # En Secondary PAN der redirecter (302) må ALDRIG vises som OK.
    split_client._http.request = AsyncMock(return_value=_resp(302, b""))
    res = await split_client.probe()
    prim = next(n for n in res["nodes"] if n["role"] == "primary")
    assert prim["ok"] is False and prim["error"] == "HTTP 302"


@pytest.mark.asyncio
async def test_probe_flags_empty_2xx_as_not_ok(split_client):
    # 2xx uden SearchResult (tomt/forkert svar) er ikke rigtig ERS-data → ikke OK.
    split_client._http.request = AsyncMock(return_value=_resp(200, b'{"foo":1}'))
    res = await split_client.probe()
    prim = next(n for n in res["nodes"] if n["role"] == "primary")
    assert prim["ok"] is False and "ERS-data" in (prim["error"] or "")


@pytest.mark.asyncio
async def test_read_redirect_falls_back_to_primary(split_client):
    # Kernefixet: en redirecting læse-host (Secondary PAN) skal markeres FEJL og
    # GET skal falde tilbage til Primary — ikke returnere et tomt svar som "OK".
    split_client._http_read.request = AsyncMock(return_value=_resp(302, b""))
    data = await split_client.get("/ers/config/endpoint")
    assert data == {"which": "primary"}                 # serveret af Primary via fallback
    split_client._http.request.assert_awaited_once()
    st = {n["role"]: n for n in split_client.node_status()["nodes"]}
    assert st["read"]["status"] == "down" and st["read"]["last_error"] == "HTTP 302"
    assert st["primary"]["status"] == "up"
