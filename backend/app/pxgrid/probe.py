"""Minimal STOMP-prober for pxGrid pubsub-laget.

Bygger ovenpå ``client.PxGridClient`` (REST-bootstrap) og verificerer
at WebSocket+STOMP-laget også fungerer end-to-end *før* vi investerer
i fuld session-cache + SSE-stream til frontend.

Walks::

    1. ServiceLookup("com.cisco.ise.pubsub")  → wsUrl + nodeName
    2. AccessSecretCreate(nodeName)           → per-peer secret
    3. WebSocket connect (mTLS)               → upgrade på wsUrl
    4. STOMP CONNECT                          → login=node, passcode=secret
    5. STOMP SUBSCRIBE /topic/com.cisco.ise.session
    6. Læs frames i ``duration_s`` sekunder, count MESSAGE-frames
    7. STOMP DISCONNECT, luk WS

Returnerer struktureret rapport så fejl kan stedfæstes til præcis ét
trin (cert/lookup/connect/subscribe/timeout). Read-only og selvterminerende
— skriver ikke til cache, kan trigges flere gange uden bivirkning.
"""
from __future__ import annotations

import asyncio
import logging
import ssl
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

from app.core import config
from app.pxgrid import cert_manager, stomp
from app.pxgrid.client import PxGridClient
from app.pxgrid.exceptions import PxGridError

logger = logging.getLogger(__name__)

SESSION_TOPIC = "/topic/com.cisco.ise.session"
PUBSUB_SERVICE = "com.cisco.ise.pubsub"
MAX_SAMPLES = 3
MAX_SAMPLE_BYTES = 1024


@dataclass
class ProbeResult:
    ok: bool
    step: str
    duration_s: float
    messages_received: int = 0
    sample_payloads: list[str] = field(default_factory=list)
    ws_url: str = ""
    peer_node: str = ""
    error: str = ""


def _build_ssl_context(bundle: cert_manager.CertBundle) -> ssl.SSLContext:
    """Same trust store as httpx uses for the REST control plane —
    samme cert til mTLS, samme CA-bundle til server-validation."""
    ctx = ssl.create_default_context()
    if bundle.ca_path:
        ctx.load_verify_locations(cafile=str(bundle.ca_path))
    ctx.load_cert_chain(
        certfile=str(bundle.cert_path), keyfile=str(bundle.key_path)
    )
    return ctx


async def run_session_probe(duration_s: float = 10.0) -> ProbeResult:
    """Run a one-shot subscribe-and-listen probe against the pubsub broker.

    Returnerer altid en ProbeResult — kaster ikke. Hvis intet event kommer
    i tidsvinduet, ok=True, messages_received=0 (det er ikke en fejl,
    bare lav RADIUS-trafik).
    """
    start = time.perf_counter()
    s = config.settings
    if not s.pxgrid_enabled:
        return ProbeResult(
            ok=False,
            step="config",
            duration_s=0.0,
            error="PxGrid er deaktiveret — slå pxgrid_enabled til først.",
        )

    try:
        import websockets
    except ImportError:
        return ProbeResult(
            ok=False,
            step="config",
            duration_s=0.0,
            error="'websockets' pakken er ikke installeret. Kør 'pip install websockets'.",
        )

    # Step 1+2: bootstrap via REST
    client = PxGridClient()
    try:
        bundle = cert_manager.load_bundle(
            s.pxgrid_cert_path, s.pxgrid_key_path, s.pxgrid_ca_bundle_path
        )
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(
            ok=False,
            step="cert_load",
            duration_s=time.perf_counter() - start,
            error=str(exc),
        )

    try:
        nodes = await client.service_lookup(PUBSUB_SERVICE)
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(
            ok=False,
            step="service_lookup",
            duration_s=time.perf_counter() - start,
            error=f"ServiceLookup({PUBSUB_SERVICE}) fejlede: {exc}",
        )
    peer = nodes[0]
    ws_url = peer.ws_url
    if not ws_url:
        return ProbeResult(
            ok=False,
            step="service_lookup",
            duration_s=time.perf_counter() - start,
            error=f"Pubsub-noden {peer.node_name} returnerede tom wsUrl",
            peer_node=peer.node_name,
        )

    try:
        secret = await client.access_secret_create(peer.node_name)
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(
            ok=False,
            step="access_secret",
            duration_s=time.perf_counter() - start,
            error=f"AccessSecretCreate({peer.node_name}) fejlede: {exc}",
            ws_url=ws_url,
            peer_node=peer.node_name,
        )

    # Step 3-7: WebSocket + STOMP
    ssl_ctx = _build_ssl_context(bundle)
    parsed = urlparse(ws_url)
    host = parsed.hostname or "ise"

    samples: list[str] = []
    msg_count = 0
    try:
        async with websockets.connect(
            ws_url,
            ssl=ssl_ctx,
            subprotocols=["v12.stomp"],
            open_timeout=10,
            ping_interval=None,  # broker bruger STOMP heart-beat, ikke WS ping
        ) as ws:
            # CONNECT
            await ws.send(stomp.connect_frame(host, s.pxgrid_node_name, secret))
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=10.0)
            except asyncio.TimeoutError:
                return ProbeResult(
                    ok=False,
                    step="stomp_connect",
                    duration_s=time.perf_counter() - start,
                    error="STOMP CONNECT timeout — broker svarede ikke inden 10s",
                    ws_url=ws_url,
                    peer_node=peer.node_name,
                )
            buf = first if isinstance(first, bytes) else first.encode("utf-8")
            frames, buf = stomp.split_frames(buf)
            connected = next((f for f in frames if f.command == "CONNECTED"), None)
            if not connected:
                err = next((f for f in frames if f.command == "ERROR"), None)
                err_msg = (
                    err.body.decode("utf-8", errors="replace")
                    if err
                    else f"forventede CONNECTED, fik {[f.command for f in frames]}"
                )
                return ProbeResult(
                    ok=False,
                    step="stomp_connect",
                    duration_s=time.perf_counter() - start,
                    error=f"STOMP CONNECT afvist: {err_msg}",
                    ws_url=ws_url,
                    peer_node=peer.node_name,
                )

            # SUBSCRIBE
            await ws.send(stomp.subscribe_frame(SESSION_TOPIC))

            # Drain frames i tidsvinduet
            deadline = time.perf_counter() + duration_s
            while True:
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    break
                try:
                    chunk = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                except websockets.ConnectionClosed:
                    break
                buf += chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
                frames, buf = stomp.split_frames(buf)
                for f in frames:
                    if f.command == "MESSAGE":
                        msg_count += 1
                        if len(samples) < MAX_SAMPLES:
                            body = f.body[:MAX_SAMPLE_BYTES].decode(
                                "utf-8", errors="replace"
                            )
                            samples.append(body)
                    elif f.command == "ERROR":
                        return ProbeResult(
                            ok=False,
                            step="stomp_subscribe",
                            duration_s=time.perf_counter() - start,
                            error="STOMP ERROR: "
                            + f.body.decode("utf-8", errors="replace"),
                            ws_url=ws_url,
                            peer_node=peer.node_name,
                            messages_received=msg_count,
                            sample_payloads=samples,
                        )

            # DISCONNECT (best-effort, broker kan have lukket allerede)
            try:
                await ws.send(stomp.disconnect_frame())
            except Exception:  # noqa: BLE001
                pass

    except ssl.SSLError as exc:
        return ProbeResult(
            ok=False,
            step="ws_connect",
            duration_s=time.perf_counter() - start,
            error=f"TLS-fejl mod {ws_url}: {exc}",
            ws_url=ws_url,
            peer_node=peer.node_name,
        )
    except OSError as exc:
        return ProbeResult(
            ok=False,
            step="ws_connect",
            duration_s=time.perf_counter() - start,
            error=f"Netværks-fejl mod {ws_url}: {exc}",
            ws_url=ws_url,
            peer_node=peer.node_name,
        )
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(
            ok=False,
            step="ws_connect",
            duration_s=time.perf_counter() - start,
            error=f"Uventet fejl: {exc}",
            ws_url=ws_url,
            peer_node=peer.node_name,
        )

    elapsed = time.perf_counter() - start
    logger.info(
        "pxgrid stomp-probe: ok ws=%s msgs=%d duration=%.1fs",
        ws_url,
        msg_count,
        elapsed,
    )
    return ProbeResult(
        ok=True,
        step="complete",
        duration_s=elapsed,
        messages_received=msg_count,
        sample_payloads=samples,
        ws_url=ws_url,
        peer_node=peer.node_name,
    )
