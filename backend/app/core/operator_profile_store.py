# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

import json
import uuid
from pathlib import Path

_STORE_FILE = Path(__file__).resolve().parents[2] / "operator_profiles.json"


def _load_raw() -> list[dict]:
    if not _STORE_FILE.exists():
        return []
    try:
        return json.loads(_STORE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_raw(profiles: list[dict]) -> None:
    _STORE_FILE.write_text(
        json.dumps(profiles, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_profiles() -> list[dict]:
    return _load_raw()


def find_by_id(profiles: list[dict], profile_id: str) -> dict | None:
    return next((p for p in profiles if p["id"] == profile_id), None)


def find_by_name(profiles: list[dict], name: str) -> dict | None:
    name_lower = name.lower()
    return next((p for p in profiles if p["name"].lower() == name_lower), None)


def create_profile(
    name: str,
    display_name: str,
    default_role: str,
    assigned_endpoint_roles: list[str],
    assigned_templates: list[str],
) -> dict:
    profiles = load_profiles()
    record = {
        "id": str(uuid.uuid4()),
        "name": name,
        "display_name": display_name,
        "default_role": default_role,
        "assigned_endpoint_roles": assigned_endpoint_roles,
        "assigned_templates": assigned_templates,
    }
    profiles.append(record)
    _save_raw(profiles)
    return record


def update_profile(profile_id: str, updates: dict) -> dict | None:
    profiles = load_profiles()
    record = find_by_id(profiles, profile_id)
    if not record:
        return None
    record.update({k: v for k, v in updates.items() if v is not None})
    _save_raw(profiles)
    return record


def delete_profile(profile_id: str) -> bool:
    profiles = load_profiles()
    new = [p for p in profiles if p["id"] != profile_id]
    if len(new) == len(profiles):
        return False
    _save_raw(new)
    return True
