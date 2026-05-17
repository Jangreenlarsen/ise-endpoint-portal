# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistent override store for user-editable settings.

Values saved here take precedence over .env defaults.
File lives outside git (see .gitignore).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

CONFIG_FILE = Path(__file__).resolve().parents[2] / "config.json"


def load_overrides() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_overrides(data: dict[str, Any]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    if os.name != "nt":
        try:
            CONFIG_FILE.chmod(0o600)
        except OSError:
            pass
