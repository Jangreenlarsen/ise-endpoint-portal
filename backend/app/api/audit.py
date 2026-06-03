# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Audit log API (2.9.0): browse + rollback.

GET  /api/audit               -> paginated event list, filters:
                                   actor, resource_type, resource_id,
                                   from_ts, to_ts, limit, offset
GET  /api/audit/{id}          -> one event with before/after
POST /api/audit/{id}/rollback -> restore the "before" state of an event

Rollback is admin-only and currently supports endpoints and DACLs.
The rollback itself is recorded as a new audit event (action="rolled_back")
so the history stays append-only.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.api.deps import (
    get_dacl_service,
    get_endpoint_service,
    require_admin,
)
from app.core import audit_store
from app.core.exceptions import IseApiError
from app.schemas.audit import AuditEvent, AuditListResponse, RollbackResponse
from app.schemas.dacl import UpdateDaclRequest
from app.schemas.endpoint import CustomAttrs, EndpointUpdate
from app.services.dacl_service import DaclService
from app.services.endpoint_service import EndpointService

router = APIRouter(prefix="/audit", tags=["audit"])

logger = logging.getLogger(__name__)


def _parse(blob: str | None) -> Any:
    if blob is None:
        return None
    try:
        return json.loads(blob)
    except (TypeError, ValueError):
        return blob


def _to_event(row: dict) -> AuditEvent:
    return AuditEvent(
        id=row["id"],
        ts=row["ts"],
        actor_id=row.get("actor_id") or "",
        actor_username=row["actor_username"],
        action=row["action"],
        resource_type=row["resource_type"],
        resource_id=row.get("resource_id"),
        before=_parse(row.get("before_json")),
        after=_parse(row.get("after_json")),
        source_ip=row.get("source_ip") or "",
    )


@router.get(
    "", response_model=AuditListResponse, dependencies=[Depends(require_admin)]
)
async def list_events(
    actor: str | None = Query(None, max_length=200),
    resource_type: str | None = Query(None, max_length=100),
    resource_id: str | None = Query(None, max_length=200),
    from_ts: str | None = Query(None, description="ISO-8601 lower bound", max_length=50),
    to_ts: str | None = Query(None, description="ISO-8601 upper bound", max_length=50),
    search: str | None = Query(
        None,
        description="Bredsøgning (case-insensitive substring) på alle felter",
        max_length=500,
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AuditListResponse:
    rows, total = await audit_store.query(
        actor=actor,
        resource_type=resource_type,
        resource_id=resource_id,
        from_ts=from_ts,
        to_ts=to_ts,
        search=search,
        limit=limit,
        offset=offset,
    )
    return AuditListResponse(
        events=[_to_event(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/export", dependencies=[Depends(require_admin)])
async def export_events(
    actor: str | None = Query(None, max_length=200),
    resource_type: str | None = Query(None, max_length=100),
    resource_id: str | None = Query(None, max_length=200),
    from_ts: str | None = Query(None),
    to_ts: str | None = Query(None),
    search: str | None = Query(None, max_length=500),
) -> StreamingResponse:
    """Eksportér audit-log som CSV (max 10 000 rækker)."""
    rows, _ = await audit_store.query(
        actor=actor,
        resource_type=resource_type,
        resource_id=resource_id,
        from_ts=from_ts,
        to_ts=to_ts,
        search=search,
        limit=10_000,
        offset=0,
    )

    def _cell(v: Any) -> str:
        s = "" if v is None else str(v)
        if "," in s or '"' in s or "\n" in s:
            return f'"{s.replace(chr(34), chr(34) + chr(34))}"'
        return s

    def generate():
        yield "Tidsstempel,Bruger,Handling,Ressourcetype,Ressource-ID,IP-adresse\r\n"
        for r in rows:
            yield ",".join([
                _cell(r.get("ts")),
                _cell(r.get("actor_username")),
                _cell(r.get("action")),
                _cell(r.get("resource_type")),
                _cell(r.get("resource_id")),
                _cell(r.get("source_ip")),
            ]) + "\r\n"

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"audit_export_{ts}.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/{event_id}",
    response_model=AuditEvent,
    dependencies=[Depends(require_admin)],
)
async def get_event(event_id: int) -> AuditEvent:
    row = await audit_store.get(event_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audit-event ikke fundet")
    return _to_event(row)


@router.post(
    "/{event_id}/rollback",
    response_model=RollbackResponse,
    dependencies=[Depends(require_admin)],
)
async def rollback_event(
    event_id: int,
    ep_service: EndpointService = Depends(get_endpoint_service),
    dacl_service: DaclService = Depends(get_dacl_service),
) -> RollbackResponse:
    row = await audit_store.get(event_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audit-event ikke fundet")
    before = _parse(row.get("before_json"))
    after = _parse(row.get("after_json"))
    resource_type = row["resource_type"]
    resource_id = row.get("resource_id")
    action = row["action"]

    restored: Any = None
    message = ""

    if resource_type == "endpoint":
        restored, message = await _rollback_endpoint(
            action, resource_id, before, after, ep_service
        )
    elif resource_type == "dacl":
        restored, message = await _rollback_dacl(
            action, resource_id, before, after, dacl_service
        )
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Rollback understøttes ikke for resource_type={resource_type}",
        )

    await audit_store.record(
        "rolled_back",
        resource_type,
        resource_id,
        before={"source_event_id": event_id, "source_action": action},
        after=restored,
    )
    logger.info(
        "rolled back audit event %d (%s %s id=%s)",
        event_id, action, resource_type, resource_id,
    )
    return RollbackResponse(
        ok=True,
        event_id=event_id,
        resource_type=resource_type,
        resource_id=resource_id,
        message=message,
        restored=restored,
    )


async def _rollback_endpoint(
    action: str,
    resource_id: str | None,
    before: Any,
    after: Any,
    service: EndpointService,
) -> tuple[Any, str]:
    if action == "created":
        # Undo a create → delete the endpoint.
        if not resource_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mangler resource_id til rollback af oprettelse",
            )
        try:
            await service.delete_endpoint(resource_id)
        except IseApiError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"ISE afviste delete: {exc}"
            ) from exc
        return None, f"Endpoint {resource_id} slettet (rollback af oprettelse)"
    if action == "updated":
        if not isinstance(before, dict) or not resource_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mangler before-snapshot til rollback af update",
            )
        payload = _endpoint_update_from_snapshot(before)
        try:
            await service.update_endpoint(resource_id, payload)
        except IseApiError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"ISE afviste update: {exc}"
            ) from exc
        restored = (await service.get_endpoint(resource_id)).model_dump()
        return restored, f"Endpoint {resource_id} rullet tilbage"
    if action == "decommissioned":
        if not isinstance(before, dict) or not resource_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mangler before-snapshot til rollback af dekommissionering",
            )
        payload = _endpoint_update_from_snapshot(before)
        try:
            await service.update_endpoint(resource_id, payload)
        except IseApiError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"ISE afviste update: {exc}"
            ) from exc
        restored = (await service.get_endpoint(resource_id)).model_dump()
        return restored, f"Endpoint {resource_id} gendannet fra dekommissionering"
    if action == "template_applied":
        if not isinstance(before, dict) or not resource_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mangler before-snapshot til rollback af template_applied — ældre events har ingen snapshot",
            )
        payload = _endpoint_update_from_snapshot(before)
        try:
            await service.update_endpoint(resource_id, payload)
        except IseApiError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"ISE afviste update: {exc}"
            ) from exc
        restored = (await service.get_endpoint(resource_id)).model_dump()
        return restored, f"Endpoint {resource_id} rullet tilbage til tilstand før skabelon-anvendelse"
    if action == "deleted":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Rollback af sletning er ikke understøttet — genopret manuelt",
        )
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        f"Rollback understøttes ikke for action={action}",
    )


def _endpoint_update_from_snapshot(snap: dict) -> EndpointUpdate:
    """Build an EndpointUpdate DTO from a before-snapshot dict.

    Snapshots are produced by ``EndpointDetail.model_dump()``, which
    *flattens* custom attributes into individual fields (``endpoint_type``,
    ``owner``, ``lokation``, ``authz_vlan``, ``authz_acl``,
    ``platform_type``) and uses ``static_group`` rather than
    ``static_group_assignment``. We must rebuild ``CustomAttrs`` from
    those fields — otherwise the rollback PUT goes out with an empty
    custom-attributes dict, which (since build 0064) actively clears
    every CA on ISE instead of restoring them.
    """
    return EndpointUpdate(
        group_id=snap.get("group_id"),
        description=snap.get("description"),
        static_group_assignment=snap.get("static_group"),
        custom_attributes=CustomAttrs(
            Type=snap.get("endpoint_type") or "",
            Owner=snap.get("owner") or "",
            Lokation=snap.get("lokation") or "",
            AuthzVlan=snap.get("authz_vlan") or "",
            AuthzACL=snap.get("authz_acl") or "",
            PlatformType=snap.get("platform_type") or "",
            # Explicit empty strings so exclude_none=True keeps them and ISE clears the CAs.
            HypervisionStatus=snap.get("status") or "",
            HypervisionActive=snap.get("active_status") or "",
        ),
    )


async def _rollback_dacl(
    action: str,
    resource_id: str | None,
    before: Any,
    after: Any,
    service: DaclService,
) -> tuple[Any, str]:
    if action == "created":
        if not resource_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mangler resource_id til rollback af DACL-oprettelse",
            )
        try:
            await service.delete(resource_id)
        except IseApiError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"ISE afviste delete: {exc}"
            ) from exc
        return None, f"DACL {resource_id} slettet (rollback af oprettelse)"
    if action == "updated":
        if not isinstance(before, dict) or not resource_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mangler before-snapshot til rollback af DACL-update",
            )
        payload = UpdateDaclRequest(
            name=before.get("name"),
            description=before.get("description"),
            dacl=before.get("dacl"),
            dacl_type=before.get("dacl_type"),
        )
        try:
            await service.update(resource_id, payload)
        except IseApiError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"ISE afviste update: {exc}"
            ) from exc
        restored = (await service.get(resource_id)).model_dump()
        return restored, f"DACL {resource_id} rullet tilbage"
    if action == "deleted":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Rollback af DACL-sletning er ikke understøttet — genopret manuelt",
        )
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        f"Rollback understøttes ikke for action={action}",
    )
