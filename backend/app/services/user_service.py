from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core import audit_store
from app.core import auth as auth_core
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
    )


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
