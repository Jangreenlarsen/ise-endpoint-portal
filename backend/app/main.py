from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import custom_attributes as custom_attrs_api
from app.api import endpoints, groups, health
from app.api import settings as settings_api
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.version import FULL as APP_VERSION, VERSION
from app.ise.client import close_ise_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    import logging
    logging.getLogger(__name__).info("HyperVision ISE Portal %s starting", APP_VERSION)
    yield
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
app.include_router(endpoints.router, prefix="/api")
app.include_router(groups.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(custom_attrs_api.router, prefix="/api")

frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
