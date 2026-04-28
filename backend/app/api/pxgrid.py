"""Read-only API til pxGrid session-cache + worker-status (Phase 2b).

Cache fyldes af ``pxgrid.session_worker``. Disse endpoints er
forbrugerens vej ind — enhver authentikeret bruger må læse cache
(samme niveau som MnT session-list); kun admin må læse worker-status
(indeholder peer-node + reconnect-tæller som er drift-info).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_admin, require_any
from app.core import config
from app.pxgrid.session_cache import get_cache
from app.pxgrid.session_worker import get_worker
from app.schemas.settings import (
    PxGridSessionInfoResponse,
    PxGridSessionsResponse,
    PxGridWorkerStatusResponse,
)

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
                last_event_at=s.last_event_at,
            )
            for s in items
        ],
        total=len(items),
        cache_stats=cache.stats(),
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
