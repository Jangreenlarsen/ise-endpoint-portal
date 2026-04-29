"""Local registry of allowed values for custom endpoint attributes.

ISE custom attributes are free-text; ISE does NOT enforce allowed values.
This store maintains the dropdown options shown in the portal UI.
File: backend/custom_attr_values.json (gitignored).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

STORE_FILE = Path(__file__).resolve().parents[2] / "custom_attr_values.json"

# Custom attributes this portal manages (user-editable).
MANAGED_ATTRS = ["Type", "Owner", "Lokation", "AuthzVlan", "AuthzACL", "PlatformType"]

# Portal-tag — set automatically to "true" på alle portal-redigerede endpoints.
HIDDEN_ATTR = "HypervisionISEPortal"

# Endpoint-rolle-tag (2.12.0) — comma-separated liste af rolle-navne fra
# rolle-kataloget + brugerens implicit username-rolle. Synlighed for
# non-admin filtreres på denne attribut. Sat dynamisk af RBAC-logikken,
# ikke et fast "true" som HIDDEN_ATTR.
ROLES_ATTR = "HypervisionRoles"

# Purge-protection bruges i 3.7.1 ikke længere via DeviceRegistrationStatus.
# ISE 3.4 understøtter ikke custom-attributes som purge-condition, og fra
# ISE 3.5+ findes "CUSTOMATTRIBUTE" som condition-type — admin kan bare lave
# en "Never Purge" rule med ``CUSTOMATTRIBUTE HypervisionISEPortal EQUALS true``
# direkte i ISE GUI'en. Det dækker 100% af portal-stemplede endpoints uden
# at vi skal sætte en ekstra CA. Settings UI har en vejledning med præcis
# rule-config.

# Alle skjulte (ikke-UI-dropdown) CAs der skal have ISE-definition.
HIDDEN_ATTRS = [HIDDEN_ATTR, ROLES_ATTR]

# All attributes that need ISE definitions (managed + hidden).
ALL_ATTRS = MANAGED_ATTRS + HIDDEN_ATTRS


def _default() -> dict[str, list[str]]:
    return {attr: [] for attr in MANAGED_ATTRS}


def load_values() -> dict[str, list[str]]:
    if not STORE_FILE.exists():
        return _default()
    try:
        data: dict[str, Any] = json.loads(STORE_FILE.read_text(encoding="utf-8"))
        result = _default()
        for attr in MANAGED_ATTRS:
            result[attr] = sorted(set(data.get(attr, [])))
        return result
    except Exception:
        return _default()


def save_values(data: dict[str, list[str]]) -> None:
    STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    clean = {attr: sorted(set(data.get(attr, []))) for attr in MANAGED_ATTRS}
    STORE_FILE.write_text(json.dumps(clean, indent=2, ensure_ascii=False), encoding="utf-8")


def add_value(attr_name: str, value: str) -> dict[str, list[str]]:
    data = load_values()
    if attr_name in data and value not in data[attr_name]:
        data[attr_name].append(value)
        data[attr_name] = sorted(set(data[attr_name]))
        save_values(data)
    return data


def remove_value(attr_name: str, value: str) -> dict[str, list[str]]:
    data = load_values()
    if attr_name in data and value in data[attr_name]:
        data[attr_name].remove(value)
        save_values(data)
    return data


def merge_values(discovered: dict[str, list[str]]) -> dict[str, list[str]]:
    """Merge discovered values (from ISE scan) into the local store."""
    data = load_values()
    for attr in MANAGED_ATTRS:
        existing = set(data.get(attr, []))
        incoming = set(discovered.get(attr, []))
        data[attr] = sorted(existing | incoming)
    save_values(data)
    return data
