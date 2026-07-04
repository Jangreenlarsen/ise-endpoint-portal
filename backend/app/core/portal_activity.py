# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Sporer seneste portal-aktivitet fra brugere der bruger admin-views.

Bruges af den adaptive cache-TTL (se EndpointCache.effective_ttl): når nogen
aktivt bruger portalen holdes cachen "hot" (base-TTL); når ingen har været
aktive i et stykke tid skrues TTL gradvist op, så drip-loopen laver færre
ISE-kald på tidspunkter hvor ingen alligevel kigger på data.

Signalet er in-process (opdateres i get_current_user på hver autentificeret
request) — ikke session-state, da JWT-auth er stateless. En åben portal-fane
poller dashboardet hvert 30s og holder derved aktiviteten frisk.
"""
from __future__ import annotations

import time

# Init til opstartstidspunktet, ikke 0: en frisk genstart starter derfor med
# base-TTL (hot) og ramper gradvist op hvis ingen logger på — frem for at
# hoppe direkte til max-TTL.
_last_activity_at: float = time.time()

# Roller hvis aktivitet skal holde cachen hot. registrant/registrant_templet
# (self-register-flow) tæller ikke — de kigger ikke på endpoint-cachen.
_ACTIVE_ROLES = frozenset({"admin", "editor", "editor-psk", "viewer"})


def touch(role: str | None = None) -> None:
    """Registrér portal-aktivitet. Kaldes pr. autentificeret request.

    role=None opdaterer altid; ellers kun for roller i _ACTIVE_ROLES.
    """
    global _last_activity_at
    if role is None or role in _ACTIVE_ROLES:
        _last_activity_at = time.time()


def idle_seconds() -> float:
    """Sekunder siden seneste portal-aktivitet (>= 0)."""
    return max(0.0, time.time() - _last_activity_at)


def last_activity_at() -> float:
    return _last_activity_at
