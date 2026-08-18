# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Kortlivede IP→MAC-bindinger for den offentlige selvregistrering.

**Hvorfor:** `POST /api/selfregister` er uautentificeret. Tog den MAC-adressen
fra request-body, kunne enhver registrere — eller overskrive — et vilkårligt
endpoint i ISE (BUGS.md F-01). Den eneste ting portalen reelt kan verificere om
en anonym klient er, hvilken IP requesten kommer fra.

**Flowet:** `GET /selfregister/session` slår klientens FAKTISKE afsender-IP op i
ISE MnT og får MAC'en for den aktive RADIUS-session. Det opslag registrerer en
binding her. `POST /selfregister` slår derefter MAC'en op ud fra sin egen
afsender-IP — request-body kan ikke ændre hvilket endpoint der røres.

**Bevidst in-memory:** bindingerne er kortlivede og må ikke overleve en
genstart. Går de tabt, poller registreringssiden blot MnT igen. At persistere
dem ville give en angriber en varig binding at sigte efter uden gevinst.

**Afhængighed:** binder på afsender-IP, så `_client_ip()` i API-laget SKAL
opløse den rigtige klient-IP. Bag nginx kræver det at loopback står i
`trusted_proxy_ips` (default siden 7.3.0758) — ellers ville alle klienter dele
én binding. Se BUGS.md F-07.
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

# Levetid for en binding. Skal dække tiden fra MnT-opslaget lykkes til brugeren
# har udfyldt navn og accepteret vilkårene — men ikke være så lang at en
# genbrugt DHCP-lease kan arve en fremmed binding.
DEFAULT_TTL_SECONDS = 600.0

# Hårdt loft så en angriber ikke kan vokse dict'en ubegrænset ved at ramme
# session-opslaget fra mange kilde-IP'er (samme fejl som rate limiterens
# bucket-lækage, BUGS.md F-08 — den gentager vi ikke her).
MAX_BINDINGS = 10_000

# client_ip → (mac, expires_at)
_bindings: dict[str, tuple[str, float]] = {}


def _purge_expired(now: float) -> None:
    expired = [ip for ip, (_, exp) in _bindings.items() if exp <= now]
    for ip in expired:
        del _bindings[ip]


def bind(client_ip: str, mac: str, ttl: float = DEFAULT_TTL_SECONDS) -> None:
    """Registrér at `client_ip` p.t. har en aktiv RADIUS-session på `mac`."""
    if not client_ip or not mac:
        return
    now = time.time()
    _purge_expired(now)
    if len(_bindings) >= MAX_BINDINGS and client_ip not in _bindings:
        # Loftet er nået og kun udløbne er ryddet — drop den nye binding frem
        # for at smide en gyldig ud. Klienten kan forsøge igen.
        logger.warning(
            "selfregister-binding: loft på %d nået — afviser binding for %s",
            MAX_BINDINGS, client_ip,
        )
        return
    _bindings[client_ip] = (mac, now + ttl)


def lookup(client_ip: str) -> str | None:
    """Returnér den bundne MAC for `client_ip`, eller None hvis ingen/udløbet."""
    if not client_ip:
        return None
    entry = _bindings.get(client_ip)
    if not entry:
        return None
    mac, expires_at = entry
    if expires_at <= time.time():
        del _bindings[client_ip]
        return None
    return mac


def unbind(client_ip: str) -> None:
    """Fjern bindingen — kaldes efter en gennemført registrering."""
    _bindings.pop(client_ip, None)


def clear() -> None:
    """Ryd alle bindinger. Kun til tests."""
    _bindings.clear()


def stats() -> dict[str, int]:
    """Antal aktive/udløbne bindinger — til diagnostik."""
    now = time.time()
    active = sum(1 for _, exp in _bindings.values() if exp > now)
    return {"active": active, "total": len(_bindings), "max": MAX_BINDINGS}
