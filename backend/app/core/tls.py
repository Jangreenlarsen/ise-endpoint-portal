# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""TLS-helpers til httpx-klienter.

Samler byggeriet af httpx' `verify`-argument ét sted, så vi undgår den
deprecated `verify=<str>`-form (httpx anbefaler en `ssl.SSLContext`). Samme
mønster som pxGrid allerede bruger i `pxgrid/probe.py` / `pxgrid/session_worker.py`.
"""
from __future__ import annotations

import ssl
from pathlib import Path

# backend/app/core/tls.py → parents[2] = backend/  (rod for relative bundle-stier)
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def build_httpx_verify(ca_bundle: str, verify_tls: bool) -> ssl.SSLContext | bool:
    """Byg et httpx `verify`-argument uden den deprecated `verify=<str>`-form.

    - ``ca_bundle`` sat → en ``ssl.SSLContext`` der verificerer serverens cert
      mod netop det bundle (relativ sti resolves fra ``backend/``).
    - ``ca_bundle`` tom → ``bool`` (``verify_tls``): ``True`` = system-CA'er,
      ``False`` = ingen TLS-verifikation.

    Semantikken matcher den tidligere ``verify = ise_ca_bundle or ise_verify_tls``:
    et sat bundle vinder over bool'en og slår verifikation til mod bundlet.
    """
    if ca_bundle:
        p = Path(ca_bundle)
        if not p.is_absolute():
            p = _BACKEND_ROOT / p
        return ssl.create_default_context(cafile=str(p))
    return verify_tls
