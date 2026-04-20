"""ISE MnT session list — fetches active RADIUS sessions and derives platform.

MnT sessions are returned as XML. We parse the fields needed to derive the
PlatformType for the connecting endpoint (NAS-Port-Type, Cisco-AVPair,
service-type, NAS-Identifier and similar). Mapping to a canonical
PlatformType (airos / iosxe / iossw / nxos / meraki) lives in
:func:`derive_platform`.

Reference: ``GET /admin/API/mnt/Session/ActiveList`` returns a flat XML
list under ``<activeList>`` with one ``<activeSession>`` per row. Field
names vary slightly between ISE versions; we read defensively and treat
missing fields as empty strings.
"""
from __future__ import annotations

import logging
from typing import Iterable
from xml.etree import ElementTree as ET

import httpx

from app.core import config
from app.core.exceptions import IseApiError
from app.core.platform_types import normalize as normalize_platform

logger = logging.getLogger(__name__)


def _normalize_mac(mac: str) -> str:
    return (mac or "").replace("-", ":").strip().upper()


async def fetch_active_sessions() -> list[dict[str, str]]:
    """Return a list of dicts (one per active session) from MnT.

    Each dict carries the lower-cased fields we read from the XML. Errors
    raise :class:`IseApiError` with the HTTP status (or 0 for transport).
    """
    s = config.settings
    if not s.ise_password:
        raise IseApiError(0, "ISE password ikke sat — kan ikke kalde MnT.")
    base = s.ise_base_url.rstrip("/")
    path = "/admin/API/mnt/Session/ActiveList"
    full_url = f"{base}{path}"
    logger.info("MnT ActiveList GET %s", full_url)
    try:
        async with httpx.AsyncClient(
            base_url=base,
            auth=(s.ise_username, s.ise_password),
            verify=s.ise_verify_tls,
            timeout=s.ise_timeout,
            headers={"Accept": "application/xml"},
            follow_redirects=False,
        ) as http:
            response = await http.get(path)
    except httpx.HTTPError as exc:
        logger.error("MnT ActiveList transport error: %s", exc)
        raise IseApiError(0, f"MnT transport error: {exc}") from exc

    if response.status_code in (301, 302, 303, 307, 308):
        target = response.headers.get("location", "")
        raise IseApiError(
            response.status_code,
            f"MnT redirected til {target or '?'} — brugeren mangler MnT Admin-rolle.",
        )
    if response.status_code >= 400:
        raise IseApiError(
            response.status_code,
            f"MnT HTTP {response.status_code}: {response.text[:200]}",
        )

    text = response.text or ""
    ctype = response.headers.get("content-type", "")
    if "xml" not in ctype.lower() and "<" not in text[:20]:
        # ISE som regel sender HTML login-side ved manglende rolle; fail loud.
        raise IseApiError(
            response.status_code,
            "MnT returnerede ikke XML — sandsynligvis HTML login-side; "
            "brugeren mangler 'MnT Admin'/'Super Admin'.",
        )

    sessions = _parse_session_xml(text)
    logger.info("MnT ActiveList parsed %d active sessions", len(sessions))
    return sessions


def _parse_session_xml(text: str) -> list[dict[str, str]]:
    """Parse MnT ActiveList XML into a list of plain dicts."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        logger.warning("MnT ActiveList XML parse error: %s", exc)
        return []

    out: list[dict[str, str]] = []
    # Look for <activeSession> children at any depth (root tag varies).
    for sess in root.iter():
        tag = (sess.tag or "").lower()
        if not tag.endswith("activesession"):
            continue
        row: dict[str, str] = {}
        for child in sess:
            ctag = (child.tag or "").split("}")[-1].lower()
            row[ctag] = (child.text or "").strip()
        if row:
            out.append(row)
    return out


# Substrings (lower-case) that strongly indicate a particular platform.
# Order matters — first match wins. Cisco-AVPair / NAS-Identifier /
# device_type often carry these markers.
_PLATFORM_HINTS: list[tuple[str, str]] = [
    ("airespace", "airos"),
    ("aire-os", "airos"),
    ("aireos", "airos"),
    ("meraki", "meraki"),
    ("c9800", "iosxe"),
    ("9800", "iosxe"),
    ("catalyst9800", "iosxe"),
    ("ios-xe", "iosxe"),
    ("iosxe", "iosxe"),
    ("ios xe", "iosxe"),
    ("nx-os", "nxos"),
    ("nxos", "nxos"),
    ("nexus", "nxos"),
    ("ios-classic", "iossw"),
    ("classic ios", "iossw"),
]


def derive_platform(session: dict[str, str]) -> str | None:
    """Best-effort mapping from a MnT session row to a canonical platform.

    Strategy:
      1. Concatenate the fields most likely to carry vendor markers.
      2. Search for known substrings (Airespace, Meraki, 9800, nx-os, ...).
      3. Fall back on NAS-Port-Type to distinguish wireless vs wired:
         - port-type 19 (Wireless-IEEE-802.11) → airos (most common WLC type)
         - port-type 15 (Ethernet) → iossw (most common wired switch)
      4. Return None when nothing usable was found.
    """
    # Collect all string-ish fields into one search blob.
    fields = []
    for key in (
        "cisco-avpair",
        "ciscoavpair",
        "nas-identifier",
        "nasidentifier",
        "framed-protocol",
        "device_type",
        "devicetype",
        "nasportid",
        "nasporttype",
        "nas-port-type",
        "calling_station_id",
        "nas-ip-address",
        "nasipaddress",
        "service-type",
    ):
        v = session.get(key, "")
        if v:
            fields.append(v.lower())
    blob = " ".join(fields)

    for needle, canonical in _PLATFORM_HINTS:
        if needle in blob:
            return canonical

    # NAS-Port-Type fallback (numeric or string).
    port_type = (
        session.get("nas-port-type", "")
        or session.get("nasporttype", "")
        or ""
    ).lower()
    if "wireless" in port_type or port_type in ("19", "wireless-ieee-802.11"):
        return "airos"
    if "ethernet" in port_type or port_type == "15":
        return "iossw"
    return None


def index_by_mac(sessions: Iterable[dict[str, str]]) -> dict[str, str]:
    """Build {NORMALISED_MAC: canonical_platform} from session rows.

    When the same MAC has multiple active sessions (shouldn't happen but ISE
    can occasionally show stale rows) the last non-None derivation wins.
    """
    out: dict[str, str] = {}
    for sess in sessions:
        mac_raw = (
            sess.get("calling_station_id", "")
            or sess.get("callingstationid", "")
            or sess.get("user_name", "")
            or sess.get("username", "")
            or ""
        )
        if not mac_raw:
            continue
        mac = _normalize_mac(mac_raw)
        if "-" in mac_raw and ":" not in mac:
            # Some ISE versions return MAC dashed; _normalize_mac already
            # handles that, but skip rows that obviously aren't MACs.
            pass
        if len(mac) != 17 or mac.count(":") != 5:
            continue
        derived = derive_platform(sess)
        canonical = normalize_platform(derived) if derived else None
        if canonical:
            out[mac] = canonical
    return out
