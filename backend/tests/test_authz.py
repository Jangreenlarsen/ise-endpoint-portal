"""Tests for authorization — require_admin og require_any.

Verificerer at roller håndhæves korrekt på endpoint-niveau:
- GET /api/users    → require_admin  (kun admin)
- GET /api/health   → åben (ingen auth krævet)
- GET /api/alerts   → require_any    (alle autentiserede)

Ingen fil-I/O — load_users mockes på de steder det bruges.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core import auth as auth_core
from app.main import app

# ── Bruger-records og tokens ──────────────────────────────────────────────────

def _record(uid: str, username: str, role: str) -> dict:
    return {
        "id": uid,
        "username": username,
        "password_hash": auth_core.hash_password("TestPass11"),
        "role": role,
        "user_type": "user",
        "created_at": "2026-01-01T00:00:00Z",
        "last_login": None,
        "assigned_endpoint_roles": [],
        "assigned_templates": [],
    }


ADMIN_REC  = _record("az-admin",  "authz_admin",  "admin")
EDITOR_REC = _record("az-editor", "authz_editor", "editor")
VIEWER_REC = _record("az-viewer", "authz_viewer", "viewer")
ALL_USERS  = [ADMIN_REC, EDITOR_REC, VIEWER_REC]

ADMIN_TOKEN  = auth_core.create_token("az-admin",  "authz_admin",  "admin")
EDITOR_TOKEN = auth_core.create_token("az-editor", "authz_editor", "editor")
VIEWER_TOKEN = auth_core.create_token("az-viewer", "authz_viewer", "viewer")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Shared client (lifespan startes kun én gang per modul) ────────────────────

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ── require_admin: GET /api/users ─────────────────────────────────────────────

def test_admin_endpoint_allows_admin(client):
    """Admin kan tilgå admin-only endpoint."""
    with patch("app.api.deps.load_users", return_value=ALL_USERS):
        r = client.get("/api/users", headers=_auth(ADMIN_TOKEN))
    assert r.status_code == 200


def test_admin_endpoint_rejects_editor(client):
    """Editor får 403 på admin-only endpoint."""
    with patch("app.api.deps.load_users", return_value=ALL_USERS):
        r = client.get("/api/users", headers=_auth(EDITOR_TOKEN))
    assert r.status_code == 403


def test_admin_endpoint_rejects_viewer(client):
    """Viewer får 403 på admin-only endpoint."""
    with patch("app.api.deps.load_users", return_value=ALL_USERS):
        r = client.get("/api/users", headers=_auth(VIEWER_TOKEN))
    assert r.status_code == 403


def test_admin_endpoint_rejects_unauthenticated(client):
    """Request uden token til admin-endpoint returnerer 401."""
    r = client.get("/api/users")
    assert r.status_code == 401


# ── require_any: GET /api/alerts ──────────────────────────────────────────────

def test_require_any_allows_admin(client):
    """Admin kan tilgå require_any-endpoint."""
    with (
        patch("app.api.deps.load_users", return_value=ALL_USERS),
        patch("app.core.alert_store.get_alerts", return_value=[]),
    ):
        r = client.get("/api/alerts", headers=_auth(ADMIN_TOKEN))
    assert r.status_code == 200


def test_require_any_allows_viewer(client):
    """Viewer kan tilgå require_any-endpoint."""
    with (
        patch("app.api.deps.load_users", return_value=ALL_USERS),
        patch("app.core.alert_store.get_alerts", return_value=[]),
    ):
        r = client.get("/api/alerts", headers=_auth(VIEWER_TOKEN))
    assert r.status_code == 200


def test_require_any_rejects_unauthenticated(client):
    """Request uden token til require_any-endpoint returnerer 401."""
    r = client.get("/api/alerts")
    assert r.status_code == 401


# ── Token-validering ──────────────────────────────────────────────────────────

def test_expired_token_returns_401(client):
    """Et manipuleret/ugyldigt token returnerer 401 på beskyttet endpoint."""
    r = client.get("/api/users", headers={"Authorization": "Bearer ugyldigttoken.xyz.abc"})
    assert r.status_code == 401


def test_missing_bearer_prefix_returns_401(client):
    """Authorization-header uden 'Bearer '-præfix returnerer 401."""
    r = client.get("/api/users", headers={"Authorization": ADMIN_TOKEN})
    assert r.status_code == 401


def test_deleted_user_token_returns_401(client):
    """Token der refererer til en bruger der ikke længere eksisterer returnerer 401."""
    with patch("app.api.deps.load_users", return_value=[]):
        r = client.get("/api/users", headers=_auth(ADMIN_TOKEN))
    assert r.status_code == 401
