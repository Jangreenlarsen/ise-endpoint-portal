# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Tests for backup_crypto — passphrase-baseret autentificeret kryptering."""
from __future__ import annotations

import base64

import pytest

from app.core import backup_crypto as bc


def test_round_trip_preserves_object():
    obj = {"files": {"config.json": {"ise_password": "hemmelig", "n": 42}}, "list": [1, 2, 3]}
    enc = bc.encrypt_obj(obj, "korrekt-horse-battery")
    assert enc["algo"] == "pbkdf2_sha256+fernet"
    assert set(enc) >= {"salt", "ciphertext", "iterations"}
    assert bc.decrypt_obj(enc, "korrekt-horse-battery") == obj


def test_wrong_passphrase_rejected():
    enc = bc.encrypt_obj({"x": 1}, "rigtig")
    with pytest.raises(bc.BackupCryptoError):
        bc.decrypt_obj(enc, "forkert")


def test_tampered_ciphertext_rejected():
    enc = bc.encrypt_obj({"x": 1}, "pw")
    raw = bytearray(base64.b64decode(enc["ciphertext"]))
    raw[-1] ^= 0x01  # flip én bit → HMAC skal fejle
    enc["ciphertext"] = base64.b64encode(bytes(raw)).decode("ascii")
    with pytest.raises(bc.BackupCryptoError):
        bc.decrypt_obj(enc, "pw")


def test_empty_passphrase_rejected_both_ways():
    with pytest.raises(bc.BackupCryptoError):
        bc.encrypt_obj({"x": 1}, "")
    enc = bc.encrypt_obj({"x": 1}, "pw")
    with pytest.raises(bc.BackupCryptoError):
        bc.decrypt_obj(enc, "")


def test_unique_salt_per_encryption():
    a = bc.encrypt_obj({"x": 1}, "pw")
    b = bc.encrypt_obj({"x": 1}, "pw")
    assert a["salt"] != b["salt"]           # ny salt hver gang
    assert a["ciphertext"] != b["ciphertext"]


def test_malformed_payload_rejected():
    with pytest.raises(bc.BackupCryptoError):
        bc.decrypt_obj({"not": "valid"}, "pw")
