# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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
import re
from typing import Iterable
from xml.etree import ElementTree as ET

import httpx

from app.core import config
from app.core.exceptions import IseApiError
from app.core.platform_types import normalize as normalize_platform

logger = logging.getLogger(__name__)


def _normalize_mac(mac: str) -> str:
    return (mac or "").replace("-", ":").strip().upper()


async def _mnt_get_xml(path: str) -> tuple[int, str]:
    """Generisk MnT GET — returnerer (status_code, response_text)."""
    s = config.settings
    if not s.ise_password:
        raise IseApiError(0, "ISE password ikke sat.")
    base = s.ise_base_url.rstrip("/")
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
        raise IseApiError(0, f"MnT transport error: {exc}") from exc
    return response.status_code, response.text or ""


def _parse_all_xml_fields(text: str) -> dict[str, str]:
    """Returner alle leaf-felter fra XML som {tag: text}. Til diagnostik."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return {}
    out: dict[str, str] = {}
    for elem in root.iter():
        if len(elem) == 0 and elem.text and elem.text.strip():
            tag = elem.tag.split("}")[-1]
            out[tag] = elem.text.strip()
    return out


async def probe_session_detail(mac: str) -> dict:
    """Diagnostic probe: henter alle tilgængelige MnT-felter for en MAC.

    Kalder:
      - GET /admin/API/mnt/Session/MACAddress/{mac}
      - GET /admin/API/mnt/AuthStatus/MACAddress/{mac}

    Returnerer dict med status, feltnavn→værdi, og råt XML for begge.
    """
    mac_encoded = mac.upper().replace(":", "%3A")
    results = {}
    for label, path in [
        ("session_detail",  f"/admin/API/mnt/Session/MACAddress/{mac_encoded}"),
        ("auth_status",     f"/admin/API/mnt/AuthStatus/MACAddress/{mac_encoded}/3600/25/All"),
    ]:
        try:
            status_code, text = await _mnt_get_xml(path)
            fields = _parse_all_xml_fields(text)
            logger.info(
                "MnT probe %s [%s] HTTP=%d felter=%d: %s",
                label, path, status_code, len(fields),
                sorted(fields.keys()),
            )
            results[label] = {
                "http_status": status_code,
                "fields": fields,
                "raw_xml": text[:4000],
            }
        except IseApiError as exc:
            results[label] = {"error": str(exc)}
    return results


def _parse_auth_status_elements(text: str) -> list[dict[str, str]]:
    """Parse AuthStatus XML til liste af dicts, ét dict per authStatusElements.

    Returnerer elementer i dokument-rækkefølge (nyeste-først som ISE sender dem).
    Modsat _parse_all_xml_fields flades der IKKE på tværs af elementer — hvert
    element er sin egen session-record.
    """
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    result: list[dict[str, str]] = []
    for elem in root.iter():
        tag = (elem.tag or "").split("}")[-1].lower()
        if tag not in ("authstatuselements", "authstatuselement"):
            continue
        row: dict[str, str] = {}
        for child in elem:
            ctag = (child.tag or "").split("}")[-1]
            val = (child.text or "").strip()
            if val:
                row[ctag] = val
        if row:
            result.append(row)
    return result


async def fetch_session_by_mac(mac: str) -> dict[str, str]:
    """Hent MnT Session/MACAddress + AuthStatus for én MAC og returnér enrichment-felter.

    Kalder begge endpoints:
      - GET /admin/API/mnt/Session/MACAddress/{mac}   → endpoint_policy, dacl, vlan, cts_security_group
      - GET /admin/API/mnt/AuthStatus/MACAddress/{mac}/3600/25/All
          → policy_set_name, authz_rule_name, auth_method, identity_group,
            authz_profiles_mnt (selected_azn_profiles som liste), VLAN via response AV-pair

    Note: ISEPolicySetName og AuthorizationPolicyMatchedRule optræder IKKE i
    ISE 3.4 MnT AuthStatus XML for alle deployments. authentication_method
    (f.eks. "mab") og selected_azn_profiles er de felter der altid er tilgængelige.

    Returnerer tom dict ved fejl. Alle keys er altid til stede.
    AuthStatus-URL kræver /{seconds}/{records}/{framed} — kald uden disse giver 404.
    """
    mac_encoded = (mac or "").upper().replace(":", "%3A")
    out: dict[str, str] = {
        "endpoint_policy": "", "dacl": "", "vlan": "", "cts_security_group": "",
        "auth_method": "", "identity_group": "", "authz_profiles_mnt": "",
    }
    if not mac_encoded:
        return out

    # ── Session/MACAddress ────────────────────────────────────────────────
    # VLAN gemmes i session_mac_vlan — kombineres med AuthStatus VLAN til sidst.
    session_mac_vlan = ""
    try:
        sc, text = await _mnt_get_xml(f"/admin/API/mnt/Session/MACAddress/{mac_encoded}")
        if sc < 400 and text:
            f = _parse_all_xml_fields(text)
            out["endpoint_policy"] = (
                f.get("endpointPolicy") or f.get("endpoint_policy") or f.get("EndpointPolicy") or ""
            )
            out["dacl"] = (
                f.get("dacl") or f.get("downloadedDacl") or f.get("downloaded_dacl")
                or f.get("downloadedAVPair") or ""
            )
            session_mac_vlan = (
                f.get("vlan") or f.get("tunnelPrivateGroupId") or f.get("tunnel_private_group_id") or ""
            )
            out["cts_security_group"] = (
                f.get("ctsSecurityGroup") or f.get("cts_security_group")
                or f.get("sgt") or f.get("SecurityGroup") or ""
            )
    except IseApiError as exc:
        logger.debug("MnT Session/MACAddress [%s] fejlede: %s", mac, exc)

    # ── AuthStatus/MACAddress — kræver /seconds/records/framed path-params ─
    # VLAN udtrækkes fra RADIUS Accept AV-pair og gemmes i auth_status_vlan.
    # AuthStatus foretrækkes over Session/MACAddress VLAN — Session/MACAddress kan
    # indeholde data fra en stale session ved ISE session-overlap, mens AuthStatus
    # AV-pairs direkte afspejler det seneste RADIUS Accept-svar.
    auth_status_vlan = ""
    try:
        sc2, text2 = await _mnt_get_xml(
            f"/admin/API/mnt/AuthStatus/MACAddress/{mac_encoded}/3600/25/All"
        )
        if sc2 < 400 and text2:
            # AuthStatus returnerer FLERE authStatusElements sorteret nyeste-først.
            # Vi parser hvert element individuelt og bruger FØRSTE (nyeste) fund per felt.
            elements = _parse_auth_status_elements(text2)
            for elem in elements:
                if not out["auth_method"]:
                    out["auth_method"] = (
                        elem.get("authentication_method") or elem.get("authenticationMethod")
                        or elem.get("auth_method") or ""
                    )
                if not out["identity_group"]:
                    out["identity_group"] = (
                        elem.get("identity_group") or elem.get("identityGroup") or ""
                    )
                if not out["authz_profiles_mnt"]:
                    azn_str = (
                        elem.get("selected_azn_profiles") or elem.get("selectedAznProfiles")
                        or elem.get("selectedAuthzProfiles") or ""
                    )
                    if azn_str:
                        profiles = [p.strip() for p in azn_str.split(",") if p.strip()]
                        out["authz_profiles_mnt"] = ",".join(profiles)
                # VLAN fra response AV-pair — tag fra FØRSTE element der har det.
                # Format: "Tunnel-Private-Group-ID=(tag=1) 32" eller "=32"
                if not auth_status_vlan:
                    resp_str = elem.get("response", "")
                    m = re.search(
                        r"Tunnel-Private-Group-ID=(?:\(tag=\d+\)\s*)?(\d+)", resp_str
                    )
                    if m:
                        auth_status_vlan = m.group(1)
                if not out["endpoint_policy"]:
                    out["endpoint_policy"] = (
                        elem.get("endpointPolicy") or elem.get("EndpointPolicy") or ""
                    )
                if not out["cts_security_group"]:
                    out["cts_security_group"] = (
                        elem.get("ctsSecurityGroup") or elem.get("cts_security_group") or ""
                    )
    except IseApiError as exc:
        logger.debug("MnT AuthStatus/MACAddress [%s] fejlede: %s", mac, exc)

    # AuthStatus VLAN (fra RADIUS Accept AV-pair) foretrækkes; Session/MACAddress som fallback.
    out["vlan"] = auth_status_vlan or session_mac_vlan
    return out


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
