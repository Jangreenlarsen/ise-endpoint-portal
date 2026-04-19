"""Change of Authorization (CoA) via the ISE MnT REST API.

MnT exposes a CoA trigger path that does NOT share the ERS/Open API base path
surface, so this module talks to MnT directly via httpx (same credentials as
the main IseClient). Response is XML and parsed loosely for the status message.

Reference path:
    GET /admin/API/mnt/CoA/Reauth/{psn_name}/{mac}/{reauth_type}
    - psn_name: hostname of the PSN that should issue the CoA
    - mac: colon-separated upper-case MAC
    - reauth_type: 0=DEFAULT, 1=RERUN, 2=LAST
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
    # MnT sometimes needs the short name, sometimes FQDN — we keep what's in the URL.
    return host


_STATUS_RE = re.compile(r"<results>\s*<[^>]*>([^<]+)</[^>]*>", re.IGNORECASE)


def _extract_status(text: str) -> str:
    """Pull a human-ish status message out of the MnT XML reply."""
    if not text:
        return ""
    m = _STATUS_RE.search(text)
    if m:
        return m.group(1).strip()
    # Fallback: strip tags, collapse whitespace
    stripped = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", stripped).strip()


async def reauth(mac: str) -> tuple[bool, str]:
    """Trigger a CoA reauth for a MAC. Returns (ok, status_message)."""
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
    path = f"/admin/API/mnt/CoA/Reauth/{psn}/{mac_n}/{s.coa_reauth_type}"
    logger.info(
        "CoA reauth mac=%s psn=%s type=%d", mac_n, psn, s.coa_reauth_type
    )
    try:
        async with httpx.AsyncClient(
            base_url=base,
            auth=(s.ise_username, s.ise_password),
            verify=s.ise_verify_tls,
            timeout=s.ise_timeout,
            headers={"Accept": "application/xml"},
        ) as http:
            response = await http.get(path)
    except httpx.HTTPError as exc:
        logger.error("CoA transport error: %s", exc)
        raise IseApiError(0, f"CoA transport error: {exc}") from exc

    text = response.text or ""
    status_msg = _extract_status(text) or f"HTTP {response.status_code}"
    if response.status_code >= 400:
        logger.warning(
            "CoA reauth failed mac=%s status=%d body=%s",
            mac_n, response.status_code, text[:400],
        )
        return False, status_msg
    logger.info("CoA reauth ok mac=%s status=%s", mac_n, status_msg)
    return True, status_msg
