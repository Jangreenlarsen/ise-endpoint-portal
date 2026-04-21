"""DACL service: list/get/create/update/delete + Cisco IOS ACL syntax validation.

Validation is intentionally lenient — Cisco IOS ACL syntax is huge and
ISE has its own (stricter) parser that runs at save-time. Backend pre-check
catches the obvious mistakes (missing action, unknown protocol, malformed
addresses) so users get instant feedback while typing without us pretending
to be a full IOS parser.

ISE accepts each ACE on its own line. Lines starting with `!` are comments.
Empty lines are ignored.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable

from app.core import config
from app.ise.client import IseClient
from app.ise.dacls import IseDaclRepository, OpenApiDaclRepository
from app.schemas.dacl import (
    DACL_TYPES,
    CreateDaclRequest,
    DaclDetail,
    DaclLineIssue,
    DaclSummary,
    DaclValidationResult,
    UpdateDaclRequest,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# IOS ACL syntax validation
# ---------------------------------------------------------------------------

# Common Cisco IOS protocol keywords accepted in extended ACL ACEs.
# Anything not in this set must be a numeric protocol (0-255).
_PROTOCOLS = {
    "ip", "icmp", "igmp", "tcp", "udp", "esp", "ahp", "ah", "gre",
    "eigrp", "ospf", "pim", "nos", "pcp", "sctp", "ipinip", "object-group",
    # IPv6
    "ipv6", "icmpv6",
}

# Address-spec keywords (consume varying numbers of trailing tokens).
#   any                                     → consumes 0 extra tokens
#   host A.B.C.D                            → consumes 1
#   A.B.C.D W.W.W.W                         → consumes 1 (the wildcard)
#   IPv6: any | host X:: | X::/N            → 0 or 1
#   object-group <name>                     → 1
_PORT_OPS = {"eq", "neq", "gt", "lt", "range"}

_IPV4_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")
_IPV6_RE = re.compile(r"^[0-9a-fA-F:]+$")
_IPV6_PREFIX_RE = re.compile(r"^[0-9a-fA-F:]+/\d{1,3}$")
_NAME_RE = re.compile(r"^[A-Za-z0-9_\-\.]+$")


def _ipv4_ok(s: str) -> bool:
    if not _IPV4_RE.match(s):
        return False
    return all(0 <= int(p) <= 255 for p in s.split("."))


def _consume_address(tokens: list[str], i: int, ipv6: bool) -> tuple[int, str | None]:
    """Consume one source/destination address spec starting at tokens[i].

    Returns (next_index, error_message_or_None).
    """
    if i >= len(tokens):
        return i, "manglende adresse"
    tok = tokens[i].lower()
    if tok == "any":
        return i + 1, None
    if tok == "host":
        if i + 1 >= len(tokens):
            return i + 1, "'host' uden adresse"
        addr = tokens[i + 1]
        if ipv6:
            if not _IPV6_RE.match(addr):
                return i + 2, f"ugyldig IPv6-adresse: {addr}"
        else:
            if not _ipv4_ok(addr):
                return i + 2, f"ugyldig IPv4-adresse: {addr}"
        return i + 2, None
    if tok == "object-group":
        if i + 1 >= len(tokens) or not _NAME_RE.match(tokens[i + 1]):
            return i + 2, "object-group mangler gyldigt navn"
        return i + 2, None
    if ipv6:
        # Bare prefix: 2001:db8::/32  (the IPv6 form has no wildcard companion)
        if _IPV6_PREFIX_RE.match(tokens[i]):
            return i + 1, None
        if _IPV6_RE.match(tokens[i]):
            return i + 1, None
        return i + 1, f"ugyldig IPv6-adresse: {tokens[i]}"
    # IPv4 with wildcard mask: A.B.C.D W.W.W.W
    if _ipv4_ok(tokens[i]):
        if i + 1 >= len(tokens):
            return i + 1, "IPv4-adresse uden wildcard-maske (eller brug 'host')"
        if not _ipv4_ok(tokens[i + 1]):
            return i + 2, f"ugyldig wildcard-maske: {tokens[i + 1]}"
        return i + 2, None
    return i + 1, f"ukendt adresse-spec: {tokens[i]}"


def _consume_port_spec(tokens: list[str], i: int) -> tuple[int, str | None]:
    """Consume an optional port operator (eq/neq/gt/lt/range) starting at i.

    Port names are accepted as-is (www, smtp, …) — IOS accepts both names
    and numbers and we don't keep an exhaustive list.
    """
    if i >= len(tokens) or tokens[i].lower() not in _PORT_OPS:
        return i, None
    op = tokens[i].lower()
    needed = 2 if op == "range" else 1
    if i + needed >= len(tokens):
        return i + 1, f"port-operator '{op}' mangler argument(er)"
    return i + 1 + needed, None


def _validate_line(line_no: int, raw: str, ipv6: bool) -> DaclLineIssue | None:
    """Return an issue (error/warning) for one ACL line, or None if it parses."""
    text = raw.strip()
    if not text or text.startswith("!") or text.startswith("#"):
        return None
    # Strip an optional leading sequence number ("10 permit ip any any").
    tokens = text.split()
    if tokens and tokens[0].isdigit():
        tokens = tokens[1:]
    if not tokens:
        return DaclLineIssue(
            line=line_no, text=raw, severity="error", message="tom ACE",
        )
    action = tokens[0].lower()
    if action not in ("permit", "deny", "remark"):
        return DaclLineIssue(
            line=line_no, text=raw, severity="error",
            message=f"linje skal starte med permit/deny/remark (fandt '{tokens[0]}')",
        )
    if action == "remark":
        return None  # everything after `remark` is free text
    if len(tokens) < 2:
        return DaclLineIssue(
            line=line_no, text=raw, severity="error",
            message="manglende protocol efter permit/deny",
        )
    proto = tokens[1].lower()
    if proto not in _PROTOCOLS:
        if not (proto.isdigit() and 0 <= int(proto) <= 255):
            return DaclLineIssue(
                line=line_no, text=raw, severity="warning",
                message=f"ukendt protocol '{tokens[1]}' (accepterer ISE evt. alligevel)",
            )
    i = 2
    # DACL-specific constraint: ISE kræver at source-feltet er "any" i alle
    # ACE'er. Ved push til switchen erstatter ISE selv "any" med klientens
    # IP. Enhver anden source (host X, prefix, object-group, ...) får ISE
    # til at afvise hele DACL'en med 400 "Validation Error — While creating
    # DACL, the keyword 'Any' must be the source in all ACE in DACL". Vi
    # fanger det her så brugeren ser fejlen mens vedkommende skriver.
    src_first = tokens[i].lower() if i < len(tokens) else ""
    if src_first and src_first != "any":
        return DaclLineIssue(
            line=line_no, text=raw, severity="error",
            message=(
                "src skal være 'any' i DACL — ISE erstatter selv med "
                "klient-IP'en ved push (ISE afviser ellers hele DACL'en)"
            ),
        )
    i, err = _consume_address(tokens, i, ipv6)
    if err:
        return DaclLineIssue(
            line=line_no, text=raw, severity="error", message=f"src: {err}",
        )
    if proto in ("tcp", "udp", "sctp"):
        i, err = _consume_port_spec(tokens, i)
        if err:
            return DaclLineIssue(
                line=line_no, text=raw, severity="error", message=f"src port: {err}",
            )
    i, err = _consume_address(tokens, i, ipv6)
    if err:
        return DaclLineIssue(
            line=line_no, text=raw, severity="error", message=f"dst: {err}",
        )
    if proto in ("tcp", "udp", "sctp"):
        i, err = _consume_port_spec(tokens, i)
        if err:
            return DaclLineIssue(
                line=line_no, text=raw, severity="error", message=f"dst port: {err}",
            )
    # Trailing modifiers (log, established, fragments, time-range NAME, …) are
    # accepted without further validation — ISE will reject anything truly bad.
    return None


def validate_dacl(text: str, dacl_type: str = "IPV4") -> DaclValidationResult:
    ipv6 = dacl_type.upper() == "IPV6"
    issues: list[DaclLineIssue] = []
    has_any_ace = False
    for n, raw in enumerate(text.splitlines(), start=1):
        if raw.strip() and not raw.strip().startswith(("!", "#")):
            stripped = raw.strip().split()
            if stripped and stripped[0].lower() != "remark":
                has_any_ace = True
        issue = _validate_line(n, raw, ipv6)
        if issue:
            issues.append(issue)
    if not has_any_ace and text.strip():
        issues.append(
            DaclLineIssue(
                line=0, text="", severity="warning",
                message="ingen permit/deny linjer fundet",
            )
        )
    has_error = any(i.severity == "error" for i in issues)
    return DaclValidationResult(ok=not has_error, issues=issues)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class DaclService:
    def __init__(self, client: IseClient) -> None:
        api_type = (config.settings.ise_api_type or "ers").lower()
        if api_type == "openapi":
            logger.info("DaclService using Open API (/api/v1/downloadable-acl)")
            self.repo = OpenApiDaclRepository(client)
        else:
            logger.info("DaclService using ERS (/ers/config/downloadableacl)")
            self.repo = IseDaclRepository(client)

    async def list_summaries(self) -> list[DaclSummary]:
        raw = await self.repo.list_all()
        return [
            DaclSummary(
                id=r.get("id", ""),
                name=r.get("name", ""),
                description=r.get("description", "") or "",
            )
            for r in raw
            if r.get("id")
        ]

    async def get(self, dacl_id: str) -> DaclDetail:
        raw = await self.repo.get(dacl_id)
        return _to_detail(raw)

    async def create(self, req: CreateDaclRequest) -> DaclDetail:
        _check_type(req.dacl_type)
        new_id = await self.repo.create(
            name=req.name,
            description=req.description,
            dacl=req.dacl,
            dacl_type=req.dacl_type,
        )
        if not new_id:
            return DaclDetail(
                id="", name=req.name, description=req.description,
                dacl=req.dacl, dacl_type=req.dacl_type,
            )
        return await self.get(new_id)

    async def update(self, dacl_id: str, req: UpdateDaclRequest) -> DaclDetail:
        if req.dacl_type is not None:
            _check_type(req.dacl_type)
        # ISE kræver Name i PUT-body som mandatory field, også selv om navnet
        # ikke ændres. Hent eksisterende navn hvis frontend ikke sendte et.
        name = req.name
        if name is None:
            current = await self.repo.get(dacl_id)
            name = current.get("name", "") or None
        await self.repo.update(
            dacl_id,
            name=name,
            description=req.description,
            dacl=req.dacl,
            dacl_type=req.dacl_type,
        )
        return await self.get(dacl_id)

    async def delete(self, dacl_id: str) -> None:
        await self.repo.delete(dacl_id)


def _to_detail(raw: dict) -> DaclDetail:
    return DaclDetail(
        id=raw.get("id", ""),
        name=raw.get("name", ""),
        description=raw.get("description", "") or "",
        dacl=raw.get("dacl", "") or "",
        dacl_type=(raw.get("daclType") or "IPV4"),
    )


def _check_type(t: str) -> None:
    if t not in DACL_TYPES:
        raise ValueError(f"daclType skal være en af {DACL_TYPES}, fik '{t}'")


__all__: Iterable[str] = (
    "DaclService",
    "validate_dacl",
)
