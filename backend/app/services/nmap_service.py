# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""nmap-scanning service — kører nmap som subprocess mod en given IP."""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import shutil
import time

logger = logging.getLogger(__name__)

SCAN_TIMEOUT = 120  # sekunder
SAFE_FLAG_DENYLIST = {"-iL", "--script", "--script=", "-oG", "-oN", "-oX", "-oA", "--resume"}

PRESETS: dict[str, list[str]] = {
    "ping":    ["-sn", "-T4"],
    "top1000": ["-T4", "--top-ports", "1000"],
    "service": ["-sV", "-T4"],
    # "os" fjernet — kræver root-rettigheder (-O), portal kører som uprivilegeret bruger
}


class NmapError(Exception):
    pass


def _validate_ip(ip: str) -> str:
    """Kast ValueError hvis ip ikke er en gyldig unicast-adresse."""
    addr = ipaddress.ip_address(ip.strip())
    if addr.is_loopback or addr.is_unspecified or addr.is_multicast:
        raise ValueError(f"Ugyldig scan-target: {ip}")
    return str(addr)


def _validate_flags(flags: str) -> list[str]:
    """Split og valider brugerdefinerede flag — afvis farlige optioner."""
    parts = flags.split()
    for p in parts:
        base = p.split("=")[0]
        if base in SAFE_FLAG_DENYLIST:
            raise ValueError(f"Flag ikke tilladt: {p}")
    return parts


async def run_scan(ip: str, preset: str | None, custom_flags: str | None) -> dict:
    """Kør nmap og returnér output, returnkode og varighed."""
    if not shutil.which("nmap"):
        raise NmapError("nmap er ikke installeret på serveren")

    target = _validate_ip(ip)

    if preset and preset in PRESETS:
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
