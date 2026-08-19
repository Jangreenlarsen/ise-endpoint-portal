# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from app.core import audit_store

from app.api.deps import get_current_user
from app.core import auth as auth_core
from app.core.auth import TOKEN_COOKIE_NAME, TOKEN_TTL_SECONDS
from app.core.user_store import (
    find_by_id,
    increment_token_gen,
    load_users,
    save_users,
    transaction,
)
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


def _set_auth_cookie(response: Response, token: str, request: Request) -> None:
    """Sæt httpOnly session-cookie med korrekte sikkerhedsattributter."""
    secure = request.url.scheme == "https"
    response.set_cookie(
        key=TOKEN_COOKIE_NAME,
        value=token,
        max_age=TOKEN_TTL_SECONDS,
        httponly=True,
        samesite="strict",
        path="/",
        secure=secure,
    )


def _delete_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=TOKEN_COOKIE_NAME, path="/", samesite="strict")


@router.get("/status", response_model=AuthStatus)
async def auth_status(request: Request) -> AuthStatus:
    setup = user_service.setup_required()
    default_lang = settings_service.get_portal_locale().default_language
    # Læs token fra cookie (foretrukket) eller Bearer header
    from app.api.deps import _extract_token
    token = _extract_token(request)
    if setup or not token:
        return AuthStatus(setup_required=setup, authenticated=False, user=None, default_language=default_lang)
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
async def login(req: LoginRequest, request: Request, response: Response) -> LoginResponse:
    result = user_service.login(req)
    _set_auth_cookie(response, result.token, request)
    return result


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, str]:
    from app.api.deps import _extract_token
    token = _extract_token(request)
    if token:
        payload = auth_core.verify_token(token)
        if payload:
            audit_store.record_sync(
                "logout", "session", payload.get("sub"),
                after={"username": payload.get("username"), "auth_type": payload.get("auth_type", "local")},
            )
            # Revokér token ved at incrementere token_gen — stopper Bearer-genbrug
            if payload.get("auth_type") != "tacacs":
                user_id = payload.get("sub")
                if user_id:
                    with transaction():  # F-06: serialiser laes-ret-skriv
                        users = load_users()
                        increment_token_gen(users, user_id)
                        save_users(users)
    _delete_auth_cookie(response)
    return {"status": "ok"}


@router.post("/setup", response_model=LoginResponse)
async def setup(req: SetupRequest, request: Request, response: Response) -> LoginResponse:
    result = user_service.setup_first_admin(req)
    _set_auth_cookie(response, result.token, request)
    return result


@router.get("/me", response_model=UserMe)
async def me(user: User = Depends(get_current_user)) -> UserMe:
    if user.id.startswith("tacacs:"):
        from app.services.user_service import effective_roles
        return UserMe(
            **user.model_dump(),
            effective_roles=effective_roles(user),
        )
    return user_service.get_user_me(user.id)


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    user: User = Depends(get_current_user),
    *,
    request: Request,
    response: Response,
) -> LoginResponse:
    """Udsteder et nyt token med fuld TTL til en allerede autentiseret bruger.

    Klienten kalder dette endpoint inden token udløber (silent refresh).
    Returnerer samme format som /login og sætter en ny httpOnly cookie.
    """
    if user.id.startswith("tacacs:"):
        new_token = auth_core.create_tacacs_token(
            username=user.username,
            role=user.role,
            operator_profile=None,
            endpoint_roles=list(user.assigned_endpoint_roles or []),
        )
    else:
        record = find_by_id(load_users(), user.id)
        current_gen = record.get("token_gen", 0) if record else 0
        new_token = auth_core.create_token(user.id, user.username, user.role, gen=current_gen)
    expires_at, auth_type = auth_core.token_metadata(new_token)
    result = LoginResponse(
        token=new_token,
        user=user,
        expires_at=expires_at,
        auth_type=auth_type,
    )
    _set_auth_cookie(response, new_token, request)
    return result


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
