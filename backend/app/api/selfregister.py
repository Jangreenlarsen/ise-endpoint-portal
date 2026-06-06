# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Public self-registration API — CWA (Central Web Authentication) flow.

Flow:
  1. WLC redirecter klient til /selfregister (ingen MAC i URL)
  2. Frontend kalder GET /api/selfregister/session med klientens IP
  3. Portal slår MAC op via ISE MnT Session/IPAddress/{ip}
  4. Bruger udfylder navn (+ optional IPSK) og accepterer vilkår
  5. POST /api/selfregister opretter/opdaterer endpoint i ISE
  6. CoA Reauth trigges via MnT → WLC re-autentificerer klient

Endpoints (alle public — ingen auth):
  GET  /api/selfregister/config           → side-config
  GET  /api/selfregister/session?ip=...   → MAC-lookup via MnT
  POST /api/selfregister                  → registrér endpoint + CoA
"""
import logging
import re

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import get_endpoint_service
from app.core import config
from app.core.exceptions import IseApiError
from app.ise import mnt_sessions
from app.ise.coa import reauth as coa_reauth
from app.schemas.endpoint import CreateEndpointRequest, CustomAttrs, EndpointUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/selfregister", tags=["selfregister"])

_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$")


def _normalize_mac(mac: str) -> str:
    hex_only = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    if len(hex_only) != 12:
        return mac
    return ":".join(hex_only[i:i+2] for i in range(0, 12, 2))


def _client_ip(request: Request) -> str:
    """Udtræk klientens IP — respekter X-Forwarded-For fra reverse proxy."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Schemas ───────────────────────────────────────────────────────────────────

class SelfRegisterConfig(BaseModel):
    enabled: bool
    terms: str
    redirect_url: str
    ipsk_enabled: bool = False


class SessionLookupResponse(BaseModel):
    found: bool
    mac: str = ""
    nas_ip: str = ""
    acs_session_id: str = ""
    client_ip: str = ""
    message: str = ""


class SelfRegisterRequest(BaseModel):
    mac: str = Field(..., description="MAC verificeret via MnT session-lookup")
    registrant_name: str = Field(..., min_length=2, max_length=128)
    agreed: bool = Field(..., description="Registranten har accepteret vilkårene")
    psk_key: str | None = Field(None, max_length=128, description="Valgfri IPSK-nøgle")


class SelfRegisterResponse(BaseModel):
    ok: bool
    message: str
    redirect_url: str = ""
    coa_sent: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/config", response_model=SelfRegisterConfig)
async def get_selfregister_config() -> SelfRegisterConfig:
    """Returnér side-konfiguration til frontend."""
    s = config.settings
    return SelfRegisterConfig(
        enabled=s.selfregister_enabled,
        terms=s.selfregister_terms,
        redirect_url=s.selfregister_redirect_url,
        ipsk_enabled=s.selfregister_ipsk_enabled,
    )


@router.get("/session", response_model=SessionLookupResponse)
async def lookup_session(request: Request, ip: str = "") -> SessionLookupResponse:
    """Slå aktiv RADIUS-session op via klientens IP-adresse.

    Frontend kalder dette endpoint umiddelbart efter sideload.
    IP tages fra query-param ?ip= eller fra request.remote_addr.
    Udfører 3 forsøg med 2 sekunders mellemrum mod ISE MnT API.
    """
    s = config.settings
    if not s.selfregister_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Selvregistrering er deaktiveret")

    client_ip = ip.strip() or _client_ip(request)
    if not client_ip:
        return SessionLookupResponse(found=False, message="Kunne ikke bestemme klientens IP-adresse")

    # Brug ISE MnT API direkte — ét forsøg pr. kald fra frontend (frontend poller)
    try:
        mnt_sess = await mnt_sessions.session_by_ip(client_ip, retries=1, retry_delay=0.0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("selfregister session MnT fejl ip=%s: %s", client_ip, exc)
        return SessionLookupResponse(
            found=False,
            client_ip=client_ip,
            message=f"MnT API fejl: {exc}",
        )

    if not mnt_sess:
        logger.debug("selfregister/session: ingen MnT-session for ip=%s", client_ip)
        return SessionLookupResponse(
            found=False,
            client_ip=client_ip,
            message="Ingen aktiv RADIUS-session fundet for denne IP. Prøv igen om få sekunder.",
        )

    logger.info(
        "selfregister/session: fundet via MnT mac=%s ip=%s nas=%s",
        mnt_sess.mac, client_ip, mnt_sess.nas_ip,
    )
    return SessionLookupResponse(
        found=True,
        mac=mnt_sess.mac,
        nas_ip=mnt_sess.nas_ip,
        acs_session_id=mnt_sess.acs_session_id,
        client_ip=client_ip,
    )


@router.post("", response_model=SelfRegisterResponse)
async def selfregister(req: SelfRegisterRequest) -> SelfRegisterResponse:
    """Registrér endpoint i ISE (upsert) og send CoA Reauth til WLC.

    Upsert-logik:
      - Hvis MAC allerede findes i ISE → opdater custom-attributter (PUT)
      - Ellers → opret nyt endpoint (POST)
    """
    s = config.settings
    if not s.selfregister_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Selvregistrering er deaktiveret")
    if not req.agreed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vilkårene skal accepteres")

    mac = _normalize_mac(req.mac.strip())
    if not _MAC_RE.match(mac):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ugyldig MAC-adresse: {req.mac!r}")

    registrant = req.registrant_name.strip()
    psk_key = (req.psk_key or "").strip()

    service = get_endpoint_service()

    # Byg custom-attributter
    ca = CustomAttrs(
        RegistretBy=registrant,
        GuestRegistration="true",
        HypervisionActive="Aktiv",
        AuthzVlan=s.selfregister_authz_vlan or "",
        AuthzACL=s.selfregister_authz_acl or "",
    )
    if psk_key and s.selfregister_ipsk_enabled:
        ca.PSK_Mode = "true"
        ca.PSK_Key = psk_key

    endpoint_id: str | None = None

    # Upsert: tjek om MAC allerede eksisterer
    try:
        existing = await service.endpoints.get_by_mac(mac)
    except Exception:  # noqa: BLE001
        existing = None

    if existing:
        # Opdater eksisterende endpoint
        endpoint_id = existing.get("id", "")
        try:
            update = EndpointUpdate(
                description=f"Selvregistreret af {registrant}",
                custom_attributes=ca,
            )
            await service.update_endpoint(endpoint_id, update)
            logger.info("selfregister: opdaterede eksisterende endpoint mac=%s id=%s", mac, endpoint_id)
        except IseApiError as exc:
            logger.warning("selfregister: update fejl mac=%s: %s", mac, exc)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"ISE fejl ved opdatering: {exc}") from exc
    else:
        # Opret nyt endpoint
        create_req = CreateEndpointRequest(
            mac=mac,
            group_id=s.selfregister_group_id or "",
            description=f"Selvregistreret af {registrant}",
            custom_attributes=ca,
        )
        try:
            endpoint_id = await service.create_endpoint(create_req)
            logger.info("selfregister: oprettede endpoint mac=%s id=%s", mac, endpoint_id)
        except IseApiError as exc:
            logger.warning("selfregister: create fejl mac=%s: %s", mac, exc)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"ISE fejl ved oprettelse: {exc}") from exc

    # CoA Reauth via MAC (ISE MnT finder NAS-IP automatisk via aktiv session)
    coa_sent = False
    try:
        ok, msg = await coa_reauth(mac)
        coa_sent = ok
        if ok:
            logger.info("selfregister: CoA Reauth ok mac=%s: %s", mac, msg)
        else:
            logger.warning("selfregister: CoA Reauth fejlede mac=%s: %s", mac, msg)
    except Exception as exc:  # noqa: BLE001
        logger.warning("selfregister: CoA exception mac=%s: %s", mac, exc)

    return SelfRegisterResponse(
        ok=True,
        message=f"{mac} er registreret.",
        redirect_url=s.selfregister_redirect_url,
        coa_sent=coa_sent,
    )
