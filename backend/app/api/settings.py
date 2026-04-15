from fastapi import APIRouter

from app.schemas.settings import BackendSettingsResponse, BackendSettingsUpdate
from app.services import settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/backend", response_model=BackendSettingsResponse)
async def read_backend_settings() -> BackendSettingsResponse:
    return settings_service.get_backend_settings()


@router.put("/backend", response_model=BackendSettingsResponse)
async def update_backend_settings(
    req: BackendSettingsUpdate,
) -> BackendSettingsResponse:
    return await settings_service.update_backend_settings(req)
