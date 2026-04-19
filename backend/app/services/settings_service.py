from __future__ import annotations

import logging
import time

import httpx

from app.core import config
from app.core.settings_store import load_overrides, save_overrides
from app.ise.client import close_ise_client
from app.schemas.settings import (
    BackendSettingsResponse,
    BackendSettingsUpdate,
    TestConnectionRequest,
    TestConnectionResponse,
)

logger = logging.getLogger(__name__)


def get_backend_settings() -> BackendSettingsResponse:
    s = config.settings
    return BackendSettingsResponse(
        ise_base_url=s.ise_base_url,
        ise_username=s.ise_username,
        ise_password_set=bool(s.ise_password),
        ise_verify_tls=s.ise_verify_tls,
        ise_timeout=s.ise_timeout,
        ise_api_type=s.ise_api_type,  # type: ignore[arg-type]
        coa_psn_name=s.coa_psn_name,
        coa_reauth_type=s.coa_reauth_type,
        coa_disconnect_type=s.coa_disconnect_type,
    )


async def update_backend_settings(
    new: BackendSettingsUpdate,
) -> BackendSettingsResponse:
    overrides = load_overrides()
    overrides.update(
        {
            "ise_base_url": new.ise_base_url,
            "ise_username": new.ise_username,
            "ise_verify_tls": new.ise_verify_tls,
            "ise_timeout": new.ise_timeout,
            "ise_api_type": new.ise_api_type,
            "coa_psn_name": new.coa_psn_name,
            "coa_reauth_type": new.coa_reauth_type,
            "coa_disconnect_type": new.coa_disconnect_type,
        }
    )
    if new.ise_password:
        overrides["ise_password"] = new.ise_password
    save_overrides(overrides)
    config.refresh_settings()
    await close_ise_client()
    logger.info(
        "backend settings updated: url=%s user=%s api=%s coa_psn=%s coa_type=%d",
        new.ise_base_url,
        new.ise_username,
        new.ise_api_type,
        new.coa_psn_name or "(auto)",
        new.coa_reauth_type,
    )
    return get_backend_settings()


async def test_connection(req: TestConnectionRequest) -> TestConnectionResponse:
    """Verify ISE reachability + credentials without persisting any settings.

    Udeladte felter bruger aktive settings; hvis password er tom bruges det gemte.
    """
    s = config.settings
    base_url = (req.ise_base_url or s.ise_base_url).rstrip("/")
    username = req.ise_username or s.ise_username
    password = req.ise_password or s.ise_password
    verify = s.ise_verify_tls if req.ise_verify_tls is None else req.ise_verify_tls
    timeout = s.ise_timeout if req.ise_timeout is None else req.ise_timeout
    api_type = (req.ise_api_type or s.ise_api_type or "ers").lower()
    probe_path = (
        "/api/v1/endpoint-identity-group"
        if api_type == "openapi"
        else "/ers/config/endpointgroup"
    )

    if not base_url or not username or not password:
        return TestConnectionResponse(
            ok=False,
            message="Manglende felter: base_url, username og password er påkrævet.",
        )

    logger.info("testing ISE connection to %s as %s", base_url, username)
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            base_url=base_url,
            auth=(username, password),
            verify=verify,
            timeout=timeout,
            headers={"Accept": "application/json"},
        ) as http:
            # Lightweight probe: group list (1 resource is enough to verify auth).
            response = await http.get(probe_path, params={"size": 1})
    except httpx.HTTPError as exc:
        logger.warning("ISE connection test transport error: %s", exc)
        return TestConnectionResponse(
            ok=False,
            message=f"Kunne ikke kontakte ISE: {exc}",
        )

    latency_ms = int((time.perf_counter() - start) * 1000)
    status_code = response.status_code

    if 200 <= status_code < 300:
        return TestConnectionResponse(
            ok=True,
            status_code=status_code,
            message=f"OK — ISE svarede {status_code} på {latency_ms} ms.",
            latency_ms=latency_ms,
        )
    if status_code in (401, 403):
        role_hint = (
            "ERS Admin-rollen" if api_type == "ers" else "Open API-adgang"
        )
        return TestConnectionResponse(
            ok=False,
            status_code=status_code,
            message=(
                f"Auth-fejl ({status_code}). Tjek brugernavn/password "
                f"og at brugeren har {role_hint}."
            ),
            latency_ms=latency_ms,
        )
    api_hint = "ERS API" if api_type == "ers" else "Open API"
    return TestConnectionResponse(
        ok=False,
        status_code=status_code,
        message=f"ISE svarede {status_code}. Tjek URL og at {api_hint} er enabled.",
        latency_ms=latency_ms,
    )
