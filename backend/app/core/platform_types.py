"""Canonical PlatformType values for endpoints.

PlatformType is a managed custom attribute, but unlike the other free-text
attributes its value space is closed. The list lives here so both the
endpoint scan ("Sync fra ISE") and the MnT-based session sync agree on
which values are valid; anything outside the list is dropped during sync
and cleared from endpoints that hold it.
"""
from __future__ import annotations

# Closed set of accepted PlatformType values.
KNOWN_PLATFORM_TYPES: list[str] = [
    "airos",   # Cisco AireOS WLC (5520/8540/3504/...)
    "iosxe",   # Cisco IOS-XE (Catalyst 9800 WLC + moderne Catalyst-switche)
    "iossw",   # Cisco IOS classic switche (2960/3560/3750/...)
    "nxos",    # Cisco Nexus
    "meraki",  # Cisco Meraki APs/switche
]


def normalize(value: str | None) -> str | None:
    """Return canonical platform value or None if unrecognised.

    Matching is case-insensitive against the canonical list; common synonyms
    are also collapsed (catalyst9800 → iosxe, c9800 → iosxe, ios-xe → iosxe,
    ios → iossw, etc.) so MnT-derived strings and old free-text entries
    both land on a known value when possible.
    """
    if not value:
        return None
    v = value.strip().lower()
    if not v:
        return None
    if v in KNOWN_PLATFORM_TYPES:
        return v
    # Common synonyms / spellings
    synonyms = {
        "aire-os": "airos",
        "aireos": "airos",
        "wlc": "airos",          # bare WLC marker → AireOS er det vi vil have at portalen falder tilbage til (matcher CoA-Disconnect-flowet)
        "ios-xe": "iosxe",
        "ios_xe": "iosxe",
        "iosxe-sw": "iosxe",
        "catalyst9800": "iosxe",
        "c9800": "iosxe",
        "9800": "iosxe",
        "ios": "iossw",
        "ios-classic": "iossw",
        "classic-ios": "iossw",
        "nx-os": "nxos",
        "nx_os": "nxos",
        "nexus": "nxos",
    }
    return synonyms.get(v)
