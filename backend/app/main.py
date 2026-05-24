# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import audit as audit_api
from app.api import metrics_api
from app.core.rate_limiter import RateLimitMiddleware
from app.api import alerts as alerts_api
from app.api import auth as auth_api
from app.api import cache as cache_api
from app.api import custom_attributes as custom_attrs_api
from app.api import dacls as dacls_api
from app.api import dashboard as dashboard_api
from app.api import endpoint_roles as endpoint_roles_api
from app.api import endpoints, endpoints_ops, groups, health, logs, me, oui, users
from app.api import ise_nodes as ise_nodes_api
from app.api import lifecycle as lifecycle_api
from app.api import config_backup as config_backup_api
from app.api import templates as templates_api
from app.api import pxgrid as pxgrid_api
from app.api import authz_profiles as authz_profiles_api
from app.api import policy as policy_api
from app.api import settings as settings_api
from app.api import update as update_api
from app.api import trends as trends_api
from app.core.audit_store import init_db as init_audit_db
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.watchdog import beat as watchdog_beat, start_watchdog
from app.core.version import FULL as APP_VERSION, VERSION
from app.ise.client import close_ise_client
from app.pxgrid.session_cache import get_cache as get_session_cache
from app.pxgrid.session_worker import _enrich_sessions_from_mnt, reconcile_stale_sessions, get_worker as get_pxgrid_worker
from app.services.audit_retention import get_worker as get_audit_retention_worker
from app.services.cache_prewarm import get_worker as get_prewarm_worker
from app.services.cache_sync import get_worker as get_cache_sync_worker


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    import logging
    logger = logging.getLogger(__name__)
    logger.info("HyperVision ISE Portal %s starting", APP_VERSION)

    # ── Sikkerheds-tjek ved opstart ──────────────────────────────────────────
    _ca_bundle = getattr(settings, "ise_ca_bundle", None)
    if not settings.ise_verify_tls and not _ca_bundle:
        logger.warning(
            "SECURITY: ISE TLS-verificering er DEAKTIVERET (ISE_VERIFY_TLS=false). "
            "Man-in-the-Middle-angreb på ISE-kommunikation er mulige. "
            "Sæt ISE_VERIFY_TLS=true og angiv ISE_CA_BUNDLE i produktion."
        )
    _dev_origins = [
        o for o in settings.backend_cors_origins
        if "localhost" in o or "127.0.0.1" in o
    ]
    if _dev_origins:
        logger.warning(
            "SECURITY: CORS indeholder udviklings-origins: %s. "
            "Fjern disse inden produktionsdrift (BACKEND_CORS_ORIGINS i .env).",
            _dev_origins,
        )

    # Eager load af auth-secret — filrettigheds-check sker ved startup
    # (ikke mid-request) så en evt. os._exit(1) ikke sprænger ASGI-stacken.
    from app.core import auth as _auth_core
    _auth_core._secret()
    init_audit_db()
    from app.core.first_seen_store import init_db as init_first_seen_db
    init_first_seen_db()
    try:
        from app.core.lockout_store import init_db as init_lockout_db
        init_lockout_db()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("lockout_store init fejlede (non-fatal, bruger in-memory fallback): %s", _exc)
    # 3.8.0: backfill System adm-rolle for hver eksisterende bruger så admin
    # kan tagge endpoints med username via rolle-katalogen. Idempotent.
    # Migrate legacy role names: registrar→registrant, registrar_templet→registrant_templet.
    try:
        from app.core.user_store import load_users, save_users as _save_users
        _users = load_users()
        _role_renames = {"registrar": "registrant", "registrar_templet": "registrant_templet"}
        _migrated = 0
        for _u in _users:
            if _u.get("role") in _role_renames:
                _u["role"] = _role_renames[_u["role"]]
                _migrated += 1
        if _migrated:
            _save_users(_users)
            logger.info("role migration: renamed %d user(s) registrar→registrant", _migrated)
    except Exception as exc:  # noqa: BLE001
        logger.warning("role migration fejlede: %s", exc)
    try:
        from app.core import role_catalog
        from app.core.user_store import load_users
        usernames = [u.get("username") for u in load_users() if u.get("username")]
        result = role_catalog.backfill_user_roles(usernames)
        if result["created"] > 0:
            logger.info(
                "System adm-rolle backfill: created=%d skipped=%d invalid=%d",
                result["created"], result["skipped"], result["invalid"],
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("System adm-rolle backfill fejlede: %s", exc)
    # Indlæs disk-cache synkront FØR yield så endpoints er tilgængelige
    # fra allerførste HTTP-request (ingen race-condition med async task).
    get_prewarm_worker().preload_disk_cache()

    # Indlæs pxGrid session-cache fra disk — overlever genstart.
    _sess_disk_str = getattr(settings, "pxgrid_session_disk_path", "cache/sessions.json")
    _sess_cache_path = None
    if _sess_disk_str:
        _sess_cache_path = Path(_sess_disk_str)
        if not _sess_cache_path.is_absolute():
            _sess_cache_path = Path(__file__).resolve().parents[2] / _sess_cache_path
        # Disk-sessions ældre end max_age kasseres — forhindrer meget stale VLAN/auth-data
        # i Browse-vinduet inden pxGrid-reconcile er færdig (standard: 4 timer).
        _sess_disk_max_age = float(getattr(settings, "pxgrid_session_disk_max_age_s", 14400.0))
        _n = get_session_cache().load_from_disk(_sess_cache_path, max_age_s=_sess_disk_max_age)
        logger.info("pxGrid session cache: indlæst %d sessioner fra disk ved start", _n)

    start_watchdog(timeout_s=120)

    async def _heartbeat_loop():
        while True:
            watchdog_beat()
            await asyncio.sleep(10)

    _heartbeat_task = asyncio.create_task(_heartbeat_loop(), name="watchdog-heartbeat")

    from app.pxgrid.anomaly_detector import AnomalyDetector
    AnomalyDetector(get_session_cache())

    get_cache_sync_worker().start()
    get_audit_retention_worker().start()
    get_pxgrid_worker().start()
    get_prewarm_worker().start()

    # Periodisk autosave af session-cache til disk.
    _autosave_interval = float(getattr(settings, "pxgrid_session_autosave_interval_s", 300.0))

    async def _session_autosave_loop():
        if not _sess_cache_path or _autosave_interval <= 0:
            return
        while True:
            await asyncio.sleep(_autosave_interval)
            get_session_cache().save_to_disk(_sess_cache_path)

    _autosave_task = asyncio.create_task(_session_autosave_loop(), name="session-cache-autosave")

    # Periodisk MnT-berigelse af session-cache (ISEPolicySetName, authorizationRuleName, m.m.).
    # Venter 45s ved start (pxGrid-worker når at forbinde + reconcile), derefter hvert 5. min.
    async def _mnt_enrich_loop():
        await asyncio.sleep(45)
        while True:
            await _enrich_sessions_from_mnt(get_session_cache())
            await asyncio.sleep(300)

    _mnt_enrich_task = asyncio.create_task(_mnt_enrich_loop(), name="mnt-session-enrich")

    # Periodisk MnT-reconciliation for stale endpoint-cache entries.
    # Fanger endpoints hvis pxGrid push-events er gået tabt (WSS timeout,
    # PSN failover, network glitch). Venter 2 min ved start, kører hvert 10. min.
    _mnt_stale_reconcile_interval = float(
        getattr(settings, "mnt_stale_reconcile_interval_s", 600.0)
    )

    async def _mnt_stale_reconcile_loop():
        await asyncio.sleep(120)
        _max_batch = int(getattr(settings, "mnt_stale_reconcile_max_batch", 100))
        while True:
            await reconcile_stale_sessions(get_session_cache(), max_batch=_max_batch)
            await asyncio.sleep(_mnt_stale_reconcile_interval)

    _mnt_stale_task = asyncio.create_task(
        _mnt_stale_reconcile_loop(), name="mnt-stale-reconcile"
    )

    async def _alert_check_loop() -> None:
        await asyncio.sleep(30)
        while True:
            from app.core.alert_store import check_conditions
            check_conditions()
            await asyncio.sleep(60)

    _alert_task = asyncio.create_task(_alert_check_loop(), name="alert-check")

    try:
        yield
    finally:
        _heartbeat_task.cancel()
        _autosave_task.cancel()
        _mnt_enrich_task.cancel()
        _mnt_stale_task.cancel()
        _alert_task.cancel()
        try:
            await _heartbeat_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        try:
            await _autosave_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        try:
            await _mnt_enrich_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        try:
            await _alert_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        await get_prewarm_worker().stop()
        await get_pxgrid_worker().stop()
        await get_audit_retention_worker().stop()
        await get_cache_sync_worker().stop()
        if _sess_cache_path:
            get_session_cache().save_to_disk(_sess_cache_path)
            logger.info("pxGrid session cache: gemt til disk ved shutdown")
        await close_ise_client()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Tilføjer grundlæggende HTTP sikkerhedsheadere til alle svar."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        # Ingen browser-caching af JS/CSS — sikrer at nye versioner altid indlæses
        if request.url.path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(self)"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # CSP: tillad kun ressourcer fra samme origin; inline scripts/styles er
        # nødvendige i den nuværende vanilla-JS arkitektur.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none';"
        )
        return response


app = FastAPI(
    title="HyperVision ISE Portal",
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth_api.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(endpoints.router, prefix="/api")
app.include_router(endpoints_ops.router, prefix="/api")
app.include_router(groups.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(settings_api.psk_router, prefix="/api")
app.include_router(custom_attrs_api.router, prefix="/api")
app.include_router(dacls_api.router, prefix="/api")
app.include_router(authz_profiles_api.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(cache_api.router, prefix="/api")
app.include_router(audit_api.router, prefix="/api")
app.include_router(oui.router, prefix="/api")
app.include_router(endpoint_roles_api.router, prefix="/api")
app.include_router(settings_api.auth_config_router, prefix="/api")
app.include_router(settings_api.locale_router, prefix="/api")
app.include_router(pxgrid_api.router, prefix="/api")
app.include_router(me.router, prefix="/api")
app.include_router(update_api.router, prefix="/api")
app.include_router(templates_api.router, prefix="/api")
app.include_router(policy_api.router, prefix="/api")
app.include_router(dashboard_api.router, prefix="/api")
app.include_router(alerts_api.router, prefix="/api")
app.include_router(lifecycle_api.router, prefix="/api")
app.include_router(config_backup_api.router, prefix="/api")
app.include_router(trends_api.router, prefix="/api")
app.include_router(ise_nodes_api.router, prefix="/api")
app.include_router(metrics_api.router)

frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
