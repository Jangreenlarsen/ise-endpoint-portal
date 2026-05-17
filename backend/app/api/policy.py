"""RADIUS Policy API — policy sets, authorization rules, and match simulation."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_policy_service, require_admin, require_any, require_editor
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
    svc: PolicyService = Depends(get_policy_service),
) -> None:
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
