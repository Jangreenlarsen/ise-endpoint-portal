"""Endpoint-rolle-katalog (2.12.0).

Admin-kontrolleret katalog af rolle-navne der bruges som tags på
endpoints i ISE-CA'en `HypervisionRoles`. Brugere får tildelt N roller
fra dette katalog (plus deres implicit username-rolle) og ser kun
endpoints der er tagget med en af deres effektive roller.

Rolle-navne er case-sensitive men sammenlignes case-insensitive ved
opslag/duplikat-check, så navne forbliver vist som admin skrev dem.
Komma er reserveret som separator i CA-værdien — ikke tilladt i
rolle-navne.

Layout: backend/endpoint_roles.json (gitignored).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_FILE = Path(__file__).resolve().parents[2] / "endpoint_roles.json"

# Tilladte tegn i rolle-navne. Bevidst restriktivt: bogstaver, tal,
# bindestreg, underscore. Ikke mellemrum/punktum/komma — det giver
# klare CSV-værdier i CA'en uden parsing-fælder.
NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def is_valid_name(name: str) -> bool:
    return bool(NAME_RE.match(name or ""))


def load_roles() -> list[dict[str, Any]]:
    if not STORE_FILE.exists():
        return []
    try:
        data = json.loads(STORE_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    if not isinstance(data, list):
        return []
    return data


def save_roles(roles: list[dict[str, Any]]) -> None:
    STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STORE_FILE.write_text(
        json.dumps(roles, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def find_by_name(roles: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    lowered = name.lower()
    return next(
        (r for r in roles if r.get("name", "").lower() == lowered),
        None,
    )


def add_role(name: str, description: str, created_by: str) -> dict[str, Any]:
    """Tilføj en ny rolle. Rejser ValueError ved ugyldigt navn eller duplikat."""
    if not is_valid_name(name):
        raise ValueError(
            "Ugyldigt rolle-navn — kun A-Z, a-z, 0-9, '-' og '_' (max 64 tegn)"
        )
    roles = load_roles()
    if find_by_name(roles, name) is not None:
        raise ValueError(f"Rollen '{name}' findes allerede")
    role = {
        "name": name,
        "description": description or "",
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    roles.append(role)
    save_roles(roles)
    return role


def delete_role(name: str) -> dict[str, Any] | None:
    roles = load_roles()
    existing = find_by_name(roles, name)
    if not existing:
        return None
    roles = [r for r in roles if r.get("name", "").lower() != name.lower()]
    save_roles(roles)
    return existing


def role_names() -> list[str]:
    return [r["name"] for r in load_roles()]
