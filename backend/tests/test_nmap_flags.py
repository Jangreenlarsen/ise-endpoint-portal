"""Regressionstests for nmap-flag-validering og rollekrav (BUGS.md F-03).

Filteret var tidligere en denylist på otte navne. Den kan ikke gøres komplet:
den slap bl.a. -oS, --append-output, --datadir, --servicedb, --versiondb,
--stylesheet og -iR igennem — flag der giver filskrivning eller får nmap til at
læse data fra en sti angriberen vælger. Testene her holder på at valideringen
er en ALLOWLIST, og at de konkrete huller er lukket.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

import pytest

from app.services.nmap_service import (
    MAX_FLAG_TOKENS,
    PRESETS,
    _validate_flags,
)

# Flag den gamle denylist ikke fangede — hver enkelt er et reelt hul.
DENYLIST_ESCAPES = [
    "-oS out.txt",          # scriptkiddie-output → vilkårlig filskrivning
    "--append-output",      # samme, men tilføjer til eksisterende fil
    "--datadir /tmp/evil",  # nmap loader NSE/data fra angriberens sti
    "--servicedb /tmp/x",
    "--versiondb /tmp/x",
    "--stylesheet /tmp/x",
    "-iR 1000",             # scanner tilfældige internet-adresser
    "--script-args-file /tmp/x",
    "--script-updatedb",
]

# Flag den gamle denylist DID fange — skal stadig afvises.
DENYLIST_ORIGINALS = [
    "-iL /etc/passwd", "--script http-vuln", "-oG g.txt",
    "-oN n.txt", "-oX x.txt", "-oA all", "--resume prev.txt",
]


@pytest.mark.parametrize("flags", DENYLIST_ESCAPES)
def test_rejects_flags_the_old_denylist_missed(flags):
    with pytest.raises(ValueError):
        _validate_flags(flags)


@pytest.mark.parametrize("flags", DENYLIST_ORIGINALS)
def test_still_rejects_original_denylist(flags):
    with pytest.raises(ValueError):
        _validate_flags(flags)


def test_unknown_flag_is_rejected_by_default():
    """Allowlist-egenskaben: et flag vi aldrig har hørt om afvises."""
    with pytest.raises(ValueError, match="ikke tilladt"):
        _validate_flags("--some-future-nmap-flag")


@pytest.mark.parametrize("flags,expected", [
    ("-sV -T4",            ["-sV", "-T4"]),
    ("-Pn -n --open",      ["-Pn", "-n", "--open"]),
    ("-p 80,443",          ["-p", "80,443"]),
    ("-p80,443",           ["-p80,443"]),
    ("-p1-1024",           ["-p1-1024"]),
    ("--top-ports 100",    ["--top-ports", "100"]),
    ("--top-ports=100",    ["--top-ports=100"]),
    ("-sT -F --reason",    ["-sT", "-F", "--reason"]),
    ("--max-retries 2",    ["--max-retries", "2"]),
])
def test_allows_safe_flags(flags, expected):
    assert _validate_flags(flags) == expected


@pytest.mark.parametrize("flags", [
    "-p /etc/passwd",       # sti som værdi
    "-p ../../etc",
    "--top-ports /tmp/x",
    "-p",                   # værdi mangler helt
    "--top-ports",
])
def test_rejects_bad_values(flags):
    with pytest.raises(ValueError):
        _validate_flags(flags)


def test_rejects_too_many_tokens():
    with pytest.raises(ValueError, match="For mange flag"):
        _validate_flags(" ".join(["-v"] * (MAX_FLAG_TOKENS + 1)))


def test_empty_flags_yield_nothing():
    assert _validate_flags("   ") == []


# ── Preset-håndtering ────────────────────────────────────────────────────────

def test_unknown_preset_raises_instead_of_silent_fallback():
    """'os' er fjernet fra PRESETS men blev annonceret i API-skemaet.

    Tidligere faldt et ukendt preset TAVST tilbage til default, så kalderen fik
    en helt anden scanning end den bad om.
    """
    import asyncio
    from unittest.mock import patch

    from app.services import nmap_service

    # nmap behøver ikke være installeret for at teste argument-valideringen.
    with patch("app.services.nmap_service.shutil.which", return_value="/usr/bin/nmap"):
        with pytest.raises(ValueError, match="Ukendt preset"):
            asyncio.run(nmap_service.run_scan("192.0.2.10", "os", None))


def test_os_preset_is_not_advertised():
    assert "os" not in PRESETS
    from app.api.nmap import NmapScanRequest
    desc = NmapScanRequest.model_fields["preset"].description or ""
    assert "os" not in desc.split("|")[-1]


# ── Rollekrav ────────────────────────────────────────────────────────────────

def test_scan_route_requires_edit_role():
    """Scanning er en aktiv netværkshandling — ikke for viewer/registrant."""
    from app.api.deps import require_edit_endpoint, require_register_lookup
    from app.main import app

    route = next(r for r in app.routes if getattr(r, "path", "") == "/api/nmap/scan")
    # Dependency'en sidder som default-værdi på 'user'-parameteren.
    deps = [d.call for d in route.dependant.dependencies if d.call]
    assert require_register_lookup not in deps, "viewer/registrant må ikke kunne scanne"
    assert require_edit_endpoint in deps
