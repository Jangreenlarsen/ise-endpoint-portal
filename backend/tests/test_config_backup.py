# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Tests for config backup/restore — plain + krypteret, secrets, certs, extras.

Patcher backend-dir + store-DB'er til tmp så der ikke røres rigtige filer.
"""
from __future__ import annotations

import base64
import json

import pytest
from fastapi import HTTPException

from app.api import config_backup as cb
from app.core import backup_crypto
from app.core import config
from app.core import first_seen_store as fs
from app.core import guest_expiry_store as ge


@pytest.fixture
def backend(tmp_path, monkeypatch):
    monkeypatch.setattr(cb, "_BACKEND_DIR", tmp_path)
    (tmp_path / "config.json").write_text(
        json.dumps({
            "ise_base_url": "https://ise",
            "ise_password": "hemmelig",
            "pxgrid_password": "pxpw",
            "ise_ca_bundle": "certs/ca.pem",
        }),
        encoding="utf-8",
    )
    (tmp_path / "auth_config.json").write_text(
        json.dumps({"auth_mode": "tacacs", "tacacs_secret": "tsecret"}), encoding="utf-8"
    )
    (tmp_path / "users.json").write_text(json.dumps([{"username": "admin"}]), encoding="utf-8")
    (tmp_path / "certs").mkdir()
    (tmp_path / "certs" / "ca.pem").write_bytes(b"CERTDATA")
    (tmp_path / "auth_secret.key").write_bytes(b"SECRETKEY")

    monkeypatch.setattr(ge, "DB_PATH", tmp_path / "guest_expiry.db")
    monkeypatch.setattr(fs, "DB_PATH", tmp_path / "first_seen.db")
    ge.init_db()
    fs.init_db()
    ge.upsert("ep1", "AA:BB:CC:DD:EE:FF", "2030-01-01:12:00")
    fs.record("AA:BB:CC:DD:EE:FF", "ep1")
    return tmp_path


# ── Plain backup ──────────────────────────────────────────────────────────────

def test_plain_backup_redacts_secrets_and_adds_extras(backend):
    payload = cb.build_backup_payload(None)
    assert payload["version"] == 2 and payload["encrypted"] is False
    assert payload["files"]["config.json"]["ise_password"] == "__REDACTED__"
    assert payload["files"]["config.json"]["pxgrid_password"] == "__REDACTED__"
    assert payload["files"]["auth_config.json"]["tacacs_secret"] == "__REDACTED__"
    ids = [r["endpoint_id"] for r in payload["extras"]["guest_expiry"]]
    assert "ep1" in ids                                   # gæste-udløb er nu med
    assert payload["extras"]["first_seen"]                # first-seen er nu med
    assert "certs" not in payload["extras"]               # ingen følsomt i plain
    assert "auth_secret" not in payload["extras"]


def test_plain_restore_preserves_existing_secret(backend):
    payload = cb.build_backup_payload(None)                # ise_password == __REDACTED__
    result = cb.apply_restore(payload, None)               # eksisterende fil har rigtig secret
    assert result["ok"]
    restored = json.loads((backend / "config.json").read_text(encoding="utf-8"))
    assert restored["ise_password"] == "hemmelig"          # bevaret, ikke __REDACTED__


# ── Krypteret backup ──────────────────────────────────────────────────────────

def test_encrypted_backup_includes_secrets_certs_and_key(backend, monkeypatch):
    monkeypatch.setattr(config.settings, "ise_ca_bundle", "certs/ca.pem")
    payload = cb.build_backup_payload("pw123")
    assert payload["encrypted"] is True and "enc" in payload
    inner = backup_crypto.decrypt_obj(payload["enc"], "pw123")
    assert inner["files"]["config.json"]["ise_password"] == "hemmelig"     # IKKE redigeret
    assert inner["files"]["auth_config.json"]["tacacs_secret"] == "tsecret"
    cert = inner["extras"]["certs"]["ise_ca_bundle"]
    assert cert["path"] == "certs/ca.pem"
    assert base64.b64decode(cert["data"]) == b"CERTDATA"
    assert base64.b64decode(inner["extras"]["auth_secret"]) == b"SECRETKEY"


def test_encrypted_restore_round_trip(backend, monkeypatch):
    monkeypatch.setattr(config.settings, "ise_ca_bundle", "certs/ca.pem")
    payload = cb.build_backup_payload("pw123")

    # Simulér tab: ændr config, fjern cert, ryd gæste-udløb
    (backend / "config.json").write_text(json.dumps({"ise_password": "changed"}), encoding="utf-8")
    (backend / "certs" / "ca.pem").unlink()
    ge.import_rows([])
    assert ge.count() == 0

    result = cb.apply_restore(payload, "pw123")
    assert result["ok"] and result["encrypted"] is True

    restored = json.loads((backend / "config.json").read_text(encoding="utf-8"))
    assert restored["ise_password"] == "hemmelig"              # secret gendannet
    assert (backend / "certs" / "ca.pem").read_bytes() == b"CERTDATA"   # cert gendannet
    assert ge.count() == 1                                     # gæste-udløb gendannet


def test_encrypted_restore_wrong_passphrase_fails(backend):
    payload = cb.build_backup_payload("pw123")
    with pytest.raises(HTTPException) as exc:
        cb.apply_restore(payload, "forkert")
    assert exc.value.status_code == 400


# ── Validering + sikkerhed ────────────────────────────────────────────────────

def test_restore_rejects_bad_version(backend):
    with pytest.raises(HTTPException):
        cb.apply_restore({"version": 99, "files": {}}, None)


def test_restore_rejects_unknown_file(backend):
    with pytest.raises(HTTPException):
        cb.apply_restore({"version": 2, "encrypted": False, "files": {"evil.json": {}}}, None)


def test_cert_path_traversal_blocked(backend):
    assert cb._resolve_backend_path("../../evil.pem") is None
    assert cb._resolve_backend_path("certs/ca.pem") is not None
    extras = {"certs": {"evil": {"path": "../../evil.pem", "data": base64.b64encode(b"X").decode()}}}
    applied = cb._apply_extras(extras)
    assert not any(a.startswith("cert:") for a in applied)


def test_legacy_version1_restore_supported(backend):
    payload = {
        "version": 1,
        "credentials_redacted": True,
        "files": {"users.json": [{"username": "restored"}]},
    }
    result = cb.apply_restore(payload, None)
    assert "users.json" in result["restored"]
    assert json.loads((backend / "users.json").read_text(encoding="utf-8"))[0]["username"] == "restored"
