"""Change of Authorization (CoA) via the ISE MnT REST API.

MnT exposes a CoA trigger path that does NOT share the ERS/Open API base path
surface, so this module talks to MnT directly via httpx (same credentials as
the main IseClient). Response is XML and parsed loosely for the status message.

Reference paths:
    GET /admin/API/mnt/CoA/Reauth/{psn_name}/{mac}/{reauth_type}
        - reauth_type: 0=DEFAULT, 1=RERUN, 2=LAST
    GET /admin/API/mnt/CoA/Disconnect/{psn_name}/{mac}/{disconnect_type}
        - disconnect_type: 0=DEFAULT (deauth — wireless), 1=PORT BOUNCE (wired),
          2=PORT SHUTDOWN (wired)
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

import httpx

from app.core import config
from app.core.exceptions import IseApiError

logger = logging.getLogger(__name__)


def _normalize_mac(mac: str) -> str:
    """ISE MnT expects colon-separated upper-case MAC (e.g. AA:BB:CC:DD:EE:FF)."""
    return mac.replace("-", ":").strip().upper()


def _derive_psn(configured: str, base_url: str) -> str:
    """Return the configured PSN name, or derive from ise_base_url host."""
    if configured:
        return configured
    host = urlparse(base_url).hostname or ""
    return host


_STATUS_RE = re.compile(r"<results>\s*<[^>]*>([^<]+)</[^>]*>", re.IGNORECASE)


def _extract_status(text: str) -> str:
    """Pull a human-ish status message out of the MnT XML reply."""
    if not text:
        return ""
    m = _STATUS_RE.search(text)
    if m:
        return m.group(1).strip()
    stripped = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", stripped).strip()


async def _call_mnt(action: str, mac: str, type_code: int) -> tuple[bool, str]:
    """Shared MnT CoA call. `action` is 'Reauth' or 'Disconnect'."""
    s = config.settings
    psn = _derive_psn(s.coa_psn_name, s.ise_base_url)
    if not psn:
        raise IseApiError(
            0,
            "CoA PSN-navn ikke konfigureret (coa_psn_name). Sæt den i Settings.",
        )
    if not s.ise_password:
        raise IseApiError(0, "ISE password ikke sat — kan ikke kalde MnT.")
    mac_n = _normalize_mac(mac)
    base = s.ise_base_url.rstrip("/")
    path = f"/admin/API/mnt/CoA/{action}/{psn}/{mac_n}/{type_code}"
    full_url = f"{base}{path}"
    logger.info(
        "CoA %s mac=%s psn=%s type=%d url=%s",
        action, mac_n, psn, type_code, full_url,
    )
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
        logger.error("CoA %s transport error: %s", action, exc)
        raise IseApiError(0, f"CoA transport error: {exc}") from exc

    text = response.text or ""
    ctype = response.headers.get("content-type", "")
    status_msg = _extract_status(text) or f"HTTP {response.status_code}"
    looks_like_html_login = (
        "text/html" in ctype.lower()
        or "<html" in text[:200].lower()
        or "login.jsp" in text[:400].lower()
    )
    if response.status_code in (301, 302, 303, 307, 308):
        target = response.headers.get("location", "")
        logger.warning(
            "CoA %s redirected: mac=%s status=%d -> %s",
            action, mac_n, response.status_code, target,
        )
        return False, (
            f"HTTP {response.status_code} redirect til {target or '?'} — "
            "brugeren har formentlig ikke MnT Admin-rolle. "
            "Tildel rollen 'MnT Admin' eller 'Super Admin' til ISE-brugeren."
        )
    if looks_like_html_login and response.status_code < 400:
        logger.warning(
            "CoA %s svar er HTML login-side mac=%s status=%d",
            action, mac_n, response.status_code,
        )
        return False, (
            "ISE returnerede HTML login-side — brugeren har ikke MnT API-adgang. "
            "Tildel rollen 'MnT Admin' eller 'Super Admin'."
        )
    if response.status_code >= 400:
        logger.warning(
            "CoA %s failed mac=%s status=%d ctype=%s body=%s",
            action, mac_n, response.status_code, ctype, text[:400],
        )
        hint = ""
        if response.status_code in (401, 403):
            hint = (
                " — brugeren mangler formentlig MnT Admin-rolle "
                "(tildel 'MnT Admin' eller 'Super Admin' i ISE)"
            )
        return False, f"HTTP {response.status_code}: {status_msg[:200]}{hint}"
    logger.info(
        "CoA %s ok mac=%s status=%s ctype=%s body-preview=%s",
        action, mac_n, status_msg, ctype, text[:200],
    )
    return True, status_msg


async def reauth(mac: str) -> tuple[bool, str]:
    """Trigger a CoA reauth for a MAC. Returns (ok, status_message)."""
    return await _call_mnt("Reauth", mac, config.settings.coa_reauth_type)


async def disconnect(mac: str) -> tuple[bool, str]:
    """Trigger a CoA disconnect (deauth) for a MAC. Returns (ok, status_message)."""
    return await _call_mnt("Disconnect", mac, config.settings.coa_disconnect_type)
