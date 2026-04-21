"""Per-portal mapping from ISE-derived raw platform values to local labels.

The user maintains their own list of PlatformType labels (e.g. "Wireless-AireOS",
"Cat9k-Office") and binds each ISE-side raw value (airos, iosxe, iossw, nxos,
meraki) to one local label plus a CoA action (`reauth` or `disconnect`). When
the MnT sync writes PlatformType to an endpoint it writes the *local* label,
not the raw value; when CoA-on-save fires, the dispatcher reads the local
value's CoA action from this store.

File: backend/platform_mapping.json (gitignored).

Format:
    {
      "mappings": [
        {"raw": "airos",  "local": "Wireless-AireOS", "coa": "disconnect"},
        {"raw": "iosxe",  "local": "Cat9k-WLC",       "coa": "reauth"},
        ...
      ]
    }
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.platform_types import KNOWN_PLATFORM_TYPES

STORE_FILE = Path(__file__).resolve().parents[2] / "platform_mapping.json"

VALID_COA = ("reauth", "disconnect")
DEFAULT_COA = "reauth"


def _empty() -> dict[str, list[dict[str, str]]]:
    return {"mappings": []}


def load_mapping() -> list[dict[str, str]]:
    """Return the current mapping list (may be empty)."""
    if not STORE_FILE.exists():
        return []
    try:
        data: dict[str, Any] = json.loads(STORE_FILE.read_text(encoding="utf-8"))
        rows = data.get("mappings", [])
        if not isinstance(rows, list):
            return []
        clean: list[dict[str, str]] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            raw = str(r.get("raw", "")).strip().lower()
            local = str(r.get("local", "")).strip()
            coa = str(r.get("coa", DEFAULT_COA)).strip().lower()
            if not raw or raw not in KNOWN_PLATFORM_TYPES:
                continue
            if coa not in VALID_COA:
                coa = DEFAULT_COA
            clean.append({"raw": raw, "local": local, "coa": coa})
        return clean
    except Exception:
        return []


def save_mapping(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Validate and persist the mapping list. Returns the saved list."""
    clean: list[dict[str, str]] = []
    seen_raw: set[str] = set()
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        raw = str(r.get("raw", "")).strip().lower()
        local = str(r.get("local", "")).strip()
        coa = str(r.get("coa", DEFAULT_COA)).strip().lower()
        if not raw or raw not in KNOWN_PLATFORM_TYPES:
            continue
        if raw in seen_raw:
            # Enforce 1-to-1: first row wins.
            continue
        seen_raw.add(raw)
        if coa not in VALID_COA:
            coa = DEFAULT_COA
        clean.append({"raw": raw, "local": local, "coa": coa})
    STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STORE_FILE.write_text(
        json.dumps({"mappings": clean}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return clean


def raw_to_local() -> dict[str, str]:
    """Return ``{raw: local}`` skipping rows where local is empty (= unmapped)."""
    return {r["raw"]: r["local"] for r in load_mapping() if r.get("local")}


def local_to_coa() -> dict[str, str]:
    """Return ``{local: coa}`` for non-empty local labels.

    When several raws point at the same local (allowed at the data layer),
    the *last* row wins — but the API enforces 1-to-1 on raw, so collisions
    here mean the user has deliberately bound multiple raws to one label.
    """
    out: dict[str, str] = {}
    for r in load_mapping():
        local = r.get("local", "")
        if local:
            out[local] = r.get("coa", DEFAULT_COA)
    return out
