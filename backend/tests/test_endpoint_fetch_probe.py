# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Test: Endpoint-hentning (Open API-liste vs. ERS N+1) — services/endpoint_fetch_probe.py."""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core import auth as auth_core
from app.core.exceptions import IseApiError
from app.main import app
from app.services import endpoint_fetch_probe as probe

TOTAL = 250  # → 3 sider à 100


def _open_item(i: int, ca: dict | None = None, with_ca: bool = True) -> dict:
    item = {"id": f"id-{i}", "mac": f"AA:BB:CC:00:00:{i:02X}", "groupId": "grp-1", "profileId": "prof-1"}
    if with_ca:
        item["customAttributes"] = ca if ca is not None else {"AuthzVlan": "20", "Owner": f"u{i}"}
    return item


class FakeIse:
    """Svarer som ISE. `detail_ca` overstyrer ERS-detaljens custom attributes."""

    def __init__(self, open_items, *, open_error=None, detail_ca=None):
        self.open_items = open_items
        self.open_error = open_error
        self.detail_ca = detail_ca or {}
        self.calls: list[tuple[str, str]] = []

    async def request(self, method, path, params=None, json=None, return_response=False):
        self.calls.append((method, path))
        assert method == "GET", "proben må kun sende GET"
        resp = SimpleNamespace(http_version="HTTP/2")
        if path == probe.OPENAPI_LIST:
            if self.open_error:
                raise self.open_error
            return {"response": self.open_items, "total": TOTAL}, resp
        if path == probe.ERS_LIST:
            res = [{"id": i["id"], "name": i["mac"]} for i in self.open_items]
            return {"SearchResult": {"total": TOTAL, "resources": res}}, resp
        ep_id = path.rsplit("/", 1)[-1]
        item = next(i for i in self.open_items if i["id"] == ep_id)
        ca = self.detail_ca.get(ep_id, item.get("customAttributes") or {})
        return {"ERSEndPoint": {"id": ep_id, "groupId": item["groupId"], "profileId": item["profileId"],
                                "customAttributes": {"customAttributes": ca}}}, resp


def _run(fake, pages=3):
    with patch.object(probe, "get_ise_client", return_value=fake):
        return asyncio.run(probe.run_probe(extra_pages=pages))


def test_fulde_data_giver_ok_og_estimat():
    fake = FakeIse([_open_item(i) for i in range(100)])
    r = _run(fake)
    assert r["verdict"] == "ok"
    assert r["openapi"]["items_with_custom_attributes"] == 100
    assert r["openapi"]["http_version"] == "HTTP/2"
    assert r["comparison"]["sampled"] == probe.SAMPLE_DETAILS
    assert r["comparison"]["custom_attributes_match"] == probe.SAMPLE_DETAILS
    est = r["estimate"]
    assert est["total_endpoints"] == TOTAL
    assert est["openapi_list_calls"] == 3
    assert est["ers_n_plus_1_calls"] == 3 + TOTAL
    assert est["ers_n_plus_1_seconds"] is not None


def test_kun_get_og_begraenset_antal_kald():
    fake = FakeIse([_open_item(i) for i in range(100)])
    _run(fake, pages=10)
    assert all(m == "GET" for m, _ in fake.calls)
    # 1 Open API + 1 ERS-liste + 5 detaljer + højst (sider-1)=2 ekstra sider ved 250 endpoints
    assert len(fake.calls) == 1 + 1 + probe.SAMPLE_DETAILS + 2


def test_liste_uden_custom_attributes_giver_advarsel():
    fake = FakeIse([_open_item(i, with_ca=False) for i in range(100)])
    r = _run(fake)
    assert r["verdict"] == "warning"
    assert "N+1" in r["message"]
    assert r["comparison"]["custom_attributes_match"] == 0


def test_afvigelse_mellem_liste_og_detalje_rapporteres():
    fake = FakeIse([_open_item(i) for i in range(100)], detail_ca={"id-0": {"AuthzVlan": "30", "Owner": "u0"}})
    r = _run(fake)
    assert r["verdict"] == "warning"
    row = next(c for c in r["comparison"]["rows"] if c["id"] == "id-0")
    assert row["custom_attributes_match"] is False
    assert row["differing_attributes"] == ["AuthzVlan"]


def test_open_api_slaaet_fra_giver_fejl_uden_videre_kald():
    fake = FakeIse([], open_error=IseApiError(401, "Unauthorized"))
    r = _run(fake)
    assert r["verdict"] == "error"
    assert "Open API" in r["message"]
    assert r["openapi"]["ok"] is False
    assert not any(p.startswith(probe.ERS_LIST + "/") for _, p in fake.calls)


def test_ers_nested_og_flad_custom_attributes():
    assert probe._custom_attrs({"customAttributes": {"customAttributes": {"A": 1}}}) == {"A": "1"}
    assert probe._custom_attrs({"customAttributes": {"A": None}}) == {"A": ""}
    assert probe._custom_attrs({"id": "x"}) is None


def _token(role: str) -> str:
    return auth_core.create_token(f"p-{role}", f"p_{role}", role)


def _users():
    return [
        {"id": f"p-{r}", "username": f"p_{r}", "password_hash": "x", "role": r, "user_type": "user",
         "created_at": "2026-01-01T00:00:00Z", "last_login": None,
         "assigned_endpoint_roles": [], "assigned_templates": []}
        for r in ("admin", "editor")
    ]


def test_route_kun_admin():
    client = TestClient(app)
    with patch("app.api.deps.load_users", return_value=_users()), \
         patch.object(probe, "run_probe", AsyncMock(return_value={"verdict": "ok"})) as run:
        r = client.post("/api/diagnostics/endpoint-fetch-probe?pages=2",
                        headers={"Authorization": f"Bearer {_token('editor')}"})
        assert r.status_code == 403
        r = client.post("/api/diagnostics/endpoint-fetch-probe?pages=2",
                        headers={"Authorization": f"Bearer {_token('admin')}"})
        assert r.status_code == 200
        assert r.json() == {"verdict": "ok"}
        run.assert_awaited_once_with(extra_pages=2)
        r = client.post("/api/diagnostics/endpoint-fetch-probe?pages=99",
                        headers={"Authorization": f"Bearer {_token('admin')}"})
        assert r.status_code == 422
