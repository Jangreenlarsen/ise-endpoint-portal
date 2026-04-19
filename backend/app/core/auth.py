"""Authentication primitives: password hashing and signed-token handling.

Uses only stdlib. Passwords hashed with PBKDF2-HMAC-SHA256 (600k iterations).
Tokens are self-contained: base64url(payload).hex(hmac_sha256(secret, payload_b64)).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path

PBKDF2_ITERATIONS = 600_000
SALT_BYTES = 16
TOKEN_TTL_SECONDS = 24 * 60 * 60  # 24h

SECRET_FILE = Path(__file__).resolve().parents[2] / "auth_secret.key"


def _load_secret() -> bytes:
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes().strip()
    secret = secrets.token_bytes(64)
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    SECRET_FILE.write_bytes(secret)
    return secret


_SECRET: bytes | None = None


def _secret() -> bytes:
    global _SECRET
    if _SECRET is None:
        _SECRET = _load_secret()
    return _SECRET


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    try:
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return hmac.compare_digest(dk, expected)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def create_token(user_id: str, username: str, role: str, ttl: int = TOKEN_TTL_SECONDS) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": now,
        "exp": now + ttl,
    }
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_token(token: str) -> dict | None:
    """Return the payload if the token is valid and unexpired, else None."""
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload
