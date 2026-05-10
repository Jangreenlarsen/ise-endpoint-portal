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
    UserMe,
)
from app.services import settings_service, user_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
async def auth_status(request: Request) -> AuthStatus:
    setup = user_service.setup_required()
    default_lang = settings_service.get_portal_locale().default_language
    header = request.headers.get("Authorization", "")
    if setup or not header.startswith("Bearer "):
        return AuthStatus(setup_required=setup, authenticated=False, user=None, default_language=default_lang)
    token = header[7:].strip()
    payload = auth_core.verify_token(token)
    if not payload:
        return AuthStatus(setup_required=False, authenticated=False, user=None, default_language=default_lang)
    try:
        if payload.get("auth_type") == "tacacs":
            from app.schemas.user import ROLE_VALUES
            role = payload.get("role")
            if not role or role not in ROLE_VALUES:
                return AuthStatus(setup_required=False, authenticated=False, user=None, default_language=default_lang)
            from app.schemas.user import User as UserModel
            user = UserModel(
                id=f"tacacs:{payload.get('username', '')}",
                username=payload.get("username", ""),
                role=role,
                created_at="",
                last_login=None,
                assigned_endpoint_roles=list(payload.get("endpoint_roles") or []),
                assigned_templates=[],
            )
        else:
            user = user_service.get_user(payload["sub"])
    except Exception:
        return AuthStatus(setup_required=False, authenticated=False, user=None, default_language=default_lang)
    return AuthStatus(setup_required=False, authenticated=True, user=user, default_language=default_lang)


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


@router.get("/me", response_model=UserMe)
async def me(user: User = Depends(get_current_user)) -> UserMe:
    if user.id.startswith("tacacs:"):
        from app.services.user_service import effective_roles
        return UserMe(
            **user.model_dump(),
            effective_roles=effective_roles(user),
        )
    return user_service.get_user_me(user.id)


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    if user.id.startswith("tacacs:"):
        from fastapi import HTTPException, status as http_status
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            "TACACS+-autentiserede brugere kan ikke skifte password her — kontakt din netværksadministrator",
        )
    await user_service.change_password(user.id, req)
    return {"status": "ok"}
