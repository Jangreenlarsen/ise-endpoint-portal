"""Regressionstests for den uautentificerede selvregistrering (BUGS.md F-01/F-02).

Kernen i sikkerhedsmodellen: MAC'en kommer fra en serverside-binding oprettet af
`GET /selfregister/session` ud fra klientens FAKTISKE afsender-IP — aldrig fra
request-body. Testene her holder på præcis den egenskab.

Ingen ISE-kald: `mnt_sessions.session_by_ip`, endpoint-servicen og CoA mockes.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core import config, selfregister_bindings
from app.main import app

CLIENT_IP = "192.0.2.10"  # TEST-NET-1, jf. RFC 5737
MY_MAC = "AA:BB:CC:DD:EE:01"
VICTIM_MAC = "11:22:33:44:55:66"
GUEST_GROUP = "guest-group-id"


# ── Shared client (lifespan startes kun én gang per modul) ────────────────────

@pytest.fixture(scope="module")
def client():
    with TestClient(app, client=(CLIENT_IP, 44444)) as c:
        yield c


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    """Slå selvregistrering til og ryd bindinger omkring hver test."""
    selfregister_bindings.clear()
    monkeypatch.setattr(config.settings, "selfregister_enabled", True, raising=False)
    monkeypatch.setattr(config.settings, "selfregister_group_id", GUEST_GROUP, raising=False)
    # TestClient er ikke en betroet proxy — XFF må ikke tælle.
    monkeypatch.setattr(config.settings, "trusted_proxy_ips", [], raising=False)
    yield
    selfregister_bindings.clear()


class _Sess:
    def __init__(self, mac: str) -> None:
        self.mac = mac
        self.nas_ip = "10.0.0.1"
        self.acs_session_id = "sess-1"


@contextmanager
def _mnt(mac: str | None):
    with patch(
        "app.ise.mnt_sessions.session_by_ip",
        new=AsyncMock(return_value=_Sess(mac) if mac else None),
    ) as m:
        yield m


def _service(existing: dict | None):
    svc = AsyncMock()
    svc.endpoints.get_by_mac = AsyncMock(return_value=existing)
    svc.create_endpoint = AsyncMock(return_value="new-id")
    svc.update_endpoint = AsyncMock()
    return svc


@contextmanager
def _ise(existing: dict | None = None):
    svc = _service(existing)
    with patch("app.api.selfregister.get_endpoint_service", return_value=svc), \
         patch("app.api.selfregister.coa_reauth", new=AsyncMock(return_value=(True, "ok"))):
        yield svc


# ── F-02: session-opslaget må ikke kunne pege på en fremmed IP ────────────────

def test_session_lookup_ignores_ip_query_param(client):
    """?ip= må ikke kunne styre hvilken IP der slås op (MAC-oracle)."""
    with _mnt(MY_MAC) as mock:
        r = client.get("/api/selfregister/session", params={"ip": "10.9.9.9"})
    assert r.status_code == 200
    # MnT blev kaldt med klientens EGEN IP — ikke den angivne.
    assert mock.await_args.args[0] == CLIENT_IP


def test_session_lookup_rejects_untrusted_forwarded_for(client):
    """X-Forwarded-For fra en ikke-betroet afsender må ikke ændre klient-IP."""
    with _mnt(MY_MAC) as mock:
        r = client.get(
            "/api/selfregister/session",
            headers={"X-Forwarded-For": "203.0.113.7"},
        )
    assert r.status_code == 200
    assert mock.await_args.args[0] == CLIENT_IP


def test_session_lookup_honours_forwarded_for_from_trusted_proxy(client, monkeypatch):
    """Bag en betroet proxy SKAL den rigtige klient-IP bruges — ellers ville alle
    klienter dele én binding (BUGS.md F-07)."""
    monkeypatch.setattr(config.settings, "trusted_proxy_ips", [CLIENT_IP], raising=False)
    with _mnt(MY_MAC) as mock:
        r = client.get(
            "/api/selfregister/session",
            headers={"X-Forwarded-For": "203.0.113.7"},
        )
    assert r.status_code == 200
    assert mock.await_args.args[0] == "203.0.113.7"
    assert selfregister_bindings.lookup("203.0.113.7") == MY_MAC


def test_session_lookup_binds_mac_to_client_ip(client):
    with _mnt(MY_MAC):
        r = client.get("/api/selfregister/session")
    assert r.status_code == 200 and r.json()["found"] is True
    assert selfregister_bindings.lookup(CLIENT_IP) == MY_MAC


def test_no_binding_when_no_session_found(client):
    with _mnt(None):
        r = client.get("/api/selfregister/session")
    assert r.status_code == 200 and r.json()["found"] is False
    assert selfregister_bindings.lookup(CLIENT_IP) is None


# ── F-01: POST må ikke stole på MAC fra request-body ─────────────────────────

def test_post_without_binding_is_rejected(client):
    """Uden et forudgående session-opslag kan intet registreres."""
    with _ise() as svc:
        r = client.post(
            "/api/selfregister",
            json={"mac": VICTIM_MAC, "registrant_name": "Mallory", "agreed": True},
        )
    assert r.status_code == 409
    svc.create_endpoint.assert_not_awaited()
    svc.update_endpoint.assert_not_awaited()


def test_post_rejects_mac_that_differs_from_binding(client):
    """Bundet til egen MAC, men forsøger at registrere en fremmed → 403."""
    with _mnt(MY_MAC):
        client.get("/api/selfregister/session")
    with _ise() as svc:
        r = client.post(
            "/api/selfregister",
            json={"mac": VICTIM_MAC, "registrant_name": "Mallory", "agreed": True},
        )
    assert r.status_code == 403
    svc.create_endpoint.assert_not_awaited()


def test_post_uses_bound_mac_not_body_mac(client):
    """Body-MAC ignoreres helt: ISE røres kun med den bundne MAC."""
    with _mnt(MY_MAC):
        client.get("/api/selfregister/session")
    with _ise() as svc:
        r = client.post(
            "/api/selfregister",
            json={"registrant_name": "Alice", "agreed": True},
        )
    assert r.status_code == 200
    assert svc.create_endpoint.await_args.args[0].mac == MY_MAC
    # Offerets MAC blev aldrig slået op i ISE.
    assert svc.endpoints.get_by_mac.await_args.args[0] == MY_MAC


def test_binding_is_consumed_after_successful_registration(client):
    with _mnt(MY_MAC):
        client.get("/api/selfregister/session")
    with _ise():
        first = client.post(
            "/api/selfregister",
            json={"registrant_name": "Alice", "agreed": True},
        )
        second = client.post(
            "/api/selfregister",
            json={"registrant_name": "Alice", "agreed": True},
        )
    assert first.status_code == 200
    assert second.status_code == 409  # kræver nyt session-opslag


# ── F-01: upsert må ikke kapre et endpoint uden for gæstegruppen ─────────────

def test_upsert_rejected_for_endpoint_outside_guest_group(client):
    """En corporate-enhed må ikke kunne flyttes til gæstegruppen."""
    with _mnt(MY_MAC):
        client.get("/api/selfregister/session")
    with _ise({"id": "corp-id", "groupId": "corporate-group-id"}) as svc:
        r = client.post(
            "/api/selfregister",
            json={"registrant_name": "Mallory", "agreed": True},
        )
    assert r.status_code == 409
    svc.update_endpoint.assert_not_awaited()


def test_upsert_allowed_for_endpoint_already_in_guest_group(client):
    """Gen-registrering af en eksisterende gæst skal stadig virke."""
    with _mnt(MY_MAC):
        client.get("/api/selfregister/session")
    with _ise({"id": "guest-id", "groupId": GUEST_GROUP}) as svc:
        r = client.post(
            "/api/selfregister",
            json={"registrant_name": "Alice", "agreed": True},
        )
    assert r.status_code == 200
    svc.update_endpoint.assert_awaited_once()


# ── Default-tilstand ─────────────────────────────────────────────────────────

def test_disabled_by_default():
    """Den uautentificerede flade skal være slukket medmindre den slås til."""
    from app.core.config import Settings
    assert Settings.model_fields["selfregister_enabled"].default is False


def test_endpoints_return_503_when_disabled(client, monkeypatch):
    monkeypatch.setattr(config.settings, "selfregister_enabled", False, raising=False)
    assert client.get("/api/selfregister/session").status_code == 503
    assert client.post(
        "/api/selfregister",
        json={"registrant_name": "Alice", "agreed": True},
    ).status_code == 503


# ── Binding-storen isoleret ──────────────────────────────────────────────────

def test_binding_expires():
    selfregister_bindings.bind("1.2.3.4", MY_MAC, ttl=-1.0)
    assert selfregister_bindings.lookup("1.2.3.4") is None


def test_binding_store_is_bounded():
    """Bindinger må ikke kunne vokse ubegrænset (jf. F-08's bucket-lækage)."""
    for i in range(selfregister_bindings.MAX_BINDINGS + 50):
        selfregister_bindings.bind(f"10.0.{i // 256}.{i % 256}", MY_MAC)
    assert len(selfregister_bindings._bindings) <= selfregister_bindings.MAX_BINDINGS
