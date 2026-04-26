"""Typed exceptions for the PxGrid layer.

Kept distinct from ``app.core.exceptions.IseApiError`` because pxGrid
has its own error semantics: an account can be PENDING (legitimate
state — admin hasn't approved yet, retry later), and TLS handshake
failures must be surfaced as a config problem (wrong CA bundle) not
as a generic API error.
"""
from __future__ import annotations


class PxGridError(Exception):
    """Base for all pxGrid errors."""


class PxGridConfigError(PxGridError):
    """Raised when settings are missing or inconsistent (no PSN, no cert path)."""


class PxGridCertError(PxGridError):
    """Raised when cert/key files cannot be loaded or are mutually inconsistent."""


class PxGridAuthError(PxGridError):
    """TLS handshake or HTTP 401 from /pxgrid/control/*."""


class PxGridAccountPendingError(PxGridError):
    """ISE returned accountState=PENDING — admin must approve in pxGrid UI."""


class PxGridServiceNotFoundError(PxGridError):
    """ServiceLookup returned no nodes for the requested topic."""
