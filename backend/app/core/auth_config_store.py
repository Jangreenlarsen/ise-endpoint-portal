# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistent store for Portal Auth Config (auth mode + TACACS+ settings).

Stored in backend/auth_config.json — kept separate from config.json
because it contains a TACACS+ shared secret.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_FILE = Path(__file__).resolve().parents[2] / "auth_config.json"

_DEFAULTS: dict[str, Any] = {
    "auth_mode": "local",
    "tacacs_server_host": "",
    "tacacs_server_port": 49,
    "tacacs_secret": "",
    "tacacs_timeout_seconds": 5,
    "tacacs_fallback_to_local": True,
    "tacacs_operator_profile_attribute": "portal-operator-profile",
}


def load() -> dict[str, Any]:
    if not _FILE.exists():
        return dict(_DEFAULTS)
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        merged = dict(_DEFAULTS)
        merged.update(data)
        return merged
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULTS)


def save(data: dict[str, Any]) -> None:
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    _FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if os.name != "nt":
        try:
            _FILE.chmod(0o600)
        except OSError:
            pass
