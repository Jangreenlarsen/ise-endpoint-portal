from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from app.core import auth as auth_core
from app.core.audit_store import ActorContext, actor_ctx
from app.core.user_store import find_by_id, load_users
from app.ise.client import get_ise_client
from app.schemas.user import ROLE_VALUES, Role, User
from app.services.custom_attribute_service import CustomAttributeService
from app.services.dacl_service import DaclService
from app.services.endpoint_service import EndpointService


def get_endpoint_service() -> EndpointService:
    return EndpointService(get_ise_client())


def get_custom_attribute_service() -> CustomAttributeService:
    return CustomAttributeService(get_ise_client())


def get_dacl_service() -> DaclService:
    return DaclService(get_ise_client())


def _extract_token(request: Request) -> str | None:
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
    client_host = request.client.host if request.client else ""
    actor_ctx.set(
        ActorContext(
            actor_id=record["id"],
            actor_username=record["username"],
            source_ip=client_host,
        )
    )
    return User(
        id=record["id"],
        username=record["username"],
        role=record["role"],
        created_at=record["created_at"],
        last_login=record.get("last_login"),
        assigned_endpoint_roles=list(record.get("assigned_endpoint_roles") or []),
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
# Registrar/registrant må KUN oprette endpoints — ingen browse/edit/delete/audit/admin.
# registrant er yderligere begrænset: skal bruge skabelon, ingen gruppe/attrs-valg i UI.
require_edit_endpoint = require_roles("admin", "editor", "editor-psk")
require_create_endpoint = require_roles("admin", "editor", "editor-psk", "registrar", "registrant")
require_register_lookup = require_roles("admin", "editor", "editor-psk", "viewer", "registrar", "registrant")
