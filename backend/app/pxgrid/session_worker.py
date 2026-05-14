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
from app.core.endpoint_cache import get_cache as get_endpoint_cache
from app.pxgrid import cert_manager, stomp
from app.pxgrid.client import PxGridClient
from app.pxgrid.session_cache import SessionInfo, get_cache

logger = logging.getLogger(__name__)

PUBSUB_SERVICE = "com.cisco.ise.pubsub"
SUB_ID_SESSION = "sub-session"
SUB_ID_ENDPOINT = "sub-endpoint"


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
    subscribed_topics: list[str] = field(default_factory=list)
    endpoint_events_total: int = 0
    session_events_total: int = 0
    # Bevaret for backwards compat med eksisterende API/UI; afspejler
    # første topic i subscribed_topics-listen.
    subscribed_topic: str = ""
    endpoint_lookup_service: str = ""
    endpoint_lookup_props: dict[str, Any] = field(default_factory=dict)
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
        topics = [s.pxgrid_session_topic]
        if s.pxgrid_endpoint_topic_enabled:
            topics.append(s.pxgrid_endpoint_topic)
        self._status = WorkerStatus(
            running=True, started_at=time.time(),
            subscribed_topics=topics,
            subscribed_topic=topics[0],
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
            # Fortæl SSE-subscribers at PUSH-kanalen er væk så de kan falde
            # tilbage til MnT-pull i stedet for at vise misvisende grøn
            # "PUSH"-badge.
            try:
                get_cache()._broadcast({  # noqa: SLF001
                    "type": "pxgrid_disabled",
                    "reason": "worker_stopped",
                })
            except Exception:  # noqa: BLE001
                pass

    async def _run_loop(self) -> None:
        s = config.settings
        backoff = max(0.5, s.pxgrid_stomp_reconnect_min_s)
        try:
            while not self._stop_event.is_set():
                iter_start = time.time()
                try:
                    await self._one_session()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self._status.last_error = f"{type(exc).__name__}: {exc}"
                    logger.warning("pxgrid worker iteration failed: %s", exc)
                self._status.connected = False
                self._status.last_disconnect_at = time.time()
                if self._stop_event.is_set():
                    break
                # Reset backoff hvis vi nåede at subscribere denne iteration
                # (last_connect_at opdateres efter vellykket STOMP SUBSCRIBE).
                # En recv_timeout eller anden fejl EFTER subscribe tæller stadig
                # som "session var oppe" — backoff nulstilles så reconnect er hurtig.
                if self._status.last_connect_at > iter_start:
                    backoff = max(0.5, s.pxgrid_stomp_reconnect_min_s)
                self._status.reconnect_count += 1
                logger.info(
                    "pxgrid worker venter %.1fs inden reconnect (#%d)",
                    backoff, self._status.reconnect_count,
                )
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

    async def _one_session(self) -> None:
        """One bootstrap+subscribe cycle. Raises on any error; returns normally
        only on graceful shutdown (stop_event). Caller resets backoff based on
        whether last_connect_at was updated (= SUBSCRIBE succeeded)."""
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
        # WebSocket ping/pong (ping_interval=20, ping_timeout=10) er den primære
        # liveness-mekanisme og detekterer en død TCP-forbindelse inden for 30s.
        # recv_timeout er kun backstop mod en broker der er TCP-alive men tavs;
        # ISE pxGrid broker kan have stille perioder på langt over 120s (ingen
        # sessions der skifter state), så vi bruger den konfigurerbare setting
        # (default 600s) fremfor en hardkodet 120s.
        recv_timeout = float(getattr(s, "pxgrid_stomp_recv_timeout_s", 600.0))

        async with websockets.connect(
            ws_url,
            ssl=ssl_ctx,
            subprotocols=["v12.stomp"],
            additional_headers={"Authorization": f"Basic {basic_auth}"},
            open_timeout=10,
            ping_interval=20,
            ping_timeout=10,
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

            # SUBSCRIBE — én frame pr. topic, distinct sub-id'er så vi kan
            # route incoming MESSAGE-frames via 'subscription'-headeren.
            sub_map: dict[str, str] = {SUB_ID_SESSION: topic}
            await ws.send(stomp.subscribe_frame(topic, sub_id=SUB_ID_SESSION))
            if s.pxgrid_endpoint_topic_enabled:
                # ServiceLookup på endpoint-servicen så vi får ISE's kanoniske
                # topic (kan afvige fra default-konfig pr. ISE-version).
                ep_topic = s.pxgrid_endpoint_topic
                self._status.endpoint_lookup_service = s.pxgrid_endpoint_service
                try:
                    ep_nodes = await client.service_lookup(s.pxgrid_endpoint_service)
                    if ep_nodes:
                        props = dict(ep_nodes[0].properties)
                        self._status.endpoint_lookup_props = props
                        logger.info(
                            "pxgrid endpoint-service '%s' returnerede properties=%s",
                            s.pxgrid_endpoint_service, props,
                        )
                        # Prøv flere kendte property-navne i prioriteret rækkefølge.
                        discovered = (
                            props.get("topic")
                            or props.get("endpointTopic")
                            or props.get("wsPubsubTopic")
                            or ""
                        )
                        if discovered:
                            ep_topic = discovered
                            logger.info(
                                "bruger discovered topic=%s", discovered,
                            )
                        else:
                            logger.warning(
                                "ServiceLookup på '%s' returnerede INGEN topic-property "
                                "(properties: %s) — bruger konfigureret fallback '%s'. "
                                "Hvis events udebliver er fallback-navnet sandsynligvis "
                                "ikke den faktiske broker-destination.",
                                s.pxgrid_endpoint_service, list(props.keys()), ep_topic,
                            )
                except Exception as exc:  # noqa: BLE001
                    self._status.last_error = (
                        f"endpoint-topic ServiceLookup('{s.pxgrid_endpoint_service}') "
                        f"fejlede: {exc} — fallback til konfigureret '{ep_topic}'. "
                        f"Hvis events stadig udebliver: prøv et andet service-navn "
                        f"(com.cisco.ise.config.profiler, com.cisco.ise.endpoint.asset)."
                    )
                    logger.warning(self._status.last_error)
                sub_map[SUB_ID_ENDPOINT] = ep_topic
                await ws.send(stomp.subscribe_frame(ep_topic, sub_id=SUB_ID_ENDPOINT))
                # Opdater status så UI viser den faktisk subscribede topic
                # (ikke bare det konfigurerede default).
                self._status.subscribed_topics = [topic, ep_topic]

            self._status.connected = True
            self._status.last_connect_at = time.time()
            self._status.last_error = ""
            logger.info(
                "pxgrid session worker subscribed to %s on %s",
                ", ".join(sub_map.values()), peer.node_name,
            )

            # Reconcilér session-cache mod MnT ActiveList efter reconnect så
            # disconnect-events misset under offline-vinduet ikke efterlader
            # stale grønne rækker i Browse. Best-effort: fejl blokerer ikke.
            await _reconcile_cache_with_mnt(cache, client=client)

            while not self._stop_event.is_set():
                try:
                    chunk = await asyncio.wait_for(ws.recv(), timeout=recv_timeout)
                except asyncio.TimeoutError:
                    raise RuntimeError(
                        f"Broker tavs i {recv_timeout:.0f}s — ingen STOMP-frames modtaget "
                        f"(WebSocket ping/pong OK; øg pxgrid_stomp_recv_timeout_s hvis "
                        f"ISE-broker har lange idle-perioder)"
                    ) from None
                buf += chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
                frames, buf = stomp.split_frames(buf)
                for f in frames:
                    if f.command == "MESSAGE":
                        self._status.messages_total += 1
                        self._status.last_event_at = time.time()
                        cache.note_message()
                        sub_id = f.headers.get("subscription", SUB_ID_SESSION)
                        if sub_id == SUB_ID_ENDPOINT:
                            self._status.endpoint_events_total += 1
                            await _handle_endpoint_body(f.body, cache)
                        else:
                            self._status.session_events_total += 1
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


async def _handle_endpoint_body(body: bytes, cache) -> None:  # type: ignore[no-untyped-def]
    """Endpoint-event fra com.cisco.ise.endpoint topic.

    Payload-shape varierer (CREATE/UPDATE/DELETE-events fra ISE-admin).
    Vi udtrækker MAC + ISE-ID best-effort, invaliderer 2.8.0 endpoint-
    cache for det specifikke endpoint, og broadcaster en
    ``endpoint_changed``-event på samme SSE-bus så frontend kan reload
    rækken uden poll. Hvis ID mangler invaliderer vi hele cachen
    (sjældent men sikkert fallback).
    """
    if not body:
        return
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return
    items = _extract_endpoints(payload)
    if not items:
        return
    ep_cache = get_endpoint_cache()
    import time as _time
    for d in items:
        ep_id = (
            d.get("id") or d.get("endpointId") or d.get("operatingSystem", {}).get("id")
            or ""
        )
        mac = (d.get("mac") or d.get("macAddress") or d.get("name") or "").upper()
        operation = (
            d.get("operation") or d.get("eventType") or d.get("action") or ""
        ).upper()
        if ep_id:
            ep_cache.invalidate_detail(str(ep_id))
        else:
            ep_cache.invalidate_all()
        # Genbrug session-cachens broadcaster — alle SSE-subscribere får
        # det her event-type på samme stream som de allerede lytter på.
        cache._broadcast({  # noqa: SLF001
            "type": "endpoint_changed",
            "id": ep_id,
            "mac": mac,
            "operation": operation or "UPDATE",
            "ts": _time.time(),
        })


def _extract_endpoints(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("endpoints", "endpoint", "data"):
            v = payload.get(key)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
            if isinstance(v, dict):
                return [v]
        if any(k in payload for k in ("id", "mac", "macAddress", "endpointId")):
            return [payload]
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    return []


def _build_session_info(d: dict[str, Any]) -> SessionInfo:
    mac = (
        d.get("callingStationId")
        or d.get("macAddress")
        or d.get("mac")
        or ""
    )
    azn_raw = (
        d.get("selectedAznProfiles")
        or d.get("authorizationProfiles")
        or []
    )
    if isinstance(azn_raw, str):
        azn_raw = [azn_raw]
    elif not isinstance(azn_raw, list):
        azn_raw = []
    return SessionInfo(
        mac=str(mac),
        state=str(d.get("state", "") or d.get("sessionEvent", "")),
        audit_session_id=str(d.get("auditSessionId", "")),
        nas_ip=str(d.get("nasIpAddress", "") or d.get("nasIp", "")),
        user_name=str(d.get("userName", "") or d.get("username", "")),
        policy_set_name=str(d.get("policySetName", "")),
        authz_profiles=[str(p) for p in azn_raw if p],
        raw=d,
    )


async def _reconcile_cache_with_mnt(cache, client: PxGridClient | None = None) -> None:  # type: ignore[no-untyped-def]
    """Synkroniser pxGrid session-cache ved reconnect.

    Forsøger pxGrid REST getSessions (rig data: policySetName + selectedAznProfiles)
    som primær kilde. Falder tilbage til MnT ActiveList hvis getSessions fejler.

    Best-effort: enhver fejl logges og ignoreres så normal drift fortsætter.
    """
    # Primary: pxGrid REST getSessions — returnerer fuld session-payload med policy-data.
    if client is not None:
        try:
            pxgrid_sessions = await client.get_sessions()
            if pxgrid_sessions:
                await _reconcile_from_pxgrid(cache, pxgrid_sessions)
                return
            logger.debug("pxgrid reconcile: getSessions returnerede 0 sessioner, prøver MnT")
        except Exception as exc:  # noqa: BLE001
            logger.debug("pxgrid reconcile: getSessions fejlede, falder tilbage til MnT: %s", exc)

    # Fallback: MnT ActiveList (lavere data-fidelitet — mangler typisk policy-felter).
    await _reconcile_from_mnt(cache)


async def _reconcile_from_pxgrid(cache, sessions: list[dict]) -> None:
    """Reconcile cache mod pxGrid getSessions-data (fuld payload)."""
    try:
        # Byg map: normaliseret MAC → session-dict.
        pg_by_mac: dict[str, dict] = {}
        for sess in sessions:
            mac_raw = (
                sess.get("callingStationId")
                or sess.get("macAddress")
                or sess.get("mac")
                or ""
            )
            if not mac_raw:
                continue
            mac = str(mac_raw).upper().replace("-", ":").strip()
            if len(mac) == 17 and mac.count(":") == 5:
                pg_by_mac[mac] = sess
        pg_macs = set(pg_by_mac.keys())

        cached = await cache.list()
        cached_macs = {entry.mac for entry in cached}

        # 1. Evict stale cache-entries.
        evicted = 0
        for entry in cached:
            if entry.mac not in pg_macs:
                await cache.remove(entry.mac)
                evicted += 1

        # 2. Seed manglende sessioner med fuld policy-data.
        seeded = 0
        updated = 0
        for mac, sess in pg_by_mac.items():
            info = _build_session_info(sess)
            info_with_mac = SessionInfo(
                mac=mac,
                state=info.state or "STARTED",
                audit_session_id=info.audit_session_id,
                nas_ip=info.nas_ip,
                user_name=info.user_name,
                policy_set_name=info.policy_set_name,
                authz_profiles=info.authz_profiles,
                raw=info.raw,
            )
            if mac not in cached_macs:
                await cache.upsert(info_with_mac)
                seeded += 1
            else:
                # Opdatér eksisterende entry med policy-data hvis det mangler.
                existing = next((e for e in cached if e.mac == mac), None)
                if existing and not existing.policy_set_name and info_with_mac.policy_set_name:
                    await cache.upsert(info_with_mac)
                    updated += 1

        logger.info(
            "pxgrid reconcile (getSessions): evicted=%d seeded=%d updated=%d",
            evicted, seeded, updated,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("pxgrid reconcile (getSessions): uventet fejl: %s", exc)


async def _reconcile_from_mnt(cache) -> None:  # type: ignore[no-untyped-def]
    """Fallback reconcile via MnT ActiveList (lavere data-fidelitet)."""
    try:
        from app.ise.mnt_sessions import fetch_active_sessions
    except ImportError:
        return
    try:
        sessions = await fetch_active_sessions()
    except Exception as exc:  # noqa: BLE001
        logger.debug("pxgrid reconcile: MnT ActiveList fejlede: %s", exc)
        return
    try:
        if sessions:
            logger.debug("pxgrid reconcile: MnT session-felter: %s", sorted(sessions[0].keys()))
        mnt_by_mac: dict[str, dict] = {}
        for sess in sessions:
            mac_raw = (
                sess.get("calling_station_id", "")
                or sess.get("callingstationid", "")
                or ""
            )
            if not mac_raw:
                continue
            mac = mac_raw.upper().replace("-", ":").strip()
            if len(mac) == 17 and mac.count(":") == 5:
                mnt_by_mac[mac] = sess
        mnt_macs = set(mnt_by_mac.keys())

        cached = await cache.list()
        cached_macs = {entry.mac for entry in cached}
        evicted = 0
        for entry in cached:
            if entry.mac not in mnt_macs:
                await cache.remove(entry.mac)
                evicted += 1

        seeded = 0
        for mac, sess in mnt_by_mac.items():
            if mac in cached_macs:
                continue
            policy_set_name = str(
                sess.get("isepolicysetname", "")
                or sess.get("ise-policy-set-name", "")
                or sess.get("ise_policy_set_name", "")
                or sess.get("policyset", "")
                or ""
            )
            authz_raw = str(
                sess.get("selectedazprofiles", "")
                or sess.get("selectedaznprofiles", "")
                or sess.get("authorizationprofiles", "")
                or sess.get("authorization-profiles", "")
                or sess.get("authorizationrule", "")
                or ""
            )
            authz_profiles = [p.strip() for p in authz_raw.split(",") if p.strip()]
            info = SessionInfo(
                mac=mac,
                state="STARTED",
                audit_session_id=str(sess.get("audit_session_id", "") or sess.get("auditsessionid", "")),
                nas_ip=str(sess.get("nas_ip_address", "") or sess.get("nasipaddress", "") or sess.get("nas-ip-address", "")),
                user_name=str(sess.get("user_name", "") or sess.get("username", "")),
                policy_set_name=policy_set_name,
                authz_profiles=authz_profiles,
            )
            await cache.upsert(info)
            seeded += 1

        if evicted or seeded:
            logger.info(
                "pxgrid reconcile (MnT): fjernede %d stale, seedede %d sessioner",
                evicted, seeded,
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("pxgrid reconcile (MnT): uventet fejl: %s", exc)


_worker: PxGridSessionWorker | None = None


def get_worker() -> PxGridSessionWorker:
    global _worker
    if _worker is None:
        _worker = PxGridSessionWorker()
    return _worker
