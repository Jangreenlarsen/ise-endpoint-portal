# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Read version info from the project-root version.json (single source of truth)."""
from __future__ import annotations

import json
from pathlib import Path

_VERSION_FILE = Path(__file__).resolve().parents[3] / "version.json"


def _read() -> dict[str, str]:
    try:
        return json.loads(_VERSION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"version": "0.0.0", "build": "0000"}


_info = _read()

VERSION: str = _info.get("version", "0.0.0")
BUILD: str = _info.get("build", "0000")
FULL: str = f"{VERSION} build {BUILD}"
