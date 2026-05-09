"""TACACS+ authentication and authorization service.

Authentication flow:
  1. Send Authentication START to TACACS+ server with username + password.
  2. If PASS: send Authorization REQUEST to retrieve portal attributes.
  3. Return the operator-profile attribute — caller looks up the matching
     portal user record (users.json) to get role, endpoint roles and templates.

TACACS+ attribute convention (configure on your TACACS+ server):
  portal-operator-profile = <username as defined in portal user catalog>

The operator profile name returned by the TACACS+ server must match a username
in the portal user catalog exactly (case-insensitive). That user's role,
endpoint roles and templates are applied — no role is negotiated via TACACS+.
"""
from __future__ import annotations

import logging
import socket
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TacacsAuthResult:
    success: bool
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
    operator_profile_attribute: str,
) -> TacacsAuthResult:
    """Perform TACACS+ authentication then authorization.

    Returns TacacsAuthResult with success=True and operator_profile_name on PASS,
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

        # Step 2: Authorization — fetch operator-profile attribute
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

        profile_attr_key = operator_profile_attribute.lower()
        operator_profile_name = attrs.get(profile_attr_key)

        if not operator_profile_name:
            # Fallback: brug selve brugernavnet som profil-lookup
            operator_profile_name = username
            logger.debug(
                "TACACS+ returnerede ingen %s attribut for %s — bruger username som profil",
                profile_attr_key,
                username,
            )

        logger.info(
            "TACACS+ login ok: user=%s operator_profile=%s",
            username,
            operator_profile_name,
        )
        return TacacsAuthResult(
            success=True,
            operator_profile_name=operator_profile_name,
        )

    except (OSError, socket.timeout) as exc:
        logger.warning("TACACS+ connection error: %s", exc)
        return TacacsAuthResult(success=False, error=f"TACACS+ server ikke tilgængelig: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.error("TACACS+ unexpected error: %s", exc)
        return TacacsAuthResult(success=False, error=f"TACACS+ fejl: {exc}")
