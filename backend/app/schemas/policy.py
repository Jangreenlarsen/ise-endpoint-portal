"""Pydantic schemas for RADIUS Policy Sets and Authorization Rules."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ── Condition building blocks ────────────────────────────────────────────────

class ConditionAttribute(BaseModel):
    conditionType: str = "ConditionAttributes"
    isNegate: bool = False
    dictionaryName: str
    attributeName: str
    operator: str          # equals, contains, startsWith, endsWith, matches
    attributeValue: str


class ConditionBlock(BaseModel):
    conditionType: str     # ConditionAndBlock | ConditionOrBlock
    isNegate: bool = False
    children: list[Any] = []


class ConditionReference(BaseModel):
    conditionType: str = "ConditionReference"
    isNegate: bool = False
    id: str = ""
    name: str = ""


# ── Authorization rule schemas ───────────────────────────────────────────────

class AuthzRuleSummary(BaseModel):
    id: str
    name: str
    rank: int
    state: str
    profiles: list[str] = []
    condition_summary: str = ""   # human-readable one-liner for UI


class AuthzRuleDetail(AuthzRuleSummary):
    condition: dict | None = None


class CreateAuthzRuleRequest(BaseModel):
    policy_set_id: str
    name: str
    rank: int = 0
    state: str = "enabled"
    condition: dict
    profiles: list[str]


class UpdateAuthzRuleRequest(BaseModel):
    name: str
    rank: int
    state: str = "enabled"
    condition: dict
    profiles: list[str]


# ── Policy set schemas ───────────────────────────────────────────────────────

class PolicySetSummary(BaseModel):
    id: str
    name: str
    rank: int
    state: str
    service_name: str = ""
    condition_summary: str = ""


class PolicySetDetail(PolicySetSummary):
    rules: list[AuthzRuleSummary] = []


# ── Match preview schemas ────────────────────────────────────────────────────

class MatchedCondition(BaseModel):
    attribute: str
    operator: str
    value: str
    matched: bool
    skipped: bool = False   # True for conditions we can't evaluate (RADIUS, references)


class SubRuleGroup(BaseModel):
    index: int
    conditions: list[MatchedCondition] = []


class PolicyMatchResult(BaseModel):
    policy_set_id: str
    policy_set_name: str
    matched_rule_id: str | None = None
    matched_rule_name: str | None = None
    matched_rule_rank: int | None = None
    profiles: list[str] = []
    condition_details: list[MatchedCondition] = []   # global (non-OR-branch) conditions
    sub_rules: list[SubRuleGroup] = []               # populated when rule has OR branches
    no_rules: bool = False
    partial_match: bool = False   # True when match relies on skipped (RADIUS) conditions
    radius_attrs_needed: list[str] = []              # RADIUS attributes used in rules but not yet provided


# ── Match simulation request ─────────────────────────────────────────────────

class EndpointMatchRequest(BaseModel):
    """Typed schema for /match endpoint — prevents arbitrary dict injection."""
    endpoint_id: str | None = None
    group_id: str | None = None
    custom_attributes: dict[str, str] = {}
    radius_attrs: dict[str, str] = {}
    # Allows passing any other endpoint fields the simulator understands
    # (e.g. staticGroupAssignment, profileId) without opening a free dict.
    extra: dict[str, str] = {}


# ── List response ────────────────────────────────────────────────────────────

class PolicySetListResponse(BaseModel):
    policy_sets: list[PolicySetSummary]


class PolicySetDetailResponse(BaseModel):
    policy_set: PolicySetDetail
