from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import audit as audit_api
from app.api import auth as auth_api
from app.api import cache as cache_api
from app.api import custom_attributes as custom_attrs_api
from app.api import dacls as dacls_api
from app.api import endpoint_roles as endpoint_roles_api
from app.api import endpoints, groups, health, logs, me, oui, users
from app.api import pxgrid as pxgrid_api
from app.api import settings as settings_api
from app.core.audit_store import init_db as init_audit_db
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.version import FULL as APP_VERSION, VERSION
from app.ise.client import close_ise_client
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
    get_cache_sync_worker().start()
    get_audit_retention_worker().start()
    get_pxgrid_worker().start()
    get_prewarm_worker().start()
    try:
        yield
    finally:
        await get_prewarm_worker().stop()
        await get_pxgrid_worker().stop()
        await get_audit_retention_worker().stop()
        await get_cache_sync_worker().stop()
        await close_ise_client()


app = FastAPI(
    title="HyperVision ISE Portal",
    version=VERSION,
    lifespan=lifespan,
)

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
app.include_router(logs.router, prefix="/api")
app.include_router(cache_api.router, prefix="/api")
app.include_router(audit_api.router, prefix="/api")
app.include_router(oui.router, prefix="/api")
app.include_router(endpoint_roles_api.router, prefix="/api")
app.include_router(pxgrid_api.router, prefix="/api")
app.include_router(me.router, prefix="/api")

frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
