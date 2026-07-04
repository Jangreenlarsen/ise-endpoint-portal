# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from app.core import auth as auth_core
from app.core import portal_activity
from app.core.audit_store import ActorContext, actor_ctx
from app.core.user_store import find_by_id, load_users, increment_token_gen
from app.ise.client import get_ise_client
from app.schemas.user import ROLE_VALUES, Role, User
from app.services.authz_profile_service import AuthzProfileService
from app.services.custom_attribute_service import CustomAttributeService
from app.services.dacl_service import DaclService
from app.services.endpoint_service import EndpointService
from app.services.policy_service import PolicyService


def get_endpoint_service() -> EndpointService:
    return EndpointService(get_ise_client())


def get_custom_attribute_service() -> CustomAttributeService:
    return CustomAttributeService(get_ise_client())


def get_dacl_service() -> DaclService:
    return DaclService(get_ise_client())


def get_policy_service() -> PolicyService:
    return PolicyService(get_ise_client())


def get_authz_profile_service() -> AuthzProfileService:
    return AuthzProfileService(get_ise_client())


def _extract_token(request: Request) -> str | None:
    # httpOnly cookie er foretrukket — ikke tilgængeligt fra JS (XSS-safe)
    token = request.cookies.get("hv_token")
    if token:
        return token
    # Bearer-fallback: API-klienter og fil://-udviklingsmiljø
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip() or None
    return None


async def get_current_user(request: Request) -> User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Manglende token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = auth_core.verify_token(token)
    if not payload:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Ugyldigt eller udløbet token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    client_host = request.client.host if request.client else ""

    # TACACS+-autentiserede brugere har ingen lokal record — al info er i token.
    if payload.get("auth_type") == "tacacs":
        username = payload.get("username", "")
        role = payload.get("role")
        if not username or not role:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Ugyldigt TACACS+ token")
        if role not in ROLE_VALUES:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Ukendt rolle i token: {role}")
        actor_ctx.set(
            ActorContext(
                actor_id=f"tacacs:{username}",
                actor_username=username,
                source_ip=client_host,
            )
        )
        portal_activity.touch(role)  # adaptiv TTL: hold cachen hot mens portalen bruges
        return User(
            id=f"tacacs:{username}",
            username=username,
            role=role,
            created_at="",
            last_login=None,
            assigned_endpoint_roles=list(payload.get("endpoint_roles") or []),
            assigned_templates=[],
        )

    # Lokal bruger — verificer mod users.json.
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Ugyldigt token")
    record = find_by_id(load_users(), user_id)
    if not record:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Brugeren findes ikke længere")
    if record["role"] != payload.get("role"):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Rolle er ændret — login igen",
        )
    if payload.get("gen", 0) != record.get("token_gen", 0):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Token er tilbagekaldt — log ind igen",
            headers={"WWW-Authenticate": "Bearer"},
        )
    actor_ctx.set(
        ActorContext(
            actor_id=record["id"],
            actor_username=record["username"],
            source_ip=client_host,
        )
    )
    portal_activity.touch(record["role"])  # adaptiv TTL: hold cachen hot mens portalen bruges
    return User(
        id=record["id"],
        username=record["username"],
        role=record["role"],
        created_at=record["created_at"],
        last_login=record.get("last_login"),
        assigned_endpoint_roles=list(record.get("assigned_endpoint_roles") or []),
        assigned_templates=list(record.get("assigned_templates") or []),
    )


def require_roles(*roles: Role):
    invalid = [r for r in roles if r not in ROLE_VALUES]
    if invalid:
        raise ValueError(f"Unknown role(s): {invalid}")

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Kræver en af rollerne: {', '.join(roles)}",
            )
        return user

    return _dep


require_admin = require_roles("admin")
require_editor = require_roles("admin", "editor")
require_any = require_roles("admin", "editor", "editor-psk", "viewer")
# editor-psk: kan se og skrive PSK-attributter på endpoints + PSK-politik i settings.
require_psk_editor = require_roles("admin", "editor-psk")
# registrant/registrant_templet må KUN oprette endpoints — ingen browse/edit/delete/audit/admin.
# registrant_templet er yderligere begrænset: skal bruge skabelon, ingen gruppe/attrs-valg i UI.
require_edit_endpoint = require_roles("admin", "editor", "editor-psk")
require_create_endpoint = require_roles("admin", "editor", "editor-psk", "registrant", "registrant_templet")
require_register_lookup = require_roles("admin", "editor", "editor-psk", "viewer", "registrant", "registrant_templet")
