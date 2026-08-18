# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Public self-registration API — CWA (Central Web Authentication) flow.

Flow:
  1. WLC redirecter klient til /selfregister (ingen MAC i URL)
  2. Frontend kalder GET /api/selfregister/session (ingen parametre)
  3. Portal slår MAC op via ISE MnT Session/IPAddress/{klientens egen IP}
     og **binder** MAC'en til den IP (core/selfregister_bindings)
  4. Bruger udfylder navn (+ optional IPSK) og accepterer vilkår
  5. POST /api/selfregister slår MAC'en op i bindingen ud fra sin EGEN
     afsender-IP og opretter/opdaterer endpointet i ISE
  6. CoA Reauth trigges via MnT → WLC re-autentificerer klient

Endpoints (alle public — ingen auth):
  GET  /api/selfregister/config    → side-config
  GET  /api/selfregister/session   → MAC-lookup via MnT + binding
  POST /api/selfregister           → registrér endpoint + CoA

**Sikkerhedsmodel (BUGS.md F-01/F-02).** Klientens afsender-IP er det eneste
portalen kan verificere om en anonym bruger, og alt hænger på den:

  - MAC'en kommer ALDRIG fra request-body. Body-feltet `mac` beholdes for
    bagudkompatibilitet, men bruges kun til at afvise en uoverensstemmelse.
  - `/session` tager ingen IP-parameter. Kunne man spørge om en vilkårlig IP,
    var endpointet en åben oracle over alle aktive RADIUS-sessioner på nettet.
  - Upsert af et EKSISTERENDE endpoint tillades kun når det allerede står i
    gæstegruppen — ellers kunne en gæst flytte en virksomhedsenhed derover.
  - `selfregister_enabled` er default False. Fladen er uautentificeret og skal
    slås til bevidst.
"""
import ipaddress
import logging
import re
import time
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import get_endpoint_service, require_admin
from app.core import audit_store, config, selfregister_bindings
from app.core.audit_store import ActorContext, actor_ctx
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
    """Udtræk klientens IP.

    X-Forwarded-For accepteres KUN fra en betroet proxy (`trusted_proxy_ips`) —
    ellers kunne enhver klient sætte headeren selv og udgive sig for en anden
    IP. Da IP'en er det eneste selvregistreringen kan verificere om en anonym
    klient (se `core/selfregister_bindings`), ville en frit valgt XFF gøre hele
    bindingen værdiløs. Samme whitelist som rate limiteren bruger (SEC-9).
    """
    direct = request.client.host if request.client else ""
    trusted = set(getattr(config.settings, "trusted_proxy_ips", []))
    if trusted and direct in trusted:
        forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return direct


def _valid_ip(value: str) -> str | None:
    """Returnér `value` hvis det er en gyldig IP-adresse, ellers None.

    Værdien interpoleres i MnT-stien (`/admin/API/mnt/Session/IPAddress/{ip}`),
    så den må aldrig nå frem uvalideret.
    """
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


# ── Schemas ───────────────────────────────────────────────────────────────────

class SelfRegisterConfig(BaseModel):
    enabled: bool
    intro_text: str = "Registrér din enhed for at få adgang til netværket."
    success_text: str = "Din enhed er nu registreret på netværket."
    terms: str
    redirect_url: str
    ipsk_enabled: bool = False
    expiry_enabled: bool = False
    expiry_mode: str = "period"
    expiry_days: int = 30
    expiry_date: str = ""
    expiry_time: str = "23:59"


class SessionLookupResponse(BaseModel):
    found: bool
    mac: str = ""
    nas_ip: str = ""
    acs_session_id: str = ""
    client_ip: str = ""
    message: str = ""


class SelfRegisterRequest(BaseModel):
    mac: str | None = Field(
        None,
        description=(
            "IKKE autoritativ. Serveren bruger MAC'en fra session-bindingen for "
            "afsender-IP'en; feltet sammenlignes kun, og en uoverensstemmelse "
            "afvises med 403. Beholdt for bagudkompatibilitet."
        ),
    )
    registrant_name: str = Field(..., min_length=2, max_length=128)
    agreed: bool = Field(..., description="Registranten har accepteret vilkårene")
    psk_key: str | None = Field(None, max_length=128, description="Valgfri IPSK-nøgle")


class SelfRegisterResponse(BaseModel):
    ok: bool
    message: str
    redirect_url: str = ""
    coa_sent: bool = False


class MntProbeResponse(BaseModel):
    ok: bool
    latency_ms: int
    http_status: int = 0
    note: str = ""
    error: str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/mnt-probe", response_model=MntProbeResponse, dependencies=[Depends(require_admin)])
async def probe_mnt() -> MntProbeResponse:
    """Test MnT-forbindelsen og returnér latens — bruges i admin-panelet.

    Kalder det samme endpoint som guest-selvregistrering:
    GET /admin/API/mnt/Session/IPAddress/{probe_ip}
    404 er forventet (ingen session for probe-IP) og tæller som OK.
    """
    s = config.settings
    probe_ip = "10.0.0.1"
    path = f"/admin/API/mnt/Session/IPAddress/{probe_ip}"
    try:
        start = time.perf_counter()
        async with httpx.AsyncClient(
            base_url=s.ise_base_url.rstrip("/"),
            auth=(s.ise_username, s.ise_password),
            verify=s.ise_verify_tls,
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=2.0),
            headers={"Accept": "application/xml"},
            follow_redirects=False,
        ) as client:
            resp = await client.get(path)
        ms = round((time.perf_counter() - start) * 1000)
        # HTTP 500 på Session/IPAddress er en known ISE 3.4 bug —
        # portalen bruger ActiveList-fallback automatisk, så MnT ER tilgængeligt.
        ok = resp.status_code in (200, 404, 500)
        if resp.status_code == 500:
            ise_bug = " (ISE 3.4 bug på IPAddress — ActiveList fallback bruges)"
        else:
            ise_bug = ""
        if not ok:
            note = f"Uventet HTTP {resp.status_code}"
        elif ms > 5000:
            note = f"Svarer men meget langsomt ({ms} ms) — guest-registrering kan time out{ise_bug}"
        elif ms > 2000:
            note = f"Noget langsomt ({ms} ms) — overvej ISE MnT load{ise_bug}"
        else:
            note = f"OK ({ms} ms){ise_bug}"
        logger.info("mnt-probe: status=%d latency=%d ms", resp.status_code, ms)
        return MntProbeResponse(ok=ok, latency_ms=ms, http_status=resp.status_code, note=note)
    except httpx.TimeoutException:
        logger.warning("mnt-probe: timeout")
        return MntProbeResponse(ok=False, latency_ms=-1, note="Timeout (>15 s)", error="Timeout")
    except httpx.ConnectError as exc:
        logger.warning("mnt-probe: connect error: %s", exc)
        return MntProbeResponse(ok=False, latency_ms=-1, note="Forbindelsesfejl", error=str(exc)[:120])
    except Exception as exc:  # noqa: BLE001
        logger.warning("mnt-probe: fejl: %s", exc)
        return MntProbeResponse(ok=False, latency_ms=-1, note="Fejl", error=str(exc)[:120])


@router.get("/config", response_model=SelfRegisterConfig)
async def get_selfregister_config() -> SelfRegisterConfig:
    """Returnér side-konfiguration til frontend."""
    s = config.settings
    return SelfRegisterConfig(
        enabled=s.selfregister_enabled,
        intro_text=s.selfregister_intro_text,
        success_text=s.selfregister_success_text,
        terms=s.selfregister_terms,
        redirect_url=s.selfregister_redirect_url,
        ipsk_enabled=s.selfregister_ipsk_enabled,
        expiry_enabled=s.selfregister_expiry_enabled,
        expiry_mode=s.selfregister_expiry_mode,
        expiry_days=s.selfregister_expiry_days,
        expiry_date=s.selfregister_expiry_date,
        expiry_time=s.selfregister_expiry_time,
    )


@router.get("/session", response_model=SessionLookupResponse)
async def lookup_session(request: Request) -> SessionLookupResponse:
    """Slå klientens EGEN aktive RADIUS-session op og bind MAC'en til dens IP.

    Frontend kalder dette endpoint umiddelbart efter sideload og poller til der
    er et svar. Ét MnT-forsøg pr. kald — frontend styrer intervallet.

    Der er bevidst INGEN mulighed for at angive hvilken IP der slås op: kunne man
    det, ville et uautentificeret kald kunne afsløre MAC-adressen for enhver
    aktiv session på netværket (BUGS.md F-02). Resultatet bindes til klientens
    afsender-IP, så den efterfølgende POST kan verificeres uden at stole på
    request-body (F-01).
    """
    s = config.settings
    if not s.selfregister_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Selvregistrering er deaktiveret")

    client_ip = _valid_ip(_client_ip(request))
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

    # Bind MAC'en til klientens afsender-IP — POST'en læser den herfra i stedet
    # for fra request-body.
    selfregister_bindings.bind(client_ip, _normalize_mac(mnt_sess.mac))

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
async def selfregister(req: SelfRegisterRequest, request: Request) -> SelfRegisterResponse:
    """Registrér klientens EGEN enhed i ISE (upsert) og send CoA Reauth til WLC.

    MAC'en hentes fra den binding `/session` oprettede for denne afsender-IP —
    aldrig fra request-body (BUGS.md F-01). Uden en gyldig binding afvises
    kaldet, så klienten må igennem MnT-opslaget først.

    Upsert-logik:
      - MAC findes allerede i ISE → opdater custom-attributter (PUT), men KUN
        hvis endpointet allerede står i gæstegruppen
      - Ellers → opret nyt endpoint (POST)
    """
    s = config.settings
    if not s.selfregister_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Selvregistrering er deaktiveret")
    if not req.agreed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vilkårene skal accepteres")

    client_ip = _valid_ip(_client_ip(request)) or ""
    mac = selfregister_bindings.lookup(client_ip) if client_ip else None
    if not mac:
        logger.warning(
            "selfregister: afvist — ingen aktiv session-binding for ip=%s", client_ip or "?"
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Din enhed er ikke bekræftet på netværket. Genindlæs siden og prøv igen.",
        )

    # Body-MAC'en er ikke autoritativ, men en uoverensstemmelse betyder enten en
    # forældet fane eller et forsøg på at registrere en fremmed enhed — afvis.
    if req.mac and _normalize_mac(req.mac.strip()) != mac:
        logger.warning(
            "selfregister: afvist — body-MAC %s matcher ikke bundet MAC for ip=%s",
            req.mac, client_ip,
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "MAC-adressen matcher ikke din enhed. Genindlæs siden og prøv igen.",
        )

    if not _MAC_RE.match(mac):
        # Defensivt: MnT bør aldrig give os noget andet.
        logger.error("selfregister: bundet MAC har uventet format: %r", mac)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Uventet MAC-format fra ISE")

    # Audit-aktør for det uautentificerede flow — ellers står hændelsen som "system".
    actor_ctx.set(
        ActorContext(
            actor_id="selfregister",
            actor_username="selfregister",
            source_ip=client_ip,
        )
    )

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

    if s.selfregister_expiry_enabled:
        exp_time = s.selfregister_expiry_time or "23:59"
        if s.selfregister_expiry_mode == "date" and s.selfregister_expiry_date:
            exp_date = s.selfregister_expiry_date
        else:
            exp_date = (datetime.now() + timedelta(days=s.selfregister_expiry_days or 30)).strftime("%Y-%m-%d")
        ca.GuestExperyDate = f"{exp_date}:{exp_time}"
        ca.GuestAccessExpire = "false"

    endpoint_id: str | None = None

    # Upsert: tjek om MAC allerede eksisterer
    try:
        existing = await service.endpoints.get_by_mac(mac)
    except Exception:  # noqa: BLE001
        existing = None

    if existing:
        # Gen-registrering er kun tilladt for endpoints der ALLEREDE er gæster.
        # Uden denne spærre kunne en gæst med en aktiv session få et vilkårligt
        # eksisterende endpoint — fx en virksomhedsenhed — flyttet til
        # gæstegruppen og få ændret dets AuthzVlan/AuthzACL (BUGS.md F-01).
        guest_group = (s.selfregister_group_id or "").strip()
        current_group = (existing.get("groupId") or "").strip()
        if guest_group and current_group != guest_group:
            logger.warning(
                "selfregister: afvist gen-registrering af mac=%s — endpoint er i "
                "gruppe %s, ikke gæstegruppen %s (ip=%s)",
                mac, current_group or "(ingen)", guest_group, client_ip,
            )
            await audit_store.record(
                "selfregister_rejected", "endpoint", existing.get("id", ""),
                after={"mac": mac, "reason": "not_in_guest_group",
                       "current_group": current_group, "source_ip": client_ip},
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Denne enhed er allerede registreret på netværket. "
                "Kontakt netværksadministratoren.",
            )

        # Opdater eksisterende endpoint — sæt også group_id så MAC flyttes til
        # den konfigurerede guest-gruppe selv ved gen-registrering.
        endpoint_id = existing.get("id", "")
        try:
            update = EndpointUpdate(
                description=f"Selvregistreret af {registrant}",
                group_id=s.selfregister_group_id or None,
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

    # Bindingen er brugt — fjern den så samme IP ikke kan gen-registrere uden et
    # nyt MnT-opslag.
    selfregister_bindings.unbind(client_ip)

    await audit_store.record(
        "selfregister", "endpoint", endpoint_id,
        after={"mac": mac, "registrant": registrant, "source_ip": client_ip,
               "existing": bool(existing), "coa_sent": coa_sent},
    )

    return SelfRegisterResponse(
        ok=True,
        message=f"{mac} er registreret.",
        redirect_url=s.selfregister_redirect_url,
        coa_sent=coa_sent,
    )
