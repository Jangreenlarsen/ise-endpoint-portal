# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""PxGrid 2.0 integration package (3.0.0).

Splits into discrete modules so each concern can be tested in isolation
against a real ISE PSN:

- ``client``       — REST control plane on https://<psn>:8910/pxgrid/control/*
                     (AccountCreate, AccountActivate, ServiceLookup,
                     AccessSecretCreate). All calls are mTLS.
- ``cert_manager`` — bridge between two cert-provisioning modes:
                     'upload' (admin drops PEM files in place) and
                     'csr' (portal generates CSR, posts via AccountCreate,
                     ISE admin approves in pxGrid Services UI).
- ``exceptions``   — typed errors so api/pxgrid.py can map to user-facing
                     HTTP responses without leaking httpx internals.

Phase 2 will add ``stomp`` (WebSocket+STOMP frame parser) and
``session_cache`` (in-memory MAC→state map populated from
``com.cisco.ise.session`` topic). Phase 3 wires SSE pushdown to the
frontend.
"""
from app.pxgrid.exceptions import (
    PxGridAccountPendingError,
    PxGridAuthError,
    PxGridCertError,
    PxGridConfigError,
    PxGridError,
    PxGridServiceNotFoundError,
)

__all__ = [
    "PxGridError",
    "PxGridAuthError",
    "PxGridAccountPendingError",
    "PxGridCertError",
    "PxGridConfigError",
    "PxGridServiceNotFoundError",
]
