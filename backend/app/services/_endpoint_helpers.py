# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Pure helper functions for endpoint_service.py.

Udtrukket fra endpoint_service.py (P2-refaktor) for at holde service-klassen
under 800 linjer. Ingen side-effekter — alle funktioner er ren transformation.
"""
from __future__ import annotations

import re
from typing import Any

from app.core import config
from app.core.custom_attr_store import (
    PSK_KEY_ATTR,
    PSK_MODE_ATTR,
    ROLES_ATTR,
)
from app.schemas.endpoint import EndpointDetail

PSK_MASKED = "****"
PSK_IPSK_PREFIX = "psk="


# ── PSK helpers ──────────────────────────────────────────────────────────────

def _psk_encode(key: str) -> str:
    """Tilføj 'psk='-prefix til nøglen hvis IPSK mode er aktiv i settings."""
    if not key:
        return key
    if str(getattr(config.settings, "psk_type", "MPSK")).upper() != "IPSK":
        return key
    if key.startswith(PSK_IPSK_PREFIX):
        return key
    return PSK_IPSK_PREFIX + key


def _psk_decode(raw: str) -> str:
    """Strip 'psk='-prefix så UI aldrig ser det (transparent uanset mode)."""
    if raw and raw.startswith(PSK_IPSK_PREFIX):
        return raw[len(PSK_IPSK_PREFIX):]
    return raw


def _psk_encode_ca(ca: dict[str, Any]) -> None:
    """In-place: tilføj 'psk='-prefix på PSK_Key i ca-dict hvis IPSK mode aktiv."""
    key = str(ca.get(PSK_KEY_ATTR, "") or "")
    if key:
        ca[PSK_KEY_ATTR] = _psk_encode(key)


def _validate_psk(ca: dict[str, Any]) -> None:
    """Validate PSK fields before write. Raises ValueError on violation."""
    key = str(ca.get(PSK_KEY_ATTR, "") or "")
    if key == PSK_MASKED:
        raise ValueError(
            "PSK Key indeholder den maskerede sentinel-værdi '****' — "
            "send den faktiske nøgle eller lad feltet være tomt"
        )
    mode = str(ca.get(PSK_MODE_ATTR, "") or "").lower()
    if mode == "true" and key:
        from app.services.settings_service import get_psk_policy, validate_psk_key
        policy = get_psk_policy()
        errors = validate_psk_key(key, policy)
        if errors:
            raise ValueError(f"PSK Key overholder ikke politik: {'; '.join(errors)}")


def _mask_psk(detail: EndpointDetail) -> EndpointDetail:
    if detail.psk_key and detail.psk_key != PSK_MASKED:
        return detail.model_copy(update={"psk_key": PSK_MASKED})
    return detail


# ── Custom attributes ────────────────────────────────────────────────────────

def _extract_custom_attrs(endpoint: dict[str, Any]) -> dict[str, str]:
    """Extract custom attributes from an ERSEndPoint response."""
    ca = endpoint.get("customAttributes", {})
    if isinstance(ca, dict):
        inner = ca.get("customAttributes", ca)
        if isinstance(inner, dict):
            return {k: str(v) for k, v in inner.items()}
    return {}


def _apply_auto_tag(ca: dict[str, Any], auto_tag_username: str | None) -> None:
    """Auto-tag HypervisionRoles med username for non-admin oprettelser/opdateringer.

    Eksplicit valgte roller respekteres. Admin (auto_tag_username=None) er ikke berørt.
    """
    if not auto_tag_username:
        return
    current = str(ca.get(ROLES_ATTR, "") or "").strip()
    if current:
        return
    ca[ROLES_ATTR] = auto_tag_username


# ── Role helpers ─────────────────────────────────────────────────────────────

def _parse_roles_csv(csv: str) -> list[str]:
    """Parse comma-separated rolle-CSV til liste af strippede navne (tomme frasorteres)."""
    if not csv:
        return []
    return [r.strip() for r in str(csv).split(",") if r.strip()]


def _endpoint_visible(detail: EndpointDetail, effective_roles: list[str]) -> bool:
    """Returnér True hvis endpointets roller overlapper brugerens (case-insensitiv).

    Endpoint uden roller er usynligt for non-admin (least-privilege default).
    """
    if not effective_roles:
        return False
    user_set = {r.lower() for r in effective_roles if r}
    for role in detail.roles:
        if role and role.lower() in user_set:
            return True
    return False


# ── Filter helpers ───────────────────────────────────────────────────────────

def _full_text_filter(items: list[EndpointDetail], q: str) -> list[EndpointDetail]:
    """Fritekst-søgning på tværs af alle endpoint-felter (case-insensitiv)."""
    low = q.strip().lower()
    if not low:
        return items

    def _match(d: EndpointDetail) -> bool:
        return any(
            low in (v or "").lower()
            for v in [
                d.mac, d.name, d.description, d.group_name, d.profiler_name,
                d.vendor, d.owner, d.lokation, d.endpoint_type, d.platform_type,
            ]
        )

    return [d for d in items if _match(d)]


def _build_search_filters(search: str | None) -> list[str] | None:
    """Convert free-text search til ERS filter-udtryk (mac.CONTAINS.<value>)."""
    if not search or not search.strip():
        return None
    return [f"mac.CONTAINS.{search.strip()}"]


def _combine_filters(
    search: str | None, explicit: list[str] | None
) -> list[str] | None:
    """Merge explicit ERS filter-udtryk med fritekst-søgning (AND-et af ISE ERS)."""
    filters: list[str] = []
    if explicit:
        filters.extend(f for f in explicit if f and f.strip())
    search_filters = _build_search_filters(search)
    if search_filters:
        filters.extend(search_filters)
    return filters or None
