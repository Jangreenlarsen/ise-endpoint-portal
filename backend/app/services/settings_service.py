from __future__ import annotations

import logging

from app.core import config
from app.core.settings_store import load_overrides, save_overrides
from app.ise.client import close_ise_client
from app.schemas.settings import BackendSettingsResponse, BackendSettingsUpdate

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
        }
    )
    if new.ise_password:
        overrides["ise_password"] = new.ise_password
    save_overrides(overrides)
    config.refresh_settings()
    await close_ise_client()
    logger.info(
        "backend settings updated: url=%s user=%s api=%s",
        new.ise_base_url,
        new.ise_username,
        new.ise_api_type,
    )
    return get_backend_settings()
