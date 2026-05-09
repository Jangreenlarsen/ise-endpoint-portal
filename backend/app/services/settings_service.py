from __future__ import annotations

import logging
import random
import string
import time

import httpx

from app.core import audit_store, config
from app.core.endpoint_cache import get_cache
from app.core.settings_store import load_overrides, save_overrides
from app.ise.client import close_ise_client
from app.pxgrid import cert_manager as pxgrid_cert_manager
from app.pxgrid.client import PxGridClient
from app.pxgrid.exceptions import PxGridAccountPendingError
from app.schemas.settings import (
    BackendSettingsResponse,
    BackendSettingsUpdate,
    GeneratedPskKey,
    PortalAuthConfigResponse,
    PortalAuthConfigUpdate,
    PskPolicy,
    PxGridAccountCreateResponse,
    PxGridSettingsResponse,
    PxGridSettingsUpdate,
    PxGridStatusResponse,
    PxGridTestResponse,
    TacacsTestRequest,
    TacacsTestResponse,
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
        cache_enabled=s.cache_enabled,
        cache_ttl_seconds=s.cache_ttl_seconds,
        cache_stale_while_revalidate=s.cache_stale_while_revalidate,
        cache_sync_interval_seconds=s.cache_sync_interval_seconds,
        cache_disk_path=s.cache_disk_path,
        cache_prewarm_concurrency=s.cache_prewarm_concurrency,
        cache_prewarm_interval_s=s.cache_prewarm_interval_s,
    )


async def update_backend_settings(
    new: BackendSettingsUpdate,
) -> BackendSettingsResponse:
    before = get_backend_settings().model_dump()
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
            "cache_enabled": new.cache_enabled,
            "cache_ttl_seconds": new.cache_ttl_seconds,
            "cache_stale_while_revalidate": new.cache_stale_while_revalidate,
            "cache_sync_interval_seconds": new.cache_sync_interval_seconds,
            "cache_disk_path": new.cache_disk_path,
            "cache_prewarm_concurrency": new.cache_prewarm_concurrency,
            "cache_prewarm_interval_s": new.cache_prewarm_interval_s,
        }
    )
    if new.ise_password:
        overrides["ise_password"] = new.ise_password
    save_overrides(overrides)
    config.refresh_settings()
    await close_ise_client()
    # Drop cached ISE reads — URL or api-type may have changed under us.
    get_cache().invalidate_all()
    logger.info(
        "backend settings updated: url=%s user=%s api=%s coa_psn=%s coa_type=%d",
        new.ise_base_url,
        new.ise_username,
        new.ise_api_type,
        new.coa_psn_name or "(auto)",
        new.coa_reauth_type,
    )
    after = get_backend_settings().model_dump()
    await audit_store.record(
        "updated",
        "backend_settings",
        None,
        before=before,
        after={**after, "ise_password_changed": bool(new.ise_password)},
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


# ── PxGrid (3.0.0) ─────────────────────────────────────────────────────


def get_pxgrid_settings() -> PxGridSettingsResponse:
    s = config.settings
    return PxGridSettingsResponse(
        pxgrid_enabled=s.pxgrid_enabled,
        pxgrid_node_name=s.pxgrid_node_name,
        pxgrid_psn_fqdn=s.pxgrid_psn_fqdn,
        pxgrid_cert_mode=s.pxgrid_cert_mode,  # type: ignore[arg-type]
        pxgrid_cert_path=s.pxgrid_cert_path,
        pxgrid_key_path=s.pxgrid_key_path,
        pxgrid_ca_bundle_path=s.pxgrid_ca_bundle_path,
        pxgrid_password_set=bool(s.pxgrid_password),
        pxgrid_cert_extra_sans=s.pxgrid_cert_extra_sans,
        pxgrid_session_topic=s.pxgrid_session_topic,
        pxgrid_stomp_heartbeat_ms=s.pxgrid_stomp_heartbeat_ms,
        pxgrid_stomp_reconnect_min_s=s.pxgrid_stomp_reconnect_min_s,
        pxgrid_stomp_reconnect_max_s=s.pxgrid_stomp_reconnect_max_s,
        pxgrid_session_cache_max_age_s=s.pxgrid_session_cache_max_age_s,
        pxgrid_worker_enabled=s.pxgrid_worker_enabled,
        pxgrid_endpoint_topic_enabled=s.pxgrid_endpoint_topic_enabled,
        pxgrid_endpoint_topic=s.pxgrid_endpoint_topic,
        pxgrid_endpoint_service=s.pxgrid_endpoint_service,
        cert_status=pxgrid_cert_manager.cert_status(
            s.pxgrid_cert_path, s.pxgrid_key_path, s.pxgrid_ca_bundle_path
        ),
    )


async def update_pxgrid_settings(
    new: PxGridSettingsUpdate,
) -> PxGridSettingsResponse:
    before = get_pxgrid_settings().model_dump()
    overrides = load_overrides()
    overrides.update(
        {
            "pxgrid_enabled": new.pxgrid_enabled,
            "pxgrid_node_name": new.pxgrid_node_name,
            "pxgrid_psn_fqdn": new.pxgrid_psn_fqdn,
            "pxgrid_cert_mode": new.pxgrid_cert_mode,
            "pxgrid_cert_path": new.pxgrid_cert_path,
            "pxgrid_key_path": new.pxgrid_key_path,
            "pxgrid_ca_bundle_path": new.pxgrid_ca_bundle_path,
            "pxgrid_cert_extra_sans": new.pxgrid_cert_extra_sans,
            "pxgrid_session_topic": new.pxgrid_session_topic,
            "pxgrid_stomp_heartbeat_ms": new.pxgrid_stomp_heartbeat_ms,
            "pxgrid_stomp_reconnect_min_s": new.pxgrid_stomp_reconnect_min_s,
            "pxgrid_stomp_reconnect_max_s": new.pxgrid_stomp_reconnect_max_s,
            "pxgrid_session_cache_max_age_s": new.pxgrid_session_cache_max_age_s,
            "pxgrid_worker_enabled": new.pxgrid_worker_enabled,
            "pxgrid_endpoint_topic_enabled": new.pxgrid_endpoint_topic_enabled,
            "pxgrid_endpoint_topic": new.pxgrid_endpoint_topic,
            "pxgrid_endpoint_service": new.pxgrid_endpoint_service,
        }
    )
    if new.pxgrid_password:
        overrides["pxgrid_password"] = new.pxgrid_password
    save_overrides(overrides)
    config.refresh_settings()
    # Restart worker so new tunables (heart-beat, backoff, topic) tager effekt
    # uden full backend-restart. Best-effort: spis fejl så save altid lykkes.
    try:
        from app.pxgrid.session_worker import get_worker

        worker = get_worker()
        await worker.stop()
        worker.start()
    except Exception as exc:  # noqa: BLE001
        logger.warning("kunne ikke restarte pxgrid worker: %s", exc)
    logger.info(
        "pxgrid settings updated: enabled=%s node=%s psn=%s mode=%s",
        new.pxgrid_enabled,
        new.pxgrid_node_name,
        new.pxgrid_psn_fqdn or "(auto)",
        new.pxgrid_cert_mode,
    )
    after = get_pxgrid_settings().model_dump()
    await audit_store.record(
        "updated",
        "backend_settings",
        "pxgrid",
        before=before,
        after={**after, "pxgrid_password_changed": bool(new.pxgrid_password)},
    )
    return get_pxgrid_settings()


async def test_pxgrid_connection() -> PxGridTestResponse:
    """Walk cert → TLS → ServiceLookup so admin sees which step failed."""
    s = config.settings
    if not s.pxgrid_enabled:
        return PxGridTestResponse(
            ok=False,
            step="cert_load",
            message="PxGrid er deaktiveret — slå pxgrid_enabled til først.",
        )
    start = time.perf_counter()
    client = PxGridClient()
    try:
        result = await client.connectivity_test()
    except Exception as exc:  # noqa: BLE001
        return PxGridTestResponse(
            ok=False, step="tls_handshake", message=f"Uventet fejl: {exc}"
        )
    latency_ms = int((time.perf_counter() - start) * 1000)
    return PxGridTestResponse(
        ok=bool(result.get("ok")),
        step=result.get("step", "unknown"),
        message=result.get("message", ""),
        latency_ms=latency_ms,
        services_found=result.get("services_found", []),
    )


def get_pxgrid_status() -> PxGridStatusResponse:
    """Live runtime state. Phase 1 only knows config-time state.

    Phase 2 will populate ``services`` and ``last_error`` from the
    background STOMP worker. For now we return a probe-able snapshot.
    """
    s = config.settings
    return PxGridStatusResponse(
        enabled=s.pxgrid_enabled,
        account_state="UNKNOWN",
        services=[],
        last_error="",
        psn_fqdn=s.pxgrid_psn_fqdn,
    )


async def pxgrid_account_create() -> PxGridAccountCreateResponse:
    """Register the portal as a new pxGrid client (typically CSR-mode).

    Hovedscenariet er CSR-mode: portalen skal selv registrere sig før ISE
    udsteder secret. Gaten er dog ikke hård — admin kan også køre dette i
    upload-mode hvis ISE-pxGrid-konfigurationen kræver eksplicit AccountCreate
    (f.eks. ved skiftet PSN/CN). Selve kaldet er ikke-destruktivt: ISE returnerer
    enten PENDING (afventer approval) eller en eksisterende state.
    """
    s = config.settings
    if not s.pxgrid_node_name:
        return PxGridAccountCreateResponse(
            ok=False,
            node_name="",
            account_state="N/A",
            password_received=False,
            message="pxgrid_node_name skal være sat — gem PxGrid-settings først.",
        )
    client = PxGridClient()
    try:
        result = await client.account_create()
    except Exception as exc:  # noqa: BLE001
        # ISE 3.4 returnerer 503 på AccountCreate når klienten *allerede* er
        # registreret (i stedet for den idempotente success som pxGrid 2.0-spec'et
        # foreskriver). Hvis vi har en gemt pxgrid_password er en tidligere
        # AccountCreate lykkedes — fald tilbage på AccountActivate for at
        # rapportere den faktiske state (PENDING/ENABLED/DISABLED) i stedet
        # for at fejle Trin 5 med en misvisende 503.
        if "503" in str(exc) and s.pxgrid_password:
            try:
                activate = await client.account_activate()
                state = (activate.get("accountState") or "ENABLED").upper()
                return PxGridAccountCreateResponse(
                    ok=True,
                    node_name=s.pxgrid_node_name,
                    account_state=state,
                    password_received=True,
                    message=(
                        f"Kontoen er allerede registreret hos ISE og er {state}. "
                        f"AccountCreate er idempotent her — du kan gå videre "
                        f"til 'Test PxGrid forbindelse'."
                    ),
                )
            except PxGridAccountPendingError:
                return PxGridAccountCreateResponse(
                    ok=True,
                    node_name=s.pxgrid_node_name,
                    account_state="PENDING",
                    password_received=True,
                    message=(
                        "Kontoen er registreret men afventer admin-approval i "
                        "ISE → Administration → pxGrid Services → All Clients."
                    ),
                )
            except Exception as inner:  # noqa: BLE001
                # Activate fejlede også — så er det en reel fejl. Rapporter
                # begge dele så admin ved hvad der skete.
                return PxGridAccountCreateResponse(
                    ok=False,
                    node_name=s.pxgrid_node_name,
                    account_state="ERROR",
                    password_received=bool(s.pxgrid_password),
                    message=(
                        f"AccountCreate gav 503 (klient findes allerede), men "
                        f"AccountActivate fejlede også: {inner}"
                    ),
                )
        return PxGridAccountCreateResponse(
            ok=False,
            node_name=s.pxgrid_node_name,
            account_state="ERROR",
            password_received=False,
            message=f"AccountCreate fejlede: {exc}",
        )
    state = (result.get("accountState") or "UNKNOWN").upper()
    password = result.get("password", "")
    if password:
        # Persist the per-node secret so subsequent calls can authenticate.
        overrides = load_overrides()
        overrides["pxgrid_password"] = password
        save_overrides(overrides)
        config.refresh_settings()
    msg = (
        "Klient registreret — afventer admin-approval i ISE pxGrid Services."
        if state == "PENDING"
        else f"AccountCreate OK — accountState={state}"
    )
    return PxGridAccountCreateResponse(
        ok=True,
        node_name=s.pxgrid_node_name,
        account_state=state,
        password_received=bool(password),
        message=msg,
    )


async def pxgrid_stomp_probe(duration_s: float = 10.0) -> "PxGridStompProbeResponse":
    """Run a one-shot subscribe+listen probe against the pubsub broker.

    Tynd wrapper rundt om ``probe.run_session_probe`` der mapper det interne
    ``ProbeResult``-dataclass til response-schema'et. Bruges af UI'ets
    "Test STOMP-subscription"-knap til at verificere at WebSocket-laget
    virker før vi bygger persistent worker ovenpå.
    """
    from app.pxgrid import probe
    from app.schemas.settings import PxGridStompProbeResponse

    duration_s = max(1.0, min(duration_s, 60.0))
    result = await probe.run_session_probe(duration_s)
    return PxGridStompProbeResponse(
        ok=result.ok,
        step=result.step,
        duration_s=round(result.duration_s, 2),
        messages_received=result.messages_received,
        sample_payloads=result.sample_payloads,
        ws_url=result.ws_url,
        peer_node=result.peer_node,
        error=result.error,
    )


async def pxgrid_reset() -> "PxGridResetResponse":
    """Nulstil portal-side pxGrid-registrering.

    Sletter cert/key/CA/CSR-filerne fra disk og rydder de tilhørende paths
    + gemt password fra settings. Beholder config-niveau felter (enabled,
    node_name, psn_fqdn, cert_mode) så admin ikke skal indtaste dem igen
    før de kører CSR-flowet forfra.

    Bruges typisk efter (a) skift af ISE-server (klient-entry'en på den
    gamle server matcher ikke længere), (b) cert er udløbet eller forkert
    udstedt, (c) admin vil bare starte rent. Idempotent — sletter kun det
    der findes, fejler ikke ved manglende filer.
    """
    from app.schemas.settings import PxGridResetResponse

    s = config.settings
    before = get_pxgrid_settings().model_dump()
    deleted_files: list[str] = []
    if s.pxgrid_node_name:
        deleted_files = pxgrid_cert_manager.delete_artifacts(s.pxgrid_node_name)

    overrides = load_overrides()
    overrides.update(
        {
            "pxgrid_cert_path": "",
            "pxgrid_key_path": "",
            "pxgrid_ca_bundle_path": "",
            "pxgrid_password": "",
        }
    )
    save_overrides(overrides)
    config.refresh_settings()

    after = get_pxgrid_settings().model_dump()
    await audit_store.record(
        "reset",
        "backend_settings",
        "pxgrid",
        before=before,
        after={**after, "files_deleted": deleted_files},
    )

    msg = (
        f"PxGrid-registrering nulstillet — slettede {len(deleted_files)} fil(er) "
        f"({', '.join(deleted_files) if deleted_files else 'ingen filer fundet'}) "
        f"og ryddede gemt password + cert-paths. Kør CSR-flowet eller PFX-import "
        f"forfra for at registrere klienten igen."
    )
    return PxGridResetResponse(ok=True, files_deleted=deleted_files, message=msg)


# ── PSK-politik (3.11.0) ────────────────────────────────────────────────

def get_psk_policy() -> PskPolicy:
    s = config.settings
    return PskPolicy(
        psk_type=str(getattr(s, "psk_type", "MPSK")).upper() or "MPSK",
        show_key_in_table=bool(getattr(s, "psk_show_key_in_table", False)),
        min_length=int(getattr(s, "psk_min_length", 8)),
        require_uppercase=bool(getattr(s, "psk_require_uppercase", False)),
        require_numbers=bool(getattr(s, "psk_require_numbers", False)),
        require_special=bool(getattr(s, "psk_require_special", False)),
    )


async def update_psk_policy(new: PskPolicy) -> PskPolicy:
    before = get_psk_policy().model_dump()
    overrides = load_overrides()
    psk_type = new.psk_type.upper() if new.psk_type in ("MPSK", "IPSK") else "MPSK"
    overrides.update(
        {
            "psk_type": psk_type,
            "psk_show_key_in_table": new.show_key_in_table,
            "psk_min_length": new.min_length,
            "psk_require_uppercase": new.require_uppercase,
            "psk_require_numbers": new.require_numbers,
            "psk_require_special": new.require_special,
        }
    )
    save_overrides(overrides)
    config.refresh_settings()
    logger.info("psk policy updated: %s", new.model_dump())
    await audit_store.record(
        "updated",
        "psk_policy",
        None,
        before=before,
        after=new.model_dump(),
    )
    return get_psk_policy()


def validate_psk_key(key: str, policy: PskPolicy | None = None) -> list[str]:
    """Returnér liste af valideringsfejl (tom = godkendt)."""
    p = policy or get_psk_policy()
    errors: list[str] = []
    if len(key) < p.min_length:
        errors.append(f"PSK-nøgle skal være mindst {p.min_length} tegn")
    if p.require_uppercase and not any(c.isupper() for c in key):
        errors.append("PSK-nøgle skal indeholde mindst ét stort bogstav")
    if p.require_numbers and not any(c.isdigit() for c in key):
        errors.append("PSK-nøgle skal indeholde mindst ét tal")
    if p.require_special and not any(c in string.punctuation for c in key):
        errors.append("PSK-nøgle skal indeholde mindst ét specialtegn")
    return errors


def generate_psk_key(policy: PskPolicy | None = None) -> GeneratedPskKey:
    """Generér en PSK-nøgle der overholder den aktive politik."""
    p = policy or get_psk_policy()
    lowercase = string.ascii_lowercase
    uppercase = string.ascii_uppercase
    digits = string.digits
    special = "!@#$%^&*-_=+"

    # Opbyg med garanterede tegn for hver aktiveret krav
    required: list[str] = []
    if p.require_uppercase:
        required.append(random.choice(uppercase))
    if p.require_numbers:
        required.append(random.choice(digits))
    if p.require_special:
        required.append(random.choice(special))

    pool = lowercase + uppercase + digits
    if p.require_special:
        pool += special

    # Fyld op til min_length + lidt ekstra for god entropi (min 12)
    target_len = max(p.min_length, 12)
    remaining = target_len - len(required)
    required += [random.choice(pool) for _ in range(remaining)]

    random.shuffle(required)
    return GeneratedPskKey(key="".join(required))


# ── Portal Auth Config (TACACS+) ─────────────────────────────────────────────

def get_portal_auth_config() -> PortalAuthConfigResponse:
    from app.core.auth_config_store import load as load_auth_config
    data = load_auth_config()
    return PortalAuthConfigResponse(
        auth_mode=data["auth_mode"],
        tacacs_server_host=data["tacacs_server_host"],
        tacacs_server_port=data["tacacs_server_port"],
        tacacs_secret_set=bool(data.get("tacacs_secret")),
        tacacs_timeout_seconds=data["tacacs_timeout_seconds"],
        tacacs_fallback_to_local=data["tacacs_fallback_to_local"],
        tacacs_role_attribute=data["tacacs_role_attribute"],
        tacacs_operator_profile_attribute=data["tacacs_operator_profile_attribute"],
    )


async def update_portal_auth_config(new: PortalAuthConfigUpdate) -> PortalAuthConfigResponse:
    from app.core.auth_config_store import load as load_auth_config, save as save_auth_config
    before = get_portal_auth_config().model_dump()
    data = load_auth_config()
    data["auth_mode"] = new.auth_mode
    data["tacacs_server_host"] = new.tacacs_server_host
    data["tacacs_server_port"] = new.tacacs_server_port
    data["tacacs_timeout_seconds"] = new.tacacs_timeout_seconds
    data["tacacs_fallback_to_local"] = new.tacacs_fallback_to_local
    data["tacacs_role_attribute"] = new.tacacs_role_attribute
    data["tacacs_operator_profile_attribute"] = new.tacacs_operator_profile_attribute
    if new.tacacs_secret:
        data["tacacs_secret"] = new.tacacs_secret
    save_auth_config(data)
    logger.info(
        "portal auth config updated: mode=%s tacacs_host=%s",
        new.auth_mode,
        new.tacacs_server_host or "(none)",
    )
    after = get_portal_auth_config().model_dump()
    await audit_store.record(
        "updated",
        "portal_auth_config",
        None,
        before=before,
        after={**after, "tacacs_secret_changed": bool(new.tacacs_secret)},
    )
    return get_portal_auth_config()


def test_tacacs_connection(req: TacacsTestRequest) -> TacacsTestResponse:
    """Test TACACS+ auth+authz without persisting settings."""
    from app.core.auth_config_store import load as load_auth_config
    from app.services.tacacs_service import authenticate_and_authorize

    data = load_auth_config()
    host = req.server_host or data["tacacs_server_host"]
    port = req.server_port or data["tacacs_server_port"]
    secret = req.secret or data.get("tacacs_secret", "")
    timeout = req.timeout_seconds or data["tacacs_timeout_seconds"]
    role_attr = data["tacacs_role_attribute"]
    profile_attr = data["tacacs_operator_profile_attribute"]

    if not host or not secret:
        return TacacsTestResponse(
            ok=False,
            message="TACACS+ server host og secret skal være konfigureret",
        )

    result = authenticate_and_authorize(
        username=req.username,
        password=req.password,
        server_host=host,
        server_port=port,
        secret=secret,
        timeout=timeout,
        role_attribute=role_attr,
        operator_profile_attribute=profile_attr,
    )
    if not result.success:
        return TacacsTestResponse(ok=False, message=result.error or "Auth fejlede")

    return TacacsTestResponse(
        ok=True,
        message="TACACS+ auth og authz lykkedes",
        role=result.role,
        operator_profile=result.operator_profile_name,
    )
