import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import audit as audit_api
from app.api import metrics_api
from app.core.rate_limiter import RateLimitMiddleware
from app.api import auth as auth_api
from app.api import cache as cache_api
from app.api import custom_attributes as custom_attrs_api
from app.api import dacls as dacls_api
from app.api import endpoint_roles as endpoint_roles_api
from app.api import endpoints, groups, health, logs, me, oui, users
from app.api import templates as templates_api
from app.api import pxgrid as pxgrid_api
from app.api import authz_profiles as authz_profiles_api
from app.api import policy as policy_api
from app.api import settings as settings_api
from app.api import update as update_api
from app.core.audit_store import init_db as init_audit_db
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.version import FULL as APP_VERSION, VERSION
from app.ise.client import close_ise_client
from app.pxgrid.session_cache import get_cache as get_session_cache
from app.pxgrid.session_worker import get_worker as get_pxgrid_worker
from app.services.audit_retention import get_worker as get_audit_retention_worker
from app.services.cache_prewarm import get_worker as get_prewarm_worker
from app.services.cache_sync import get_worker as get_cache_sync_worker


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    import logging
    logger = logging.getLogger(__name__)
    logger.info("HyperVision ISE Portal %s starting", APP_VERSION)
    init_audit_db()
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
        _n = get_session_cache().load_from_disk(_sess_cache_path)
        logger.info("pxGrid session cache: indlæst %d sessioner fra disk ved start", _n)

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

    try:
        yield
    finally:
        _autosave_task.cancel()
        try:
            await _autosave_task
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


app = FastAPI(
    title="HyperVision ISE Portal",
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth_api.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(endpoints.router, prefix="/api")
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
app.include_router(metrics_api.router)

frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
