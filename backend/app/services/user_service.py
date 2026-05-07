from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core import audit_store
from app.core import auth as auth_core
from app.core import role_catalog
from app.core.user_store import (
    find_by_id,
    find_by_username,
    load_users,
    save_users,
)
from app.schemas.user import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    SetupRequest,
    User,
    UserCreate,
    UserMe,
    UserUpdate,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_public(record: dict) -> User:
    return User(
        id=record["id"],
        username=record["username"],
        role=record["role"],
        created_at=record["created_at"],
        last_login=record.get("last_login"),
        assigned_endpoint_roles=list(record.get("assigned_endpoint_roles") or []),
        assigned_templates=list(record.get("assigned_templates") or []),
    )


def effective_roles(user: User) -> list[str]:
    """Returnerer brugerens effektive endpoint-roller: tildelte + username.

    Username-rollen er implicit og kan ikke fjernes — derfor er
    enhver bruger garanteret mindst én rolle, så de altid kan se
    deres egne endpoints. dict.fromkeys deduplicerer så nye brugere
    (der nu får assigned_endpoint_roles=[username] automatisk) ikke
    returnerer ["jan", "jan"].
    """
    return list(dict.fromkeys([*user.assigned_endpoint_roles, user.username]))


def get_user_me(user_id: str) -> UserMe:
    """Som get_user, men inkluderer effective_roles. Til /api/auth/me."""
    base = get_user(user_id)
    return UserMe(
        **base.model_dump(),
        effective_roles=effective_roles(base),
    )


async def set_endpoint_roles(
    user_id: str,
    roles: list[str],
    actor_username: str,
) -> User:
    """Admin tildeler N roller fra kataloget til en bruger.

    Validerer at hver rolle eksisterer i kataloget. Dedupliker
    case-insensitivt men bevarer admin-skrevet stavning.
    """
    users = load_users()
    record = find_by_id(users, user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")

    catalog = role_catalog.load_roles()
    seen: set[str] = set()
    resolved: list[str] = []
    for raw in roles:
        name = (raw or "").strip()
        if not name:
            continue
        match = role_catalog.find_by_name(catalog, name)
        if not match:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Rollen '{name}' findes ikke i kataloget",
            )
        canonical = match["name"]
        if canonical.lower() in seen:
            continue
        seen.add(canonical.lower())
        resolved.append(canonical)

    before = list(record.get("assigned_endpoint_roles") or [])
    record["assigned_endpoint_roles"] = resolved
    save_users(users)
    logger.info(
        "endpoint roles set: user=%s roles=%s by=%s",
        record["username"],
        resolved,
        actor_username,
    )
    await audit_store.record(
        "roles_assigned",
        "user",
        user_id,
        before={"assigned_endpoint_roles": before},
        after={"assigned_endpoint_roles": resolved},
    )
    return _to_public(record)


def list_users() -> list[User]:
    return [_to_public(u) for u in load_users()]


def get_user(user_id: str) -> User:
    users = load_users()
    record = find_by_id(users, user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    return _to_public(record)


async def create_user(payload: UserCreate) -> User:
    users = load_users()
    if find_by_username(users, payload.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Brugernavn findes allerede")
    record = {
        "id": str(uuid.uuid4()),
        "username": payload.username,
        "password_hash": auth_core.hash_password(payload.password),
        "role": payload.role,
        "created_at": _now_iso(),
        "last_login": None,
    }
    users.append(record)
    save_users(users)
    logger.info("user created: %s role=%s", payload.username, payload.role)
    # 3.8.0: auto-opret System adm-rolle med navnet = username.
    # 3.9.6: tildel rollen til brugeren med det samme så UI viser den
    # som checked uden at admin skal gøre det manuelt.
    try:
        from app.core import role_catalog
        result = role_catalog.ensure_user_role(payload.username)
        if result is None:
            logger.warning(
                "kunne ikke auto-oprette System adm-rolle for '%s' "
                "(ugyldigt navn — kun A-Z, a-z, 0-9, '-', '_')",
                payload.username,
            )
        else:
            record["assigned_endpoint_roles"] = [payload.username]
            save_users(users)
            logger.info("auto-tildelt System adm-rolle '%s' til ny bruger", payload.username)
    except Exception as exc:  # noqa: BLE001
        logger.warning("auto-rolle-create fejlede for %s: %s", payload.username, exc)
    await audit_store.record(
        "created",
        "user",
        record["id"],
        after={"username": payload.username, "role": payload.role},
    )
    return _to_public(record)


async def update_user(user_id: str, payload: UserUpdate) -> User:
    users = load_users()
    record = find_by_id(users, user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    before = {"username": record["username"], "role": record["role"]}
    if payload.role is not None:
        record["role"] = payload.role
    pw_changed = bool(payload.password)
    if pw_changed:
        record["password_hash"] = auth_core.hash_password(payload.password)
    save_users(users)
    logger.info("user updated: %s", record["username"])
    await audit_store.record(
        "updated",
        "user",
        user_id,
        before=before,
        after={
            "username": record["username"],
            "role": record["role"],
            "password_changed": pw_changed,
        },
    )
    return _to_public(record)


async def set_user_templates(
    user_id: str,
    template_ids: list[str],
    actor_username: str,
) -> User:
    """Admin tildeler specifikke skabelon-IDs til en registrar_templet-bruger."""
    from app.core import template_store
    users = load_users()
    record = find_by_id(users, user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    # Valider at alle IDs eksisterer
    all_ids = {t["id"] for t in template_store.load_templates()}
    invalid = [tid for tid in template_ids if tid not in all_ids]
    if invalid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Ukendte skabelon-IDs: {', '.join(invalid)}",
        )
    before = list(record.get("assigned_templates") or [])
    record["assigned_templates"] = list(dict.fromkeys(template_ids))
    save_users(users)
    logger.info(
        "template assignments set: user=%s templates=%s by=%s",
        record["username"],
        record["assigned_templates"],
        actor_username,
    )
    await audit_store.record(
        "templates_assigned",
        "user",
        user_id,
        before={"assigned_templates": before},
        after={"assigned_templates": record["assigned_templates"]},
    )
    return _to_public(record)


async def delete_user(user_id: str, requester_id: str) -> None:
    if user_id == requester_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Du kan ikke slette dig selv")
    users = load_users()
    record = find_by_id(users, user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    admins_left = sum(1 for u in users if u["role"] == "admin" and u["id"] != user_id)
    if record["role"] == "admin" and admins_left == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Kan ikke slette sidste admin — opret en ny admin først",
        )
    before = {"username": record["username"], "role": record["role"]}
    users = [u for u in users if u["id"] != user_id]
    save_users(users)
    logger.info("user deleted: %s", record["username"])
    await audit_store.record(
        "deleted",
        "user",
        user_id,
        before=before,
    )


async def change_password(user_id: str, payload: ChangePasswordRequest) -> None:
    users = load_users()
    record = find_by_id(users, user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    if not auth_core.verify_password(payload.current_password, record["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Forkert nuværende password")
    record["password_hash"] = auth_core.hash_password(payload.new_password)
    save_users(users)
    logger.info("password changed for %s", record["username"])
    await audit_store.record(
        "password_changed",
        "user",
        user_id,
        after={"username": record["username"]},
    )


def setup_required() -> bool:
    return len(load_users()) == 0


def setup_first_admin(payload: SetupRequest) -> LoginResponse:
    if not setup_required():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Opsætning er allerede gennemført",
        )
    users = load_users()
    now = _now_iso()
    record = {
        "id": str(uuid.uuid4()),
        "username": payload.username,
        "password_hash": auth_core.hash_password(payload.password),
        "role": "admin",
        "created_at": now,
        "last_login": now,
    }
    users.append(record)
    save_users(users)
    token = auth_core.create_token(record["id"], record["username"], record["role"])
    logger.warning("first-run admin created: %s", record["username"])
    return LoginResponse(token=token, user=_to_public(record))


def login(payload: LoginRequest) -> LoginResponse:
    users = load_users()
    record = find_by_username(users, payload.username)
    if not record or not auth_core.verify_password(
        payload.password, record["password_hash"]
    ):
        logger.warning("failed login attempt for username=%s", payload.username)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Forkert brugernavn eller password",
        )
    record["last_login"] = _now_iso()
    save_users(users)
    token = auth_core.create_token(record["id"], record["username"], record["role"])
    logger.info("login: %s role=%s", record["username"], record["role"])
    return LoginResponse(token=token, user=_to_public(record))
