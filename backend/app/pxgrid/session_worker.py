"""Persistent STOMP-worker der subscriber til pxGrid session-topic.

Bygger oven på samme bootstrap som ``probe.py`` (ServiceLookup →
AccessSecret → WS+STOMP CONNECT → SUBSCRIBE) men kører **uendeligt**
med:

- auto-reconnect på enhver fejl, eksponentiel backoff (min → max),
- PSN-failover (ServiceLookup køres ved hver reconnect så hvis primær
  pxGrid-node er nede vælges en alive node),
- friske AccessSecrets (broker afviser genbrugte secrets — ISE roterer
  dem aktivt),
- parse af MESSAGE-payload (JSON) → ``SessionInfo`` → ``SessionCache``.

Worker'en er en single-task lifecycle: ``start()`` spawn'er én asyncio-
task; ``stop()`` cancellerer + venter. Lifespan-hooket i ``main.py``
ejer worker-instansen.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from app.core import config
from app.pxgrid import cert_manager, stomp
from app.pxgrid.client import PxGridClient
from app.pxgrid.session_cache import SessionInfo, get_cache

logger = logging.getLogger(__name__)

PUBSUB_SERVICE = "com.cisco.ise.pubsub"


@dataclass
class WorkerStatus:
    running: bool = False
    connected: bool = False
    peer_node: str = ""
    ws_url: str = ""
    started_at: float = 0.0
    last_connect_at: float = 0.0
    last_disconnect_at: float = 0.0
    last_event_at: float = 0.0
    last_error: str = ""
    reconnect_count: int = 0
    messages_total: int = 0
    subscribed_topic: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


class PxGridSessionWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._status = WorkerStatus()

    @property
    def status(self) -> WorkerStatus:
        return self._status

    def start(self) -> None:
        s = config.settings
        if not (s.pxgrid_enabled and s.pxgrid_worker_enabled):
            logger.info(
                "pxgrid session worker disabled (pxgrid_enabled=%s worker_enabled=%s)",
                s.pxgrid_enabled,
                s.pxgrid_worker_enabled,
            )
            return
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._status = WorkerStatus(
            running=True, started_at=time.time(),
            subscribed_topic=s.pxgrid_session_topic,
        )
        self._task = asyncio.create_task(
            self._run_loop(), name="pxgrid-session-worker"
        )
        logger.info("pxgrid session worker started")

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        try:
            await asyncio.wait_for(self._task, timeout=5.0)
        except asyncio.TimeoutError:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        finally:
            self._status.running = False
            self._status.connected = False
            self._task = None
            logger.info("pxgrid session worker stopped")

    async def _run_loop(self) -> None:
        s = config.settings
        backoff = max(0.5, s.pxgrid_stomp_reconnect_min_s)
        try:
            while not self._stop_event.is_set():
                connected_ok = False
                try:
                    connected_ok = await self._one_session()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self._status.last_error = f"{type(exc).__name__}: {exc}"
                    logger.warning("pxgrid worker iteration failed: %s", exc)
                self._status.connected = False
                self._status.last_disconnect_at = time.time()
                if self._stop_event.is_set():
                    break
                if connected_ok:
                    backoff = max(0.5, s.pxgrid_stomp_reconnect_min_s)
                self._status.reconnect_count += 1
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(), timeout=backoff
                    )
                    break
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2.0, s.pxgrid_stomp_reconnect_max_s)
        finally:
            self._status.running = False

    async def _one_session(self) -> bool:
        """One bootstrap+subscribe cycle. Returns True if SUBSCRIBE succeeded
        (so the outer loop can reset the backoff window)."""
        try:
            import websockets
        except ImportError as exc:
            raise RuntimeError(
                "Pakken 'websockets' mangler — pip install websockets"
            ) from exc

        s = config.settings
        client = PxGridClient()
        bundle = cert_manager.load_bundle(
            s.pxgrid_cert_path, s.pxgrid_key_path, s.pxgrid_ca_bundle_path
        )

        nodes = await client.service_lookup(PUBSUB_SERVICE)
        peer = nodes[0]
        ws_url = peer.ws_url
        if not ws_url:
            raise RuntimeError(f"Pubsub-noden {peer.node_name} returnerede tom wsUrl")
        secret = await client.access_secret_create(peer.node_name)

        ssl_ctx = self._build_ssl_context(bundle)
        host = urlparse(ws_url).hostname or "ise"
        basic_auth = base64.b64encode(
            f"{s.pxgrid_node_name}:{secret}".encode("utf-8")
        ).decode("ascii")

        self._status.peer_node = peer.node_name
        self._status.ws_url = ws_url

        cache = get_cache()
        topic = s.pxgrid_session_topic
        heartbeat_ms = max(0, int(s.pxgrid_stomp_heartbeat_ms))
        # Read timeout slightly larger than the negotiated heartbeat so a
        # missed heartbeat fails fast and we reconnect.
        recv_timeout = (heartbeat_ms / 1000.0) * 2.0 if heartbeat_ms else 60.0

        async with websockets.connect(
            ws_url,
            ssl=ssl_ctx,
            subprotocols=["v12.stomp"],
            additional_headers={"Authorization": f"Basic {basic_auth}"},
            open_timeout=10,
            ping_interval=None,
        ) as ws:
            await ws.send(stomp.connect_frame(
                host, s.pxgrid_node_name, secret, heartbeat_ms=heartbeat_ms,
            ))
            buf = b""
            connected = False
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=10.0)
            except asyncio.TimeoutError:
                raise RuntimeError("STOMP CONNECT timeout — broker svarede ikke") from None
            buf += first if isinstance(first, bytes) else first.encode("utf-8")
            frames, buf = stomp.split_frames(buf)
            for f in frames:
                if f.command == "CONNECTED":
                    connected = True
                elif f.command == "ERROR":
                    raise RuntimeError(
                        "STOMP ERROR: " + f.body.decode("utf-8", errors="replace")
                    )
            if not connected:
                raise RuntimeError(f"Forventede CONNECTED, fik {[f.command for f in frames]}")

            await ws.send(stomp.subscribe_frame(topic))
            self._status.connected = True
            self._status.last_connect_at = time.time()
            self._status.last_error = ""
            logger.info(
                "pxgrid session worker subscribed to %s on %s",
                topic, peer.node_name,
            )

            while not self._stop_event.is_set():
                try:
                    chunk = await asyncio.wait_for(ws.recv(), timeout=recv_timeout)
                except asyncio.TimeoutError:
                    raise RuntimeError(
                        f"Ingen frames i {recv_timeout:.0f}s (heartbeat-tab)"
                    ) from None
                buf += chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
                frames, buf = stomp.split_frames(buf)
                for f in frames:
                    if f.command == "MESSAGE":
                        self._status.messages_total += 1
                        self._status.last_event_at = time.time()
                        cache.note_message()
                        await _handle_message_body(f.body, cache)
                    elif f.command == "ERROR":
                        raise RuntimeError(
                            "STOMP ERROR: "
                            + f.body.decode("utf-8", errors="replace")
                        )

            try:
                await ws.send(stomp.disconnect_frame())
            except Exception:  # noqa: BLE001
                pass
            return True

    @staticmethod
    def _build_ssl_context(bundle: cert_manager.CertBundle) -> ssl.SSLContext:
        ctx = ssl.create_default_context()
        if bundle.ca_path:
            ctx.load_verify_locations(cafile=str(bundle.ca_path))
        ctx.load_cert_chain(
            certfile=str(bundle.cert_path), keyfile=str(bundle.key_path)
        )
        return ctx


async def _handle_message_body(body: bytes, cache) -> None:  # type: ignore[no-untyped-def]
    if not body:
        return
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return
    sessions = _extract_sessions(payload)
    for sess in sessions:
        info = _build_session_info(sess)
        if not info.mac:
            continue
        state_upper = (info.state or "").upper()
        if "DISCONN" in state_upper or state_upper in ("STOPPED", "TERMINATED"):
            await cache.remove(info.mac)
        else:
            await cache.upsert(info)


def _extract_sessions(payload: Any) -> list[dict[str, Any]]:
    """Tolerate both shapes: ``{sessions:[...]}`` and ``{session:{...}}``."""
    if isinstance(payload, dict):
        if isinstance(payload.get("sessions"), list):
            return [s for s in payload["sessions"] if isinstance(s, dict)]
        if isinstance(payload.get("session"), dict):
            return [payload["session"]]
        if "macAddress" in payload or "callingStationId" in payload:
            return [payload]
    if isinstance(payload, list):
        return [s for s in payload if isinstance(s, dict)]
    return []


def _build_session_info(d: dict[str, Any]) -> SessionInfo:
    mac = (
        d.get("callingStationId")
        or d.get("macAddress")
        or d.get("mac")
        or ""
    )
    return SessionInfo(
        mac=str(mac),
        state=str(d.get("state", "") or d.get("sessionEvent", "")),
        audit_session_id=str(d.get("auditSessionId", "")),
        nas_ip=str(d.get("nasIpAddress", "") or d.get("nasIp", "")),
        user_name=str(d.get("userName", "") or d.get("username", "")),
        raw=d,
    )


_worker: PxGridSessionWorker | None = None


def get_worker() -> PxGridSessionWorker:
    global _worker
    if _worker is None:
        _worker = PxGridSessionWorker()
    return _worker
