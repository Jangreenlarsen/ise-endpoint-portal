# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Tests for per-bruger præferencer — fokus på gruppetræets `tree_layout`.

Dækker: PUT+GET round-trip (persisteres i users.json-record), validering/
clamping af malformet input, og at andre prefs-felter ikke røres.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.me import _safe_tree_layout
from app.core import auth as auth_core
from app.main import app

ADMIN = {
    "id": "uid-prefs-admin",
    "username": "prefs_test_admin",
    "password_hash": auth_core.hash_password("AdminPass99"),
    "role": "admin",
    "user_type": "user",
    "created_at": "2026-01-01T00:00:00Z",
    "last_login": None,
    "token_gen": 0,
    "assigned_endpoint_roles": [],
    "assigned_templates": [],
    "prefs": {},
}
_TOKEN = auth_core.create_token(ADMIN["id"], ADMIN["username"], ADMIN["role"])


def _auth() -> dict:
    return {"Authorization": f"Bearer {_TOKEN}"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ── Round-trip: gem + hent tree_layout ────────────────────────────────────────

def test_tree_layout_roundtrip(client):
    """PUT tree_layout persisteres i record og returneres uændret af GET."""
    users = [dict(ADMIN, prefs={})]
    layout = {
        "groupBy": ["group_name", "profiler_name"],
        "branchDim": {"//0:Corp": "vendor"},
        "merges": {"": [["Corp", "Guest"]]},
        "hidden": {"": ["Legacy"]},
    }
    with (
        patch("app.api.me.load_users", return_value=users),
        patch("app.api.me.save_users") as save_mock,
        patch("app.api.deps.load_users", return_value=users),
    ):
        r = client.put("/api/me/prefs", json={"tree_layout": layout}, headers=_auth())
        assert r.status_code == 200
        assert r.json()["tree_layout"] == layout
        # Persisteret på record'en
        assert users[0]["prefs"]["tree_layout"] == layout
        save_mock.assert_called_once()

        g = client.get("/api/me/prefs", headers=_auth())
        assert g.status_code == 200
        assert g.json()["tree_layout"] == layout


def test_tree_layout_does_not_touch_other_prefs(client):
    """Gem af kun tree_layout rører ikke language/col_vis."""
    users = [dict(ADMIN, prefs={"language": "da", "col_vis": {"mac": True}})]
    with (
        patch("app.api.me.load_users", return_value=users),
        patch("app.api.me.save_users"),
        patch("app.api.deps.load_users", return_value=users),
    ):
        r = client.put("/api/me/prefs", json={"tree_layout": {"groupBy": ["owner"]}}, headers=_auth())
        assert r.status_code == 200
    assert users[0]["prefs"]["language"] == "da"
    assert users[0]["prefs"]["col_vis"] == {"mac": True}
    assert users[0]["prefs"]["tree_layout"]["groupBy"] == ["owner"]


def test_tree_layout_none_clears(client):
    """tree_layout=None fjerner et tidligere gemt layout."""
    users = [dict(ADMIN, prefs={"tree_layout": {"groupBy": ["owner"]}})]
    with (
        patch("app.api.me.load_users", return_value=users),
        patch("app.api.me.save_users"),
        patch("app.api.deps.load_users", return_value=users),
    ):
        r = client.put("/api/me/prefs", json={"tree_layout": None}, headers=_auth())
        assert r.status_code == 200
        assert r.json()["tree_layout"] is None
    assert "tree_layout" not in users[0]["prefs"]


# ── Validering / clamping (ren funktion) ──────────────────────────────────────

def test_safe_tree_layout_rejects_non_dict():
    assert _safe_tree_layout("nope") is None
    assert _safe_tree_layout(None) is None
    assert _safe_tree_layout([1, 2]) is None


def test_safe_tree_layout_filters_bad_types():
    out = _safe_tree_layout({
        "groupBy": ["ok", 123, "x" * 40],          # tal + for lang → droppes
        "branchDim": {"//0:A": "vendor", "bad": 5},  # ikke-str værdi → droppes
        "merges": {"//0:A": [["one"], ["a", "b"]]},  # <2 medlemmer → droppes
        "hidden": {"//0:A": ["v1", 9]},              # ikke-str → droppes
    })
    assert out["groupBy"] == ["ok"]
    assert out["branchDim"] == {"//0:A": "vendor"}
    assert out["merges"] == {"//0:A": [["a", "b"]]}
    assert out["hidden"] == {"//0:A": ["v1"]}


def test_safe_tree_layout_caps_sizes():
    big = _safe_tree_layout({
        "groupBy": [f"k{i}" for i in range(50)],
        "branchDim": {f"p{i}": "v" for i in range(500)},
    })
    assert len(big["groupBy"]) <= 20
    assert len(big["branchDim"]) <= 300
