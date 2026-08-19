# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import require_admin, require_any
from app.core import config
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
                authz_rule_name=s.authz_rule_name,
                use_case=s.use_case,
                nas_name=s.nas_name,
                nas_device_type=s.nas_device_type,
                last_event_at=s.last_event_at,
                endpoint_policy=s.endpoint_policy,
                dacl=s.dacl,
                vlan=s.vlan,
                cts_security_group=s.cts_security_group,
                identity_group=s.identity_group,
                auth_method=s.auth_method,
                framed_ip=s.framed_ip,
            )
            for s in items
        ],
        total=len(items),
        cache_stats=cache.stats(),
    )


@router.get("/sessions/stream", dependencies=[Depends(require_any)])
async def sessions_stream(request: Request):
    """SSE-stream af session-cache deltas.

    **VIGTIGT:** denne route SKAL stå før ``/sessions/{mac}`` så FastAPI
    ikke matcher ``/sessions/stream`` som ``mac="stream"`` og returnerer 404.

    **Autorisation:** ``require_any`` — samme niveau som ``/sessions`` og
    ``/sessions/{mac}``, der serverer de samme data. Rollekravet lå tidligere i
    en håndrullet kopi af ``get_current_user`` her i funktionskroppen, og den
    kopi validerede token men **aldrig rollen** — så ``registrant`` og
    ``registrant_templet``, der ikke må browse endpoints, kunne læse hele
    live-strømmen af RADIUS-sessioner (BUGS.md F-04). Duplikér ikke auth-logik;
    brug dependencies.

    EventSource kan ikke sætte custom headers, men sender same-origin cookies
    med ``withCredentials`` — den httpOnly ``hv_token``-cookie er derfor nok, og
    ``get_current_user`` læser den. Den tidligere ``?token=``-query-fallback er
    fjernet: frontenden brugte den ikke, og query-strenge havner i proxy-logs og
    browserhistorik.

    Event-types:
      - ``snapshot``: initial fuld liste ved connect
      - ``upsert``: ny eller opdateret session
      - ``remove``: session disconnected
      - ``clear``: cache wiped (worker-reset)
      - ``ping``: keepalive (hver 15s)
    """
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
        authz_rule_name=info.authz_rule_name,
        use_case=info.use_case,
        nas_name=info.nas_name,
        nas_device_type=info.nas_device_type,
        last_event_at=info.last_event_at,
        endpoint_policy=info.endpoint_policy,
        dacl=info.dacl,
        vlan=info.vlan,
        cts_security_group=info.cts_security_group,
        identity_group=info.identity_group,
        auth_method=info.auth_method,
        framed_ip=info.framed_ip,
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


@router.get(
    "/sessions/{mac}/debug",
    dependencies=[Depends(require_admin)],
    summary="Diagnostik: cached session + frisk pxGrid+MnT data for en MAC (admin only)",
)
async def debug_session(mac: str) -> dict:
    """Returnerer tre datasæt for én MAC til at diagnosticere Session-kolonne:
    1. `cached`: hvad der pt. er i session-cache (hvad frontend ser)
    2. `mnt`: frisk MnT probe (Session/MACAddress + AuthStatus/MACAddress)
    3. `pxgrid_fields`: hvilke policy-felter pxGrid leverede i cache.raw
    """
    from app.ise.mnt_sessions import fetch_session_by_mac, probe_session_detail
    norm = mac.upper().replace("-", ":").strip()
    cache = get_cache()
    entry = await cache.get(norm)
    cached_data = entry.to_dict() if entry else None
    # Vis hvad pxGrid raw-payload faktisk indeholder (policy-relevante felter)
    pxgrid_policy_fields: dict = {}
    if entry and entry.raw:
        for key in sorted(entry.raw.keys()):
            v = entry.raw[key]
            if isinstance(v, (str, list, int, float, bool)) or v is None:
                pxgrid_policy_fields[key] = v
    # Frisk MnT-data
    try:
        mnt_enrichment = await fetch_session_by_mac(norm)
    except Exception as exc:  # noqa: BLE001
        mnt_enrichment = {"error": str(exc)}
    try:
        mnt_probe = await probe_session_detail(norm)
    except Exception as exc:  # noqa: BLE001
        mnt_probe = {"error": str(exc)}
    return {
        "mac": norm,
        "cached": cached_data,
        "pxgrid_raw_all_fields": pxgrid_policy_fields,
        "mnt_enrichment_result": mnt_enrichment,
        "mnt_probe": mnt_probe,
    }


@router.get(
    "/probe/mnt/{mac}",
    dependencies=[Depends(require_admin)],
    summary="Diagnostik: hent alle MnT-felter for en MAC (admin only)",
)
async def probe_mnt_session(mac: str) -> dict:
    """Kalder MnT Session/MACAddress og AuthStatus/MACAddress og returnerer
    alle felter som ISE leverer. Bruges til at undersøge om ISEPolicySetName
    og AuthorizationPolicyMatchedRule er tilgængelige i det live system."""
    from app.ise.mnt_sessions import probe_session_detail
    return await probe_session_detail(mac)


@router.get(
    "/anomalies",
    dependencies=[Depends(require_any)],
    summary="Aktive session-anomali-alerts",
)
async def get_anomalies() -> list[dict]:
    """Returnerer aktive anomali-alerts fra session-stream (bulk-disconnect, NAS-IP churn).
    Tom liste hvis pxGrid er slukket eller ingen anomalier er detekteret."""
    from app.core.alert_store import get_alerts
    return [
        {"id": a.id, "severity": a.severity, "title": a.title, "body": a.body, "since": a.since}
        for a in get_alerts()
        if a.id.startswith("anomaly_")
    ]


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
