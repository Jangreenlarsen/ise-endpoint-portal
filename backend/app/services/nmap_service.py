# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""nmap-scanning service — kører nmap som subprocess mod en given IP."""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import shutil
import time

logger = logging.getLogger(__name__)

SCAN_TIMEOUT = 120  # sekunder
MAX_FLAG_TOKENS = 12

PRESETS: dict[str, list[str]] = {
    "ping":    ["-sn", "-T4"],
    "top1000": ["-T4", "--top-ports", "1000"],
    "service": ["-sV", "-T4"],
    # "os" fjernet — kræver root-rettigheder (-O), portal kører som uprivilegeret bruger
}

# ── Flag-allowlist (BUGS.md F-03) ────────────────────────────────────────────
#
# Tidligere var dette en DENYLIST med otte navne. Den kan ikke gøres komplet:
# den manglede bl.a. -oS og --append-output (vilkårlig filskrivning som
# portal-brugeren), --datadir/--servicedb/--versiondb (indlæsning af data fra en
# sti angriberen vælger), --stylesheet og -iR. Kun en allowlist er forsvarlig —
# et ukendt flag er per definition ikke godkendt.
#
# Udvalget er begrænset til scan-styring der IKKE kræver root (portalen kører
# uprivilegeret) og som hverken læser eller skriver filer.

_FLAGS_NO_VALUE = frozenset({
    # Scan-typer uden root-krav
    "-sn", "-sT", "-sV",
    # Host discovery / opløsning
    "-Pn", "-n", "-R", "-6",
    # Port-udvalg og output-detaljer
    "-F", "-r", "--open", "--reason",
    # Verbositet
    "-v", "-vv", "-d",
    # Timing-skabeloner
    "-T0", "-T1", "-T2", "-T3", "-T4", "-T5",
})

# Flag der tager en værdi — enten "--flag=v" eller "--flag v".
_FLAGS_WITH_VALUE = frozenset({
    "-p", "--top-ports", "--port-ratio",
    "--max-retries", "--host-timeout",
    "--min-rate", "--max-rate",
    "--max-rtt-timeout", "--version-intensity",
})

# Flag hvor værdien kan hænge direkte på, fx "-p80,443" eller "-p1-1024".
_ATTACHED_VALUE_FLAGS = ("-p",)

# Værdier må kun indeholde tal, bogstaver og adskillere. Udelukker bl.a.
# stier (/ og \), så et flag aldrig kan pege på en fil.
_VALUE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9,.:*_-]*$")


class NmapError(Exception):
    pass


def _validate_ip(ip: str) -> str:
    """Kast ValueError hvis ip ikke er en gyldig unicast-adresse."""
    addr = ipaddress.ip_address(ip.strip())
    if addr.is_loopback or addr.is_unspecified or addr.is_multicast:
        raise ValueError(f"Ugyldig scan-target: {ip}")
    return str(addr)


def _check_value(flag: str, value: str) -> None:
    if not _VALUE_RE.match(value):
        raise ValueError(f"Ugyldig værdi til {flag}: {value!r}")


def _validate_flags(flags: str) -> list[str]:
    """Split og valider brugerdefinerede flag mod allowlisten.

    Alt der ikke står i `_FLAGS_NO_VALUE` eller `_FLAGS_WITH_VALUE` afvises.
    Understøtter `--flag=værdi`, `--flag værdi` og sammenhængende `-p80,443`.
    """
    parts = flags.split()
    if len(parts) > MAX_FLAG_TOKENS:
        raise ValueError(f"For mange flag (max {MAX_FLAG_TOKENS})")

    out: list[str] = []
    i = 0
    while i < len(parts):
        tok = parts[i]

        if tok in _FLAGS_NO_VALUE:
            out.append(tok)
            i += 1
            continue

        if "=" in tok:
            name, value = tok.split("=", 1)
            if name not in _FLAGS_WITH_VALUE:
                raise ValueError(f"Flag ikke tilladt: {name}")
            _check_value(name, value)
            out.append(tok)
            i += 1
            continue

        if tok in _FLAGS_WITH_VALUE:
            if i + 1 >= len(parts):
                raise ValueError(f"{tok} mangler en værdi")
            value = parts[i + 1]
            _check_value(tok, value)
            out.extend([tok, value])
            i += 2
            continue

        # Sammenhængende værdi, fx -p80,443
        attached = next(
            (f for f in _ATTACHED_VALUE_FLAGS if tok.startswith(f) and len(tok) > len(f)),
            None,
        )
        if attached:
            _check_value(attached, tok[len(attached):])
            out.append(tok)
            i += 1
            continue

        raise ValueError(f"Flag ikke tilladt: {tok}")

    return out


async def run_scan(ip: str, preset: str | None, custom_flags: str | None) -> dict:
    """Kør nmap og returnér output, returnkode og varighed."""
    if not shutil.which("nmap"):
        raise NmapError("nmap er ikke installeret på serveren")

    target = _validate_ip(ip)

    if preset:
        # Et ukendt preset faldt tidligere TAVST tilbage til default — så et
        # kald med det fjernede "os"-preset (stadig annonceret i API-skemaet)
        # kørte en helt anden scanning end kalderen bad om.
        if preset not in PRESETS:
            raise ValueError(
                f"Ukendt preset: {preset!r}. Gyldige: {', '.join(sorted(PRESETS))}"
            )
        extra = PRESETS[preset]
    elif custom_flags:
        extra = _validate_flags(custom_flags)
    else:
        extra = PRESETS["service"]  # default

    cmd = ["nmap"] + extra + [target]
    logger.info("nmap scan: %s", " ".join(cmd))
    t0 = time.monotonic()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=SCAN_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise NmapError(f"nmap timeout efter {SCAN_TIMEOUT}s")
    except FileNotFoundError:
        raise NmapError("nmap er ikke installeret på serveren")

    duration = round(time.monotonic() - t0, 1)
    output = stdout.decode("utf-8", errors="replace")
    logger.info("nmap scan mod %s: returnkode=%s varighed=%.1fs", target, proc.returncode, duration)

    return {
        "ip": target,
        "cmd": " ".join(cmd),
        "output": output,
        "returncode": proc.returncode,
        "duration": duration,
    }
