from fastapi import APIRouter, Depends

from app.api.deps import require_admin
from app.schemas.settings import (
    BackendSettingsResponse,
    BackendSettingsUpdate,
    TestConnectionRequest,
    TestConnectionResponse,
)
from app.services import settings_service

router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)]
)


@router.get("/backend", response_model=BackendSettingsResponse)
async def read_backend_settings() -> BackendSettingsResponse:
    return settings_service.get_backend_settings()


@router.put("/backend", response_model=BackendSettingsResponse)
async def update_backend_settings(
    req: BackendSettingsUpdate,
) -> BackendSettingsResponse:
    return await settings_service.update_backend_settings(req)


@router.post("/test", response_model=TestConnectionResponse)
async def test_backend_connection(
    req: TestConnectionRequest,
) -> TestConnectionResponse:
    """Verify ISE reachability + credentials without saving."""
    return await settings_service.test_connection(req)
