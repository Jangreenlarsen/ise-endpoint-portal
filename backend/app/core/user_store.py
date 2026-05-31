# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistent store for local user accounts.

Layout: backend/users.json (gitignored) — list of user records.
Thread/async-safe only under the current single-process assumption.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

USERS_FILE = Path(__file__).resolve().parents[2] / "users.json"


def load_users() -> list[dict[str, Any]]:
    if not USERS_FILE.exists():
        return []
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    if not isinstance(data, list):
        return []
    return data


def save_users(users: list[dict[str, Any]]) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def find_by_id(users: list[dict[str, Any]], user_id: str) -> dict[str, Any] | None:
    return next((u for u in users if u.get("id") == user_id), None)


def find_by_username(users: list[dict[str, Any]], username: str) -> dict[str, Any] | None:
    lowered = username.lower()
    return next((u for u in users if u.get("username", "").lower() == lowered), None)


def increment_token_gen(users: list[dict[str, Any]], user_id: str) -> None:
    """Increment token_gen in-place — invaliderer alle eksisterende tokens for brugeren."""
    for u in users:
        if u.get("id") == user_id:
            u["token_gen"] = u.get("token_gen", 0) + 1
            break
