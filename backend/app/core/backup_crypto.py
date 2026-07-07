# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Passphrase-baseret kryptering af backup-payloads.

Nøgleafledning: PBKDF2-HMAC-SHA256 (200k iterationer, 16-byte salt).
Kryptering: Fernet (AES-128-CBC + HMAC-SHA256) — **autentificeret** kryptering,
så en manipuleret, trunkeret eller med-forkert-passphrase-dekrypteret backup
afvises frem for at give forvansket output. Det giver både fortrolighed OG
integritet, som er formålet med en passphrase-beskyttet backup.
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_DEFAULT_ITERATIONS = 200_000
_SALT_BYTES = 16


class BackupCryptoError(Exception):
    """Rejst ved tom/forkert passphrase eller korrupt/manipuleret backup-fil."""


def _derive_key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode("utf-8")))


def encrypt_obj(obj: Any, passphrase: str) -> dict[str, Any]:
    """Krypter et JSON-serialiserbart objekt med en passphrase.

    Returnerer en dict med KDF-metadata + base64-ciphertext (Fernet-token),
    klar til at lægge i backup-JSON'en.
    """
    if not passphrase:
        raise BackupCryptoError("Passphrase må ikke være tom")
    salt = os.urandom(_SALT_BYTES)
    key = _derive_key(passphrase, salt, _DEFAULT_ITERATIONS)
    token = Fernet(key).encrypt(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
    return {
        "algo": "pbkdf2_sha256+fernet",
        "iterations": _DEFAULT_ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "ciphertext": base64.b64encode(token).decode("ascii"),
    }


def decrypt_obj(enc: dict[str, Any], passphrase: str) -> Any:
    """Dekrypter en dict produceret af :func:`encrypt_obj`.

    Rejser :class:`BackupCryptoError` ved manglende/forkert passphrase eller
    hvis indholdet er beskadiget/manipuleret (Fernet HMAC-verifikation fejler).
    """
    if not passphrase:
        raise BackupCryptoError("Passphrase mangler til dekryptering af krypteret backup")
    if not isinstance(enc, dict):
        raise BackupCryptoError("Ugyldigt krypteret backup-format")
    try:
        salt = base64.b64decode(enc["salt"])
        iterations = int(enc.get("iterations", _DEFAULT_ITERATIONS))
        token = base64.b64decode(enc["ciphertext"])
    except (KeyError, ValueError, TypeError) as exc:
        raise BackupCryptoError("Ugyldigt krypteret backup-format") from exc
    key = _derive_key(passphrase, salt, iterations)
    try:
        plaintext = Fernet(key).decrypt(token)
    except InvalidToken as exc:
        raise BackupCryptoError(
            "Forkert passphrase, eller backup-filen er beskadiget/manipuleret"
        ) from exc
    try:
        return json.loads(plaintext.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise BackupCryptoError("Dekrypteret indhold er ikke gyldig JSON") from exc
