# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Public self-registration API — bruges af wireless controller redirect.

Endpoints:
  GET  /api/selfregister/config   → returnerer side-config (terms, enabled)
  POST /api/selfregister          → registrér MAC i ISE
"""
import re
import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_endpoint_service
from app.core import config
from app.core.exceptions import IseApiError
from app.schemas.endpoint import CreateEndpointRequest, CustomAttrs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/selfregister", tags=["selfregister"])

_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$")


def _normalize_mac(mac: str) -> str:
    hex_only = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    if len(hex_only) != 12:
        return mac
    return ":".join(hex_only[i:i+2] for i in range(0, 12, 2))


class SelfRegisterConfig(BaseModel):
    enabled: bool
    terms: str
    redirect_url: str


class SelfRegisterRequest(BaseModel):
    mac: str = Field(..., description="MAC-adresse fra URL-parameter (sat af WLC)")
    registrant_name: str = Field(..., min_length=2, max_length=128,
                                  description="Navn på registranten")
    agreed: bool = Field(..., description="Registranten har accepteret vilkårene")


class SelfRegisterResponse(BaseModel):
    ok: bool
    message: str
    redirect_url: str = ""


@router.get("/config", response_model=SelfRegisterConfig)
async def get_selfregister_config() -> SelfRegisterConfig:
    """Returnér side-konfiguration (terms, enabled) til frontend."""
    s = config.settings
    return SelfRegisterConfig(
        enabled=s.selfregister_enabled,
        terms=s.selfregister_terms,
        redirect_url=s.selfregister_redirect_url,
    )


@router.post("", response_model=SelfRegisterResponse)
async def selfregister(req: SelfRegisterRequest) -> SelfRegisterResponse:
    """Registrér et endpoint i ISE via public self-registration."""
    s = config.settings
    if not s.selfregister_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Selvregistrering er deaktiveret")

    if not req.agreed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Vilkårene skal accepteres")

    mac = _normalize_mac(req.mac.strip())
    if not _MAC_RE.match(mac):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Ugyldig MAC-adresse: {req.mac!r}")

    registrant = req.registrant_name.strip()

    service = get_endpoint_service()
    create_req = CreateEndpointRequest(
        mac=mac,
        group_id=s.selfregister_group_id or "",
        description=f"Selvregistreret af {registrant}",
        custom_attributes=CustomAttrs(
            RegistretBy=registrant,
        ),
    )

    try:
        new_id = await service.create_endpoint(create_req)
        logger.info("selfregister: MAC=%s registreret af %r (id=%s)", mac, registrant, new_id)
    except IseApiError as exc:
        logger.warning("selfregister: ISE fejl MAC=%s: %s", mac, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            f"ISE fejl: {exc}") from exc

    return SelfRegisterResponse(
        ok=True,
        message=f"{mac} er registreret.",
        redirect_url=s.selfregister_redirect_url,
    )
