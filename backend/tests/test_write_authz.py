"""Regressionstests for skrive-autorisation (BUGS.md P-1, P-2, P-3).

Læse-stierne har altid filtreret på System adm-scope og maskeret PSK. Disse
tests holder på at skrive-stierne håndhæver de samme regler server-side:

- P-1: kun admin/editor-psk må skrive PSK_Key/PSK_Mode.
- P-2: non-admin må kun skrive/handle på endpoints i eget System adm-scope,
       og må kun tildele System adm-roller de selv har.
- P-3: registrant_templet opretter kun via en tildelt skabelon; klientens
       gruppe/attributter ignoreres.

Ingen ISE-kald: endpoint-servicen erstattes af en fake via dependency_overrides.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_endpoint_service
from app.core import auth as auth_core
from app.core.exceptions import IseApiError
from app.main import app
from app.schemas.endpoint import EndpointDetail


def _record(uid: str, username: str, role: str, roles=(), templates=()) -> dict:
    return {
        "id": uid,
        "username": username,
        "password_hash": "x",
        "role": role,
        "user_type": "user",
        "created_at": "2026-01-01T00:00:00Z",
        "last_login": None,
        "assigned_endpoint_roles": list(roles),
        "assigned_templates": list(templates),
    }


USERS = [
    _record("w-admin", "w_admin", "admin"),
    _record("w-editor", "w_editor", "editor", roles=["teamA"]),
    _record("w-psk", "w_psk", "editor-psk", roles=["teamA"]),
    _record("w-reg", "w_reg", "registrant"),
    _record("w-tpl", "w_tpl", "registrant_templet", templates=["tpl-1"]),
]
TOKENS = {u["role"]: auth_core.create_token(u["id"], u["username"], u["role"]) for u in USERS}

IN_SCOPE = "ep-in"     # tagget teamA
OUT_SCOPE = "ep-out"   # tagget teamB

TEMPLATES = [
    {
        "id": "tpl-1",
        "name": "Printer",
        "fields": {
            "group_id": "grp-printer",
            "custom_attributes": {"AuthzVlan": "20", "Type": "Printer"},
        },
        "visible_to": [],
    },
    {
        "id": "tpl-2",
        "name": "Server",
        "fields": {"group_id": "grp-server", "custom_attributes": {"AuthzVlan": "1"}},
        "visible_to": [],
    },
]


def _detail(ep_id: str) -> EndpointDetail:
    roles = ["teamA"] if ep_id == IN_SCOPE else ["teamB"]
    return EndpointDetail(id=ep_id, name="AA:BB:CC:DD:EE:01", mac="AA:BB:CC:DD:EE:01", roles=roles)


class FakeService:
    def __init__(self) -> None:
        self.create_endpoint = AsyncMock(return_value="new-id")
        self.update_endpoint = AsyncMock(return_value={"psk_changed": False, "psk_coa": None})
        self.delete_endpoint = AsyncMock()
        self.coa_reauth = AsyncMock(return_value=(True, "AA:BB:CC:DD:EE:01", "ok"))
        self.coa_disconnect = AsyncMock(return_value=(True, "AA:BB:CC:DD:EE:01", "ok"))
        self.decommission_endpoint = AsyncMock()
        self.bulk_decommission = AsyncMock(
            side_effect=lambda req: {
                "results": [{"id": i, "ok": True} for i in req.endpoint_ids],
                "ok_count": len(req.endpoint_ids),
            }
        )

    async def get_endpoint(self, endpoint_id, effective_roles=None, **_kw):
        d = _detail(endpoint_id)
        if effective_roles is not None and not {r.lower() for r in d.roles} & {
            r.lower() for r in effective_roles
        }:
            raise IseApiError(404, "not found")
        return d


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def svc():
    fake = FakeService()
    app.dependency_overrides[get_endpoint_service] = lambda: fake
    with patch("app.api.deps.load_users", return_value=USERS), \
         patch("app.core.template_store.load_templates", return_value=TEMPLATES):
        yield fake
    app.dependency_overrides.pop(get_endpoint_service, None)


def _h(role: str) -> dict:
    return {"Authorization": f"Bearer {TOKENS[role]}"}


def _sent_ca(mock) -> dict:
    req = mock.await_args.args[0] if mock.await_args.args else mock.await_args.kwargs["req"]
    return req.custom_attributes.model_dump(exclude_none=True) if req.custom_attributes else {}


def _sent_update_ca(mock) -> dict:
    upd = mock.await_args.args[1]
    return upd.custom_attributes.model_dump(exclude_none=True) if upd.custom_attributes else {}


PSK_BODY = {"PSK_Mode": "true", "PSK_Key": "Hemmelig123"}


# ── P-1: PSK-skrivning ────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["editor", "registrant"])
def test_create_strips_psk_for_non_psk_roles(client, svc, role):
    r = client.post("/api/endpoints", headers=_h(role),
                    json={"mac": "AA:BB:CC:DD:EE:01", "custom_attributes": PSK_BODY})
    assert r.status_code == 201
    ca = _sent_ca(svc.create_endpoint)
    assert "PSK_Key" not in ca and "PSK_Mode" not in ca


@pytest.mark.parametrize("role", ["admin", "editor-psk"])
def test_create_keeps_psk_for_psk_roles(client, svc, role):
    r = client.post("/api/endpoints", headers=_h(role),
                    json={"mac": "AA:BB:CC:DD:EE:01", "custom_attributes": PSK_BODY})
    assert r.status_code == 201
    assert _sent_ca(svc.create_endpoint)["PSK_Key"] == "Hemmelig123"


def test_update_strips_psk_for_editor(client, svc):
    r = client.put(f"/api/endpoints/{IN_SCOPE}", headers=_h("editor"),
                   json={"custom_attributes": PSK_BODY})
    assert r.status_code == 200
    ca = _sent_update_ca(svc.update_endpoint)
    assert "PSK_Key" not in ca and "PSK_Mode" not in ca


def test_bulk_create_strips_psk_for_editor(client, svc):
    svc.bulk_create = AsyncMock(return_value={"succeeded": [], "skipped": [], "overwritten": [], "failed": []})
    r = client.post("/api/endpoints/bulk", headers=_h("editor"),
                    json={"items": [{"mac": "AA:BB:CC:DD:EE:01", "custom_attributes": PSK_BODY}]})
    assert r.status_code == 200
    req = svc.bulk_create.await_args.args[0]
    assert req.items[0].custom_attributes.PSK_Key is None
    assert svc.bulk_create.await_args.kwargs["effective_roles"] is not None


# ── P-2: System adm-scope på skrive-/ops-ruter ────────────────────────────────

def test_update_out_of_scope_is_404(client, svc):
    r = client.put(f"/api/endpoints/{OUT_SCOPE}", headers=_h("editor"), json={"description": "x"})
    assert r.status_code == 404
    svc.update_endpoint.assert_not_awaited()


def test_update_in_scope_is_allowed(client, svc):
    r = client.put(f"/api/endpoints/{IN_SCOPE}", headers=_h("editor"), json={"description": "x"})
    assert r.status_code == 200


def test_admin_has_no_scope_limit(client, svc):
    r = client.put(f"/api/endpoints/{OUT_SCOPE}", headers=_h("admin"), json={"description": "x"})
    assert r.status_code == 200


def test_delete_out_of_scope_is_404(client, svc):
    r = client.delete(f"/api/endpoints/{OUT_SCOPE}", headers=_h("editor"))
    assert r.status_code == 404
    svc.delete_endpoint.assert_not_awaited()


@pytest.mark.parametrize("path", ["coa-reauth", "coa-disconnect", "decommission"])
def test_ops_out_of_scope_is_404(client, svc, path):
    r = client.post(f"/api/endpoints/{OUT_SCOPE}/{path}", headers=_h("editor"))
    assert r.status_code == 404


def test_bulk_decommission_skips_out_of_scope(client, svc):
    r = client.post("/api/endpoints/bulk-decommission", headers=_h("editor"),
                    json={"endpoint_ids": [IN_SCOPE, OUT_SCOPE]})
    assert r.status_code == 200
    sent = svc.bulk_decommission.await_args.args[0].endpoint_ids
    assert sent == [IN_SCOPE]
    denied = [x for x in r.json()["results"] if x["id"] == OUT_SCOPE]
    assert denied and denied[0]["ok"] is False


def test_bulk_coa_skips_out_of_scope(client, svc):
    r = client.post("/api/endpoints/bulk-coa", headers=_h("editor"),
                    json={"endpoint_ids": [IN_SCOPE, OUT_SCOPE]})
    assert r.status_code == 200
    assert svc.coa_reauth.await_count == 1
    assert r.json()["ok_count"] == 1


def test_cannot_assign_foreign_role_on_create(client, svc):
    r = client.post("/api/endpoints", headers=_h("editor"),
                    json={"mac": "AA:BB:CC:DD:EE:01",
                          "custom_attributes": {"HypervisionRoles": "teamA,teamB"}})
    assert r.status_code == 403
    svc.create_endpoint.assert_not_awaited()


def test_can_assign_own_role_on_create(client, svc):
    r = client.post("/api/endpoints", headers=_h("editor"),
                    json={"mac": "AA:BB:CC:DD:EE:01",
                          "custom_attributes": {"HypervisionRoles": "teamA,w_editor"}})
    assert r.status_code == 201


def test_cannot_add_foreign_role_on_update(client, svc):
    r = client.put(f"/api/endpoints/{IN_SCOPE}", headers=_h("editor"),
                   json={"custom_attributes": {"HypervisionRoles": "teamA,teamC"}})
    assert r.status_code == 403


# ── P-3: registrant_templet ───────────────────────────────────────────────────

def test_templet_requires_template(client, svc):
    r = client.post("/api/endpoints", headers=_h("registrant_templet"),
                    json={"mac": "AA:BB:CC:DD:EE:01", "group_id": "grp-server"})
    assert r.status_code == 422
    svc.create_endpoint.assert_not_awaited()


def test_templet_rejects_unassigned_template(client, svc):
    r = client.post("/api/endpoints", headers=_h("registrant_templet"),
                    json={"mac": "AA:BB:CC:DD:EE:01", "template_id": "tpl-2"})
    assert r.status_code == 403


def test_templet_payload_built_from_template(client, svc):
    r = client.post("/api/endpoints", headers=_h("registrant_templet"),
                    json={"mac": "AA:BB:CC:DD:EE:01", "template_id": "tpl-1",
                          "group_id": "grp-server",
                          "custom_attributes": {"AuthzVlan": "1", **PSK_BODY}})
    assert r.status_code == 201
    req = svc.create_endpoint.await_args.args[0]
    assert req.group_id == "grp-printer"
    ca = req.custom_attributes
    assert ca.AuthzVlan == "20"
    assert ca.PSK_Key is None
    assert ca.RegistretBy == "w_tpl"


# ── P-6: editor-psk må sende CoA ──────────────────────────────────────────────

@pytest.mark.parametrize("path", ["coa-reauth", "coa-disconnect"])
def test_psk_editor_can_send_coa(client, svc, path):
    r = client.post(f"/api/endpoints/{IN_SCOPE}/{path}", headers=_h("editor-psk"))
    assert r.status_code == 200


def test_psk_editor_can_bulk_coa(client, svc):
    r = client.post("/api/endpoints/bulk-coa", headers=_h("editor-psk"),
                    json={"endpoint_ids": [IN_SCOPE], "action": "disconnect"})
    assert r.status_code == 200 and r.json()["ok_count"] == 1


def test_update_returns_psk_coa_result(client, svc):
    svc.update_endpoint = AsyncMock(return_value={"psk_changed": True, "psk_coa": {"ok": True, "mac": "m", "message": "ok"}})
    r = client.put(f"/api/endpoints/{IN_SCOPE}", headers=_h("editor-psk"),
                   json={"custom_attributes": PSK_BODY})
    assert r.status_code == 200
    assert r.json()["psk_coa"]["ok"] is True
