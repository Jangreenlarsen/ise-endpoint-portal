# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock

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

# ── Account lockout ──────────────────────────────────────────────────────────
_LOCKOUT_MAX_ATTEMPTS = 5       # fejl inden lockout
_LOCKOUT_WINDOW_S     = 600     # 10 min glidende vindue
_LOCKOUT_DURATION_S   = 900     # 15 min lockout

_failed_attempts: dict[str, list[float]] = defaultdict(list)  # username → [timestamps]
_lockout_until:   dict[str, float]       = {}                 # username → epoch
_lockout_lock = Lock()


def _check_and_record_failure(username: str) -> None:
    """Registrér fejlet login-forsøg. Kaster 429 hvis bruger er låst."""
    with _lockout_lock:
        now = time.time()
        # Udløbet lockout ryddes automatisk
        if username in _lockout_until and now >= _lockout_until[username]:
            del _lockout_until[username]
            _failed_attempts[username] = []

        if username in _lockout_until:
            remaining = int(_lockout_until[username] - now)
            logger.warning("login blocked (lockout) for username=%s remaining=%ds", username, remaining)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"For mange fejlede loginforsøg. Prøv igen om {remaining // 60 + 1} minut(ter).",
            )

        # Tilføj timestamp og ryd gamle poster udenfor vinduet
        _failed_attempts[username].append(now)
        _failed_attempts[username] = [t for t in _failed_attempts[username] if now - t < _LOCKOUT_WINDOW_S]

        if len(_failed_attempts[username]) >= _LOCKOUT_MAX_ATTEMPTS:
            _lockout_until[username] = now + _LOCKOUT_DURATION_S
            _failed_attempts[username] = []
            logger.warning(
                "account locked for %ds after %d failed attempts: username=%s",
                _LOCKOUT_DURATION_S, _LOCKOUT_MAX_ATTEMPTS, username,
            )


def _clear_failures(username: str) -> None:
    """Ryd fejltæller ved successfuldt login."""
    with _lockout_lock:
        _failed_attempts.pop(username, None)
        _lockout_until.pop(username, None)


_PW_MIN_LEN = 10
_PW_POLICY = (
    "Password skal opfylde: mindst {n} tegn, mindst ét stort bogstav, "
    "mindst ét lille bogstav og mindst ét tal."
)


def _validate_password_strength(password: str) -> None:
    """Kaster 400 hvis password ikke opfylder minimumskravene."""
    errors: list[str] = []
    if len(password) < _PW_MIN_LEN:
        errors.append(f"mindst {_PW_MIN_LEN} tegn")
    if not any(c.isupper() for c in password):
        errors.append("mindst ét stort bogstav")
    if not any(c.islower() for c in password):
        errors.append("mindst ét lille bogstav")
    if not any(c.isdigit() for c in password):
        errors.append("mindst ét tal")
    if errors:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Password krav ikke opfyldt: " + ", ".join(errors) + ".",
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_public(record: dict) -> User:
    return User(
        id=record["id"],
        username=record["username"],
        role=record["role"],
        user_type=record.get("user_type", "user"),
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
    from app.core.auth_config_store import load as load_auth_config
    users = load_users()
    if find_by_username(users, payload.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Brugernavn findes allerede")

    auth_cfg = load_auth_config()
    is_tacacs_mode = auth_cfg.get("auth_mode") == "tacacs"

    if payload.password:
        _validate_password_strength(payload.password)
        password_hash = auth_core.hash_password(payload.password)
    elif not is_tacacs_mode:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Password er påkrævet i lokal auth-mode",
        )
    else:
        # TACACS+-mode: generer ubrugt tilfældig hash (login sker via TACACS+)
        import secrets as _secrets
        password_hash = auth_core.hash_password(_secrets.token_hex(32))

    record = {
        "id": str(uuid.uuid4()),
        "username": payload.username,
        "password_hash": password_hash,
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
    before = {"username": record["username"], "role": record["role"], "user_type": record.get("user_type", "user")}
    if payload.role is not None:
        record["role"] = payload.role
    if payload.user_type is not None:
        record["user_type"] = payload.user_type
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
    _validate_password_strength(payload.new_password)
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
    from app.core import audit_store
    audit_store.record_sync(
        "setup_first_admin", "user", record["id"],
        after={"username": record["username"], "role": "admin"},
    )
    return LoginResponse(token=token, user=_to_public(record))


def login(payload: LoginRequest) -> LoginResponse:
    from app.core.auth_config_store import load as load_auth_config

    users = load_users()
    record = find_by_username(users, payload.username)

    # Admin-brugere valideres ALTID lokalt, uanset TACACS+-konfiguration.
    is_admin_user = record and record.get("role") == "admin"

    auth_cfg = load_auth_config()
    use_tacacs = (
        auth_cfg.get("auth_mode") == "tacacs"
        and bool(auth_cfg.get("tacacs_server_host"))
        and bool(auth_cfg.get("tacacs_secret"))
        and not is_admin_user
    )

    if use_tacacs:
        from app.services.tacacs_service import authenticate_and_authorize
        result = authenticate_and_authorize(
            username=payload.username,
            password=payload.password,
            server_host=auth_cfg["tacacs_server_host"],
            server_port=auth_cfg["tacacs_server_port"],
            secret=auth_cfg["tacacs_secret"],
            timeout=auth_cfg["tacacs_timeout_seconds"],
            operator_profile_attribute=auth_cfg["tacacs_operator_profile_attribute"],
        )

        if result.success:
            _clear_failures(payload.username)
            # Slå operator-profil op i users.json (brugernavn = profilnavn).
            # TACACS+ klarer auth — portal-profilen bestemmer rolle + endpoint-roller.
            profile_name = result.operator_profile_name or payload.username
            profile_record = find_by_username(users, profile_name)

            # Tjek om der overhovedet er oprettet operatørprofiler i portalen.
            # Hvis ingen profiler findes → bootstrap-tilstand: giv TACACS-brugeren
            # automatisk admin-adgang så admin kan logge ind og oprette profiler.
            any_operator_profiles = any(
                u.get("user_type") == "operator" for u in users
            )

            if not profile_record:
                if not any_operator_profiles:
                    logger.info(
                        "TACACS+ auth OK — ingen operatørprofiler konfigureret i portal, "
                        "tildeler automatisk admin til '%s'",
                        payload.username,
                    )
                    effective_role = "admin"
                    endpoint_roles = [payload.username]
                    assigned_templates = []
                    from app.core import audit_store
                    audit_store.record_sync(
                        "tacacs_auto_admin_bootstrap", "session", payload.username,
                        after={"reason": "no_operator_profiles_configured", "granted_role": "admin"},
                    )
                else:
                    logger.warning(
                        "TACACS+ auth OK men operatørprofil '%s' ikke fundet i portal — afviser login",
                        profile_name,
                    )
                    raise HTTPException(
                        status.HTTP_401_UNAUTHORIZED,
                        f"Operatørprofil '{profile_name}' er ikke konfigureret i portalen. "
                        "Kontakt din administrator.",
                    )
            else:
                effective_role = profile_record["role"]
                endpoint_roles = list(profile_record.get("assigned_endpoint_roles") or [])
                assigned_templates = list(profile_record.get("assigned_templates") or [])

            # Implicit endpoint role = username (samme som lokale brugere)
            if payload.username not in endpoint_roles:
                endpoint_roles.append(payload.username)

            token = auth_core.create_tacacs_token(
                username=payload.username,
                role=effective_role,
                operator_profile=profile_name,
                endpoint_roles=endpoint_roles,
            )
            tacacs_user = User(
                id=f"tacacs:{payload.username}",
                username=payload.username,
                role=effective_role,  # type: ignore[arg-type]
                created_at=profile_record.get("created_at", "") if profile_record else "",
                last_login=_now_iso(),
                assigned_endpoint_roles=endpoint_roles,
                assigned_templates=assigned_templates,
            )
            logger.info(
                "tacacs login: user=%s profile=%s role=%s",
                payload.username,
                profile_name,
                effective_role,
            )
            audit_store.record_sync("login_success", "session", f"tacacs:{payload.username}", {"auth": "tacacs", "role": effective_role})
            return LoginResponse(token=token, user=tacacs_user)

        # TACACS+ auth fejlede
        fallback = auth_cfg.get("tacacs_fallback_to_local", True)
        if not fallback:
            logger.warning("tacacs auth failed (no fallback) for %s: %s", payload.username, result.error)
            _check_and_record_failure(payload.username)
            audit_store.record_sync("login_failed", "session", payload.username, {"reason": "tacacs_failed"})
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Forkert brugernavn eller password")
        logger.warning("tacacs auth failed (falling back to local) for %s: %s", payload.username, result.error)
        # Fald igennem til lokal auth nedenfor

    # Lokal auth (altid for admin, fallback for øvrige hvis TACACS+ fejler)
    # Operatørprofiler (user_type=operator) kan ikke logge ind lokalt — kun via TACACS+.
    # Admin-rollen er undtaget: en fejlkonfigureret admin-konto må aldrig låses ude.
    if record and record.get("user_type") == "operator" and record.get("role") != "admin":
        logger.warning("local login blocked for operator-type user=%s", payload.username)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Denne konto er konfigureret som Profil (TACACS+-operatørprofil) og kan ikke bruges til lokal login.",
        )
    if not record or not auth_core.verify_password(
        payload.password, record.get("password_hash", "")
    ):
        _check_and_record_failure(payload.username)
        logger.warning("failed login attempt for username=%s", payload.username)
        audit_store.record_sync("login_failed", "session", payload.username, {"reason": "bad_credentials"})
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Forkert brugernavn eller password",
        )
    _clear_failures(payload.username)
    record["last_login"] = _now_iso()
    save_users(users)
    token = auth_core.create_token(record["id"], record["username"], record["role"])
    logger.info("local login: %s role=%s", record["username"], record["role"])
    audit_store.record_sync("login_success", "session", record["id"], {"username": record["username"], "role": record["role"]})
    return LoginResponse(token=token, user=_to_public(record))
