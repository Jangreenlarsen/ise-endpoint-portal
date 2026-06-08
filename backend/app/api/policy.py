# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""RADIUS Policy API — policy sets, authorization rules, and match simulation."""
from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import get_endpoint_service, get_policy_service, require_admin, require_any, require_editor
from app.core.exceptions import IseApiError
from app.schemas.policy import (
    AuthzRuleDetail,
    CreateAuthzRuleRequest,
    EndpointMatchRequest,
    PolicyMatchResult,
    PolicySetDetailResponse,
    PolicySetListResponse,
    UpdateAuthzRuleRequest,
)
from app.services.endpoint_service import EndpointService
from app.services.policy_service import PolicyService

router = APIRouter(prefix="/policy", tags=["policy"])


_RULE_NAME_RE = re.compile(r'^[\w\-\.\(\) ]+$')


def _502(exc: IseApiError) -> HTTPException:
    return HTTPException(status_code=502, detail=str(exc))


def _validate_rule_name(name: str) -> None:
    if not name or not _RULE_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Regelnavn må kun indeholde bogstaver, tal, mellemrum, bindestreg, punktum og parenteser — ingen kolon eller specialtegn.",
        )


# ── Policy sets ──────────────────────────────────────────────────────────────

@router.get(
    "/policy-sets",
    response_model=PolicySetListResponse,
    dependencies=[Depends(require_any)],
)
async def list_policy_sets(
    svc: PolicyService = Depends(get_policy_service),
) -> PolicySetListResponse:
    try:
        sets = await svc.list_policy_sets()
        return PolicySetListResponse(policy_sets=sets)
    except IseApiError as exc:
        raise _502(exc) from exc


@router.get(
    "/policy-sets/{policy_set_id}",
    response_model=PolicySetDetailResponse,
    dependencies=[Depends(require_any)],
)
async def get_policy_set(
    policy_set_id: str,
    svc: PolicyService = Depends(get_policy_service),
) -> PolicySetDetailResponse:
    try:
        detail = await svc.get_policy_set_detail(policy_set_id)
        return PolicySetDetailResponse(policy_set=detail)
    except IseApiError as exc:
        raise _502(exc) from exc


# ── Authorization rules ──────────────────────────────────────────────────────

@router.get(
    "/policy-sets/{policy_set_id}/rules",
    response_model=list[AuthzRuleDetail],
    dependencies=[Depends(require_any)],
)
async def list_rules(
    policy_set_id: str,
    svc: PolicyService = Depends(get_policy_service),
) -> list[AuthzRuleDetail]:
    try:
        return await svc.list_authorization_rules(policy_set_id)
    except IseApiError as exc:
        raise _502(exc) from exc


@router.post(
    "/policy-sets/{policy_set_id}/rules",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthzRuleDetail,
    dependencies=[Depends(require_editor)],
)
async def create_rule(
    policy_set_id: str,
    req: CreateAuthzRuleRequest,
    svc: PolicyService = Depends(get_policy_service),
) -> AuthzRuleDetail:
    _validate_rule_name(req.name)
    try:
        return await svc.create_rule(
            policy_set_id,
            req.name,
            req.rank,
            req.condition,
            req.profiles,
            req.state,
        )
    except IseApiError as exc:
        raise _502(exc) from exc


@router.put(
    "/policy-sets/{policy_set_id}/rules/{rule_id}",
    response_model=AuthzRuleDetail,
    dependencies=[Depends(require_editor)],
)
async def update_rule(
    policy_set_id: str,
    rule_id: str,
    req: UpdateAuthzRuleRequest,
    svc: PolicyService = Depends(get_policy_service),
) -> AuthzRuleDetail:
    _validate_rule_name(req.name)
    if req.name.strip().lower() == "default":
        raise HTTPException(
            status_code=422,
            detail="Default-reglen er read-only i ISE og kan ikke ændres.",
        )
    try:
        return await svc.update_rule(
            policy_set_id, rule_id, req.name, req.rank, req.condition, req.profiles, req.state
        )
    except IseApiError as exc:
        raise _502(exc) from exc


@router.delete(
    "/policy-sets/{policy_set_id}/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_rule(
    policy_set_id: str,
    rule_id: str,
    rule_name: str | None = Query(default=None),
    svc: PolicyService = Depends(get_policy_service),
) -> None:
    if rule_name and rule_name.strip().lower() == "default":
        raise HTTPException(
            status_code=422,
            detail="Default-reglen er read-only i ISE og kan ikke slettes.",
        )
    try:
        await svc.delete_rule(policy_set_id, rule_id)
    except IseApiError as exc:
        raise _502(exc) from exc


# ── Match simulation ─────────────────────────────────────────────────────────

@router.post(
    "/policy-sets/{policy_set_id}/match",
    response_model=PolicyMatchResult,
    dependencies=[Depends(require_any)],
)
async def match_endpoint(
    policy_set_id: str,
    ep: EndpointMatchRequest,
    svc: PolicyService = Depends(get_policy_service),
) -> PolicyMatchResult:
    """Simulate which authorization rule first matches the given endpoint attributes."""
    try:
        return await svc.match_endpoint(policy_set_id, ep.model_dump(exclude_none=True))
    except IseApiError as exc:
        raise _502(exc) from exc


# ── Batch policy-simulering ──────────────────────────────────────────────────


class BatchSimRequest(BaseModel):
    policy_set_id: str
    endpoint_ids: list[str]
    radius_attrs: dict[str, str] = {}


@router.post(
    "/batch-simulate",
    dependencies=[Depends(require_any)],
)
async def batch_simulate(
    body: BatchSimRequest,
    svc: PolicyService = Depends(get_policy_service),
    ep_service: EndpointService = Depends(get_endpoint_service),
) -> dict:
    """Kør policy-match-simulering på op til 100 endpoints mod ét policy set."""
    sem = asyncio.Semaphore(5)

    async def sim_one(ep_id: str) -> dict:
        async with sem:
            try:
                detail = await ep_service.get_endpoint(ep_id)
                ep_dict = {
                    "mac": detail.mac,
                    "endpoint_type": detail.endpoint_type or "",
                    "owner": detail.owner or "",
                    "lokation": detail.lokation or "",
                    "platform_type": detail.platform_type or "",
                    "group_id": detail.group_id or "",
                    "group_name": detail.group_name or "",
                    "radius_attrs": body.radius_attrs,
                }
                result = await svc.match_endpoint(body.policy_set_id, ep_dict)
                return {
                    "id": ep_id,
                    "mac": detail.mac,
                    "matched_rule": result.matched_rule_name,
                    "matched_profile": ", ".join(result.profiles) if result.profiles else None,
                    "partial_match": result.partial_match,
                    "matched": result.matched_rule_name is not None,
                }
            except Exception as exc:  # noqa: BLE001
                return {"id": ep_id, "mac": None, "error": str(exc)}

    results = list(await asyncio.gather(*(sim_one(i) for i in body.endpoint_ids[:100])))
    return {
        "policy_set_id": body.policy_set_id,
        "results": results,
        "matched_count": sum(1 for r in results if r.get("matched")),
        "unmatched_count": sum(1 for r in results if not r.get("matched") and not r.get("error")),
        "error_count": sum(1 for r in results if r.get("error")),
    }
