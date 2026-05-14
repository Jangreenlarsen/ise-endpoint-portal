"""Read-only API til pxGrid session-cache + worker-status (Phase 2b).

Cache fyldes af ``pxgrid.session_worker``. Disse endpoints er
forbrugerens vej ind — enhver authentikeret bruger må læse cache
(samme niveau som MnT session-list); kun admin må læse worker-status
(indeholder peer-node + reconnect-tæller som er drift-info).
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, require_admin, require_any
from app.core import auth as auth_core
from app.core import config
from app.core.user_store import find_by_id, load_users
from app.pxgrid.session_cache import get_cache
from app.pxgrid.session_worker import get_worker
from app.schemas.settings import (
    PxGridSessionInfoResponse,
    PxGridSessionsResponse,
    PxGridWorkerStatusResponse,
)

logger = logging.getLogger(__name__)
SSE_KEEPALIVE_SECONDS = 15.0

router = APIRouter(prefix="/pxgrid", tags=["pxgrid"])


@router.get(
    "/sessions",
    response_model=PxGridSessionsResponse,
    dependencies=[Depends(require_any)],
)
async def list_sessions() -> PxGridSessionsResponse:
    cache = get_cache()
    max_age = config.settings.pxgrid_session_cache_max_age_s
    items = await cache.list(max_age_s=max_age)
    return PxGridSessionsResponse(
        sessions=[
            PxGridSessionInfoResponse(
                mac=s.mac,
                state=s.state,
                audit_session_id=s.audit_session_id,
                nas_ip=s.nas_ip,
                user_name=s.user_name,
                policy_set_name=s.policy_set_name,
                authz_profiles=s.authz_profiles,
                use_case=s.use_case,
                nas_name=s.nas_name,
                nas_device_type=s.nas_device_type,
                last_event_at=s.last_event_at,
            )
            for s in items
        ],
        total=len(items),
        cache_stats=cache.stats(),
    )


@router.get("/sessions/stream")
async def sessions_stream(
    request: Request,
    token: str = Query("", description="Bearer-token (EventSource kan ikke sætte Auth-header)"),
):
    """SSE-stream af session-cache deltas.

    **VIGTIGT:** denne route SKAL stå før ``/sessions/{mac}`` så FastAPI
    ikke matcher ``/sessions/stream`` som ``mac="stream"`` og returnerer 404.

    Browser's ``EventSource`` API understøtter ikke custom headers, så vi
    accepterer JWT'en som query-param i stedet for ``Authorization``-header.
    Validerer manuelt mod samme JWT-codepath som require_any.

    Event-types:
      - ``snapshot``: initial fuld liste ved connect
      - ``upsert``: ny eller opdateret session
      - ``remove``: session disconnected
      - ``clear``: cache wiped (worker-reset)
      - ``ping``: keepalive (hver 15s)
    """
    payload = auth_core.verify_token(token) if token else None
    if not payload or not isinstance(payload.get("sub"), str):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Manglende eller ugyldigt token"
        )
    # TACACS+-brugere har ingen lokal record — al info er i token (samme logik som deps.get_current_user).
    if payload.get("auth_type") == "tacacs":
        role = payload.get("role", "")
        if not role:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Ugyldigt TACACS+ token")
    else:
        record = find_by_id(load_users(), payload["sub"])
        if not record or record["role"] != payload.get("role"):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bruger ikke fundet")

    cache = get_cache()
    queue = cache.subscribe()

    async def event_generator():
        try:
            # Hvis pxGrid er disabled OR worker ikke kører, fortæl klienten det
            # eksplicit via 'pxgrid_disabled'-event så frontend kan falde tilbage
            # til MnT-poll i stedet for at vise misvisende "PUSH"-status.
            if not config.settings.pxgrid_enabled:
                disabled = {
                    "type": "pxgrid_disabled",
                    "reason": "pxgrid_enabled=false",
                }
                yield f"event: pxgrid_disabled\ndata: {json.dumps(disabled)}\n\n"
                return

            initial = await cache.list(
                max_age_s=config.settings.pxgrid_session_cache_max_age_s
            )
            snapshot = {
                "type": "snapshot",
                "sessions": [s.to_dict() for s in initial],
            }
            yield f"event: snapshot\ndata: {json.dumps(snapshot)}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    evt = await asyncio.wait_for(
                        queue.get(), timeout=SSE_KEEPALIVE_SECONDS
                    )
                    yield f"event: {evt['type']}\ndata: {json.dumps(evt)}\n\n"
                    # Hvis vi har sendt et pxgrid_disabled-event (broadcastet
                    # fra worker.stop() ved settings-skift), lukker vi pænt så
                    # klienten ikke fortsætter med stale state.
                    if evt.get("type") == "pxgrid_disabled":
                        return
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            raise
        finally:
            cache.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering hvis foran proxy
            "Connection": "keep-alive",
        },
    )


@router.get(
    "/sessions/{mac}",
    response_model=PxGridSessionInfoResponse,
    dependencies=[Depends(require_any)],
)
async def get_session(mac: str) -> PxGridSessionInfoResponse:
    cache = get_cache()
    max_age = config.settings.pxgrid_session_cache_max_age_s
    info = await cache.get(mac, max_age_s=max_age)
    if not info:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"Ingen aktiv session for {mac}"
        )
    return PxGridSessionInfoResponse(
        mac=info.mac,
        state=info.state,
        audit_session_id=info.audit_session_id,
        nas_ip=info.nas_ip,
        user_name=info.user_name,
        policy_set_name=info.policy_set_name,
        authz_profiles=info.authz_profiles,
        use_case=info.use_case,
        nas_name=info.nas_name,
        nas_device_type=info.nas_device_type,
        last_event_at=info.last_event_at,
    )


@router.get(
    "/worker/status",
    response_model=PxGridWorkerStatusResponse,
    dependencies=[Depends(require_admin)],
)
async def worker_status() -> PxGridWorkerStatusResponse:
    w = get_worker()
    st = w.status
    cache = get_cache()
    return PxGridWorkerStatusResponse(
        running=st.running,
        connected=st.connected,
        peer_node=st.peer_node,
        ws_url=st.ws_url,
        started_at=st.started_at,
        last_connect_at=st.last_connect_at,
        last_disconnect_at=st.last_disconnect_at,
        last_event_at=st.last_event_at,
        last_error=st.last_error,
        reconnect_count=st.reconnect_count,
        messages_total=st.messages_total,
        subscribed_topic=st.subscribed_topic,
        subscribed_topics=list(st.subscribed_topics),
        session_events_total=st.session_events_total,
        endpoint_events_total=st.endpoint_events_total,
        endpoint_lookup_service=st.endpoint_lookup_service,
        endpoint_lookup_props=dict(st.endpoint_lookup_props),
        cache_size=cache.stats()["size"],
    )


@router.post(
    "/worker/restart",
    response_model=PxGridWorkerStatusResponse,
    dependencies=[Depends(require_admin)],
)
async def worker_restart() -> PxGridWorkerStatusResponse:
    """Stop + start worker uden at gemme settings — bruges hvis admin
    vil tvinge en fresh ServiceLookup + reconnect (fx efter PSN-skift)."""
    w = get_worker()
    await w.stop()
    w.start()
    return await worker_status()
