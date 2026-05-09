"""TACACS+ authentication and authorization service.

Authentication flow:
  1. Send Authentication START to TACACS+ server with username + password.
  2. If PASS: send Authorization REQUEST to retrieve portal attributes.
  3. Map returned attributes to portal role + operator profile name.
  4. Caller resolves operator profile name to endpoint roles / templates.

TACACS+ attribute conventions (configure on your TACACS+ server):
  portal-role            = editor | editor_psk | viewer | super_admin | registrant
  portal-operator-profile = <profile name as defined in portal operator catalog>

If only portal-operator-profile is returned, the profile's default_role is used.
If portal-role is also returned it overrides the profile's default_role.
"""
from __future__ import annotations

import logging
import socket
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Maps TACACS+ attribute value → portal Role literal
_ROLE_MAP: dict[str, str] = {
    "super_admin": "admin",
    "editor": "editor",
    "editor_psk": "editor-psk",
    "viewer": "viewer",
    "registrant": "registrant",
}


@dataclass
class TacacsAuthResult:
    success: bool
    role: str | None = None
    operator_profile_name: str | None = None
    error: str | None = None


def _parse_attributes(attrs: list[str]) -> dict[str, str]:
    """Parse TACACS+ attribute list ['key=value', 'key*value'] → dict."""
    result: dict[str, str] = {}
    for attr in attrs:
        for sep in ("=", "*"):
            if sep in attr:
                k, _, v = attr.partition(sep)
                result[k.strip().lower()] = v.strip()
                break
    return result


def authenticate_and_authorize(
    username: str,
    password: str,
    server_host: str,
    server_port: int,
    secret: str,
    timeout: int,
    role_attribute: str,
    operator_profile_attribute: str,
) -> TacacsAuthResult:
    """Perform TACACS+ authentication then authorization.

    Returns TacacsAuthResult with success=True and role/profile on PASS,
    or success=False with an error description on failure.
    """
    try:
        from tacacs_plus.client import TACACSClient
        import tacacs_plus.packet as tp
    except ImportError:
        return TacacsAuthResult(
            success=False,
            error="tacacs-plus library ikke installeret (pip install tacacs-plus)",
        )

    try:
        client = TACACSClient(
            host=server_host,
            port=server_port,
            secret=secret.encode("utf-8"),
            timeout=timeout,
            family=socket.AF_INET,
        )

        # Step 1: Authentication
        auth_reply = client.authenticate(
            username=username,
            password=password,
            authen_type=tp.TAC_PLUS_AUTHEN_TYPE_ASCII,
        )
        if not auth_reply.valid:
            logger.warning("TACACS+ auth failed for user=%s", username)
            return TacacsAuthResult(success=False, error="Forkert brugernavn eller password")

        # Step 2: Authorization — fetch portal attributes
        authz_reply = client.authorize(
            username=username,
            arguments=[
                b"service=portal",
                b"cmd=",
            ],
        )

        raw_attrs: list[str] = []
        if authz_reply.valid and authz_reply.arguments:
            raw_attrs = [a.decode("utf-8", errors="replace") for a in authz_reply.arguments]

        attrs = _parse_attributes(raw_attrs)
        logger.debug("TACACS+ authz attrs for %s: %s", username, attrs)

        role_attr_key = role_attribute.lower()
        profile_attr_key = operator_profile_attribute.lower()

        tacacs_role_value = attrs.get(role_attr_key)
        operator_profile_name = attrs.get(profile_attr_key)

        # Map TACACS+ role value to portal role
        role: str | None = None
        if tacacs_role_value:
            role = _ROLE_MAP.get(tacacs_role_value.lower())
            if not role:
                logger.warning(
                    "Ukendt TACACS+ rolle '%s' for user=%s — ignorerer",
                    tacacs_role_value,
                    username,
                )

        logger.info(
            "TACACS+ login ok: user=%s role=%s operator_profile=%s",
            username,
            role,
            operator_profile_name,
        )
        return TacacsAuthResult(
            success=True,
            role=role,
            operator_profile_name=operator_profile_name,
        )

    except (OSError, socket.timeout) as exc:
        logger.warning("TACACS+ connection error: %s", exc)
        return TacacsAuthResult(success=False, error=f"TACACS+ server ikke tilgængelig: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.error("TACACS+ unexpected error: %s", exc)
        return TacacsAuthResult(success=False, error=f"TACACS+ fejl: {exc}")
