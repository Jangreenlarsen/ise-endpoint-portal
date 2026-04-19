from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_user
from app.core import auth as auth_core
from app.schemas.user import (
    AuthStatus,
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    SetupRequest,
    User,
)
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
async def auth_status(request: Request) -> AuthStatus:
    setup = user_service.setup_required()
    header = request.headers.get("Authorization", "")
    if setup or not header.startswith("Bearer "):
        return AuthStatus(setup_required=setup, authenticated=False, user=None)
    token = header[7:].strip()
    payload = auth_core.verify_token(token)
    if not payload:
        return AuthStatus(setup_required=False, authenticated=False, user=None)
    try:
        user = user_service.get_user(payload["sub"])
    except Exception:
        return AuthStatus(setup_required=False, authenticated=False, user=None)
    return AuthStatus(setup_required=False, authenticated=True, user=user)


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    return user_service.login(req)


@router.post("/logout")
async def logout() -> dict[str, str]:
    # Stateless token — client simply discards it.
    return {"status": "ok"}


@router.post("/setup", response_model=LoginResponse)
async def setup(req: SetupRequest) -> LoginResponse:
    return user_service.setup_first_admin(req)


@router.get("/me", response_model=User)
async def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    user_service.change_password(user.id, req)
    return {"status": "ok"}
