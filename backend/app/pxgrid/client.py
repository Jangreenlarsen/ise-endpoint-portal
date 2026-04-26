"""REST client for the pxGrid control plane.

The control plane lives at ``https://<psn>:8910/pxgrid/control/*`` and
is *separate* from ERS / Open API. It uses mTLS — username/password
auth is layered on top via HTTP Basic only after AccessSecretCreate
has issued a per-node password.

Implements the four calls needed for the bootstrap flow:

    1. AccountCreate   — register a new client (CSR mode); ISE returns
                         accountState=PENDING. Idempotent: re-posting
                         with the same nodeName is a no-op.
    2. AccountActivate — poll until accountState=ENABLED (admin has
                         approved in pxGrid Services UI).
    3. ServiceLookup   — discover which PSN node hosts a given service
                         topic (e.g. ``com.cisco.ise.session``). The
                         returned ``properties.wsUrl`` is what the
                         STOMP layer connects to in phase 2.
    4. AccessSecretCreate — exchange peer-node identity for the
                            per-subscription password used by STOMP CONNECT.

Once enabled+activated, all subsequent control-plane calls authenticate
with Basic(node_name, password) on top of mTLS. ISE rejects anything else.

Phase 2 will add a thin asyncio task that loops:
    sub_node = ServiceLookup("com.cisco.ise.pubsub")
    secret   = AccessSecretCreate(sub_node)
    stomp.connect(sub_node.wsUrl, login=node, passcode=secret)
    stomp.subscribe("/topic/com.cisco.ise.session", on_message=...)
and runs forever with reconnect + PSN-failover.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.core import config
from app.pxgrid import cert_manager
from app.pxgrid.exceptions import (
    PxGridAccountPendingError,
    PxGridAuthError,
    PxGridConfigError,
    PxGridError,
    PxGridServiceNotFoundError,
)

logger = logging.getLogger(__name__)

CONTROL_PORT = 8910


@dataclass
class ServiceNode:
    """One result row from ServiceLookup — a PSN that hosts a given topic."""

    name: str
    node_name: str
    properties: dict[str, Any]

    @property
    def ws_url(self) -> str:
        return self.properties.get("wsUrl", "")

    @property
    def rest_base_url(self) -> str:
        return self.properties.get("restBaseUrl", "")


def _resolved_psn(s: config.Settings | None = None) -> str:
    s = s or config.settings
    if s.pxgrid_psn_fqdn:
        return s.pxgrid_psn_fqdn
    # Fallback: strip scheme + port from ise_base_url so admins don't
    # have to set the same hostname twice in normal single-node setups.
    raw = s.ise_base_url.replace("https://", "").replace("http://", "")
    return raw.split("/")[0].split(":")[0]


def _control_url(s: config.Settings | None = None) -> str:
    psn = _resolved_psn(s)
    if not psn:
        raise PxGridConfigError(
            "No PxGrid PSN configured (set pxgrid_psn_fqdn or ise_base_url)."
        )
    return f"https://{psn}:{CONTROL_PORT}/pxgrid/control"


class PxGridClient:
    """Async client for the four control-plane calls.

    Stateless across calls — recreates the httpx.AsyncClient per request
    so cert reloads (after cert upload) take effect immediately. If we
    grow to >5 calls/sec we can pool, but the control plane is
    bootstrap-only — bulk traffic goes over STOMP.
    """

    def __init__(self, *, timeout: float = 15.0) -> None:
        self.timeout = timeout
        self._settings = config.settings

    def _bundle(self) -> cert_manager.CertBundle:
        s = self._settings
        return cert_manager.load_bundle(
            s.pxgrid_cert_path, s.pxgrid_key_path, s.pxgrid_ca_bundle_path
        )

    def _http(
        self,
        *,
        with_basic_auth: bool = True,
    ) -> httpx.AsyncClient:
        s = self._settings
        bundle = self._bundle()
        auth: httpx.Auth | None = None
        if with_basic_auth and s.pxgrid_password:
            auth = httpx.BasicAuth(s.pxgrid_node_name, s.pxgrid_password)
        return httpx.AsyncClient(
            base_url=_control_url(s),
            cert=bundle.httpx_cert(),
            verify=bundle.httpx_verify(),
            timeout=self.timeout,
            auth=auth,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        with_basic_auth: bool = True,
    ) -> dict[str, Any]:
        try:
            async with self._http(with_basic_auth=with_basic_auth) as http:
                resp = await http.post(path, json=payload)
        except httpx.HTTPError as exc:
            raise PxGridError(f"PxGrid transport error on {path}: {exc}") from exc
        if resp.status_code in (401, 403):
            raise PxGridAuthError(
                f"PxGrid auth failed on {path}: HTTP {resp.status_code}"
            )
        if resp.status_code >= 400:
            body = resp.text[:500]
            raise PxGridError(
                f"PxGrid {path} returned {resp.status_code}: {body}"
            )
        try:
            return resp.json() if resp.text else {}
        except ValueError:
            return {}

    # ── Bootstrap calls ────────────────────────────────────────────

    async def account_create(self) -> dict[str, Any]:
        """Register the portal as a new pxGrid client.

        Idempotent: ISE returns the same accountState if the nodeName
        already exists. Returns the raw ISE payload incl. ``accountState``
        and ``password`` (only present on first activation).
        """
        s = self._settings
        if not s.pxgrid_node_name:
            raise PxGridConfigError("pxgrid_node_name must be set")
        # AccountCreate uses certificate identity only — no Basic auth yet.
        payload = {"nodeName": s.pxgrid_node_name}
        return await self._post(
            "/AccountCreate", payload, with_basic_auth=False
        )

    async def account_activate(self) -> dict[str, Any]:
        """Check approval state. Raises PxGridAccountPendingError if PENDING."""
        s = self._settings
        # AccountActivate is the canonical "am I approved yet?" probe.
        # Uses Basic auth with the password from AccountCreate (or upload mode's
        # pre-shared secret).
        result = await self._post("/AccountActivate", {})
        state = (result.get("accountState") or "").upper()
        if state == "PENDING":
            raise PxGridAccountPendingError(
                f"Client '{s.pxgrid_node_name}' is PENDING — "
                "approve in ISE → Administration → pxGrid Services → Clients"
            )
        if state == "DISABLED":
            raise PxGridAuthError(
                f"Client '{s.pxgrid_node_name}' is DISABLED in ISE"
            )
        return result

    async def service_lookup(self, service_name: str) -> list[ServiceNode]:
        """Discover which PSN node(s) host a given pxGrid service topic.

        Common service names:
            com.cisco.ise.session     — RADIUS session events
            com.cisco.ise.endpoint    — endpoint CRUD events
            com.cisco.ise.pubsub      — STOMP/WebSocket broker (transport)
        """
        result = await self._post(
            "/ServiceLookup", {"name": service_name}
        )
        services = result.get("services") or []
        if not services:
            raise PxGridServiceNotFoundError(
                f"No pxGrid nodes host service '{service_name}' — "
                "check that the corresponding ISE persona is enabled"
            )
        return [
            ServiceNode(
                name=s.get("name", ""),
                node_name=s.get("nodeName", ""),
                properties=s.get("properties", {}),
            )
            for s in services
        ]

    async def access_secret_create(self, peer_node_name: str) -> str:
        """Exchange identity for the per-peer secret used by STOMP CONNECT.

        Each subscription gets its own short-lived secret bound to the
        peer node returned by ServiceLookup. ISE rotates these — never
        cache long-term; re-fetch on reconnect.
        """
        result = await self._post(
            "/AccessSecretCreate", {"peerNodeName": peer_node_name}
        )
        secret = result.get("secret", "")
        if not secret:
            raise PxGridError(
                f"AccessSecretCreate for {peer_node_name} returned empty secret"
            )
        return secret

    # ── High-level helpers ─────────────────────────────────────────

    async def connectivity_test(self) -> dict[str, Any]:
        """Probe used by Settings → 'Test PxGrid forbindelse'.

        Walks: cert load → TLS handshake (via AccountActivate) → ServiceLookup
        for the pubsub topic. Returns a dict the API layer maps to
        PxGridTestResponse so the caller sees *which step* failed.
        """
        # Step 1: cert
        try:
            self._bundle()
        except Exception as exc:
            return {"ok": False, "step": "cert_load", "message": str(exc)}

        # Step 2: TLS + auth (AccountActivate is cheaper than full Lookup)
        try:
            activate = await self.account_activate()
        except PxGridAccountPendingError as exc:
            return {
                "ok": False,
                "step": "tls_handshake",
                "message": str(exc),
                "account_state": "PENDING",
            }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "step": "tls_handshake", "message": str(exc)}

        # Step 3: discover services we'd subscribe to
        try:
            session_nodes = await self.service_lookup("com.cisco.ise.session")
            pubsub_nodes = await self.service_lookup("com.cisco.ise.pubsub")
        except PxGridServiceNotFoundError as exc:
            return {
                "ok": False,
                "step": "service_lookup",
                "message": str(exc),
                "account_state": activate.get("accountState", "ENABLED"),
            }

        services = [n.name for n in session_nodes] + [n.name for n in pubsub_nodes]
        return {
            "ok": True,
            "step": "service_lookup",
            "message": (
                f"PxGrid OK — account ENABLED, found "
                f"{len(session_nodes)} session node(s) and "
                f"{len(pubsub_nodes)} pubsub node(s)"
            ),
            "services_found": list(dict.fromkeys(services)),
            "account_state": activate.get("accountState", "ENABLED"),
        }
