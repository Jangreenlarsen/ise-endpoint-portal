"""Tests for authentication endpoints.

Dækker: setup, login (succes + forkert password + ukendt bruger),
token refresh, /me med og uden token.
Ingen fil-I/O — load_users/save_users mockes på de steder de bruges.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core import auth as auth_core
from app.main import app

# ── Test-brugere ──────────────────────────────────────────────────────────────

def _make_record(uid: str, username: str, role: str, password: str) -> dict:
    return {
        "id": uid,
        "username": username,
        "password_hash": auth_core.hash_password(password),
        "role": role,
        "user_type": "user",
        "created_at": "2026-01-01T00:00:00Z",
        "last_login": None,
        "assigned_endpoint_roles": [],
        "assigned_templates": [],
    }


ADMIN = _make_record("uid-admin", "auth_test_admin", "admin", "AdminPass99")

_admin_token = auth_core.create_token(ADMIN["id"], ADMIN["username"], ADMIN["role"])


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Shared client (lifespan startes kun én gang per modul) ────────────────────

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ── Hjælper: patch load_users alle steder det bruges ─────────────────────────

@contextmanager
def _patch_users(user_list):
    """Patcher load_users på alle import-sites der bruges i disse tests."""
    with (
        patch("app.api.deps.load_users", return_value=user_list),
        patch("app.services.user_service.load_users", return_value=user_list),
    ):
        yield


# ── /api/auth/setup ───────────────────────────────────────────────────────────

def test_setup_creates_first_admin(client):
    """Setup returnerer token og admin-bruger når ingen brugere eksisterer."""
    with (
        patch("app.services.user_service.load_users", return_value=[]),
        patch("app.services.user_service.save_users"),
        patch("app.services.user_service.setup_required", return_value=True),
    ):
        r = client.post("/api/auth/setup", json={
            "username": "first_admin",
            "password": "SetupPass11",
        })
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert data["user"]["username"] == "first_admin"
    assert data["user"]["role"] == "admin"


def test_setup_rejected_when_already_configured(client):
    """Setup returnerer 400 hvis systemet allerede er konfigureret."""
    with patch("app.services.user_service.setup_required", return_value=False):
        r = client.post("/api/auth/setup", json={
            "username": "hacker",
            "password": "HackerPass11",
        })
    assert r.status_code == 400


# ── /api/auth/login ───────────────────────────────────────────────────────────

def test_login_success(client):
    """Login med korrekte credentials returnerer token og bruger-objekt."""
    with (
        patch("app.services.user_service.load_users", return_value=[ADMIN]),
        patch("app.services.user_service.save_users"),
    ):
        r = client.post("/api/auth/login", json={
            "username": "auth_test_admin",
            "password": "AdminPass99",
        })
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert data["user"]["username"] == "auth_test_admin"
    assert data["user"]["role"] == "admin"


def test_login_wrong_password(client):
    """Login med forkert password returnerer 401."""
    with (
        patch("app.services.user_service.load_users", return_value=[ADMIN]),
        patch("app.services.user_service.save_users"),
    ):
        r = client.post("/api/auth/login", json={
            "username": "auth_test_admin",
            "password": "ForkertKode99",
        })
    assert r.status_code == 401


def test_login_unknown_user(client):
    """Login med ukendt brugernavn returnerer 401."""
    with patch("app.services.user_service.load_users", return_value=[ADMIN]):
        r = client.post("/api/auth/login", json={
            "username": "findes_ikke",
            "password": "AdminPass99",
        })
    assert r.status_code == 401


def test_login_returns_valid_jwt(client):
    """Token fra login kan verificeres og indeholder korrekt payload."""
    with (
        patch("app.services.user_service.load_users", return_value=[ADMIN]),
        patch("app.services.user_service.save_users"),
    ):
        r = client.post("/api/auth/login", json={
            "username": "auth_test_admin",
            "password": "AdminPass99",
        })
    token = r.json()["token"]
    payload = auth_core.verify_token(token)
    assert payload is not None
    assert payload["username"] == "auth_test_admin"
    assert payload["role"] == "admin"


# ── /api/auth/me ──────────────────────────────────────────────────────────────

def test_me_returns_current_user(client):
    """GET /me med gyldigt token returnerer brugerinfo."""
    with _patch_users([ADMIN]):
        r = client.get("/api/auth/me", headers=_auth(_admin_token))
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "auth_test_admin"
    assert data["role"] == "admin"


def test_me_without_token_returns_401(client):
    """GET /me uden Authorization-header returnerer 401."""
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_me_with_garbage_token_returns_401(client):
    """GET /me med ugyldigt token returnerer 401."""
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer ikkeettoken"})
    assert r.status_code == 401


# ── /api/auth/refresh ─────────────────────────────────────────────────────────

def test_refresh_returns_new_token(client):
    """POST /refresh returnerer nyt token der er forskelligt fra det gamle."""
    with patch("app.api.deps.load_users", return_value=[ADMIN]):
        r = client.post("/api/auth/refresh", headers=_auth(_admin_token))
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert data["token"] != _admin_token
    assert data["user"]["username"] == "auth_test_admin"


def test_refresh_without_token_returns_401(client):
    """POST /refresh uden token returnerer 401."""
    r = client.post("/api/auth/refresh")
    assert r.status_code == 401


# ── /api/auth/status ──────────────────────────────────────────────────────────

def test_status_unauthenticated_returns_not_authenticated(client):
    """GET /status uden token returnerer authenticated=False."""
    with patch("app.services.user_service.setup_required", return_value=False):
        r = client.get("/api/auth/status")
    assert r.status_code == 200
    data = r.json()
    assert data["authenticated"] is False


def test_status_with_valid_token_returns_authenticated(client):
    """GET /status med gyldigt token returnerer authenticated=True."""
    with (
        patch("app.services.user_service.setup_required", return_value=False),
        patch("app.services.user_service.load_users", return_value=[ADMIN]),
    ):
        r = client.get("/api/auth/status", headers=_auth(_admin_token))
    assert r.status_code == 200
    data = r.json()
    assert data["authenticated"] is True
    assert data["user"]["username"] == "auth_test_admin"
