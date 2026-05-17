"""RADIUS Policy Service — wraps ISE policy API + condition match simulation."""
from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import IseApiError
from app.ise import policy as policy_api
from app.schemas.policy import (
    AuthzRuleDetail,
    AuthzRuleSummary,
    MatchedCondition,
    PolicyMatchResult,
    PolicySetDetail,
    PolicySetSummary,
    SubRuleGroup,
)

logger = logging.getLogger(__name__)

# ISE Open API operator aliases (ISE uses lowercase)
_OP_LABEL = {
    "equals": "=",
    "notEquals": "≠",
    "contains": "∋",
    "notContains": "∌",
    "startsWith": "^",
    "endsWith": "$",
    "matches": "~",
    "greaterThan": ">",
    "lessThan": "<",
}

# EndPoints dictionary attributes that we can evaluate against the endpoint object
_ENDPOINT_ATTR_MAP = {
    "Owner": "owner",
    "Type": "endpoint_type",
    "Lokation": "lokation",
    "AuthzVlan": "authz_vlan",
    "AuthzACL": "authz_acl",
    "PlatformType": "platform_type",
    "PSK_Mode": "psk_mode",
    "Description": "description",
}

# Dictionaries we CANNOT evaluate (runtime RADIUS attributes, etc.)
_UNEVALUABLE_DICTS = {"Radius", "Network", "Device", "NetworkAccess"}


def _condition_summary(cond: dict | None) -> str:
    """Return a short human-readable summary of a condition dict."""
    if not cond:
        return "—"
    ct = cond.get("conditionType", "")
    if ct == "ConditionReference":
        return f"[{cond.get('name', 'ref')}]"
    if ct == "ConditionAttributes":
        dn = cond.get("dictionaryName", "")
        an = cond.get("attributeName", "")
        op = _OP_LABEL.get(cond.get("operator", ""), cond.get("operator", ""))
        av = cond.get("attributeValue", "")
        return f"{dn}.{an} {op} {av!r}"
    if ct in ("ConditionAndBlock", "ConditionOrBlock"):
        sep = " AND " if ct == "ConditionAndBlock" else " OR "
        children = cond.get("children", [])
        parts = [_condition_summary(c) for c in children[:3]]
        suffix = f" …+{len(children)-3}" if len(children) > 3 else ""
        return f"({sep.join(parts)}{suffix})"
    return ct or "—"


def _rule_summary(entry: dict) -> AuthzRuleSummary:
    # ISE returns {"rule": {id, name, rank, state, condition}, "profile": [...]}
    inner = entry.get("rule") or entry
    profiles = entry.get("profile") or inner.get("profile") or []
    if isinstance(profiles, str):
        profiles = [profiles]
    return AuthzRuleSummary(
        id=inner.get("id", ""),
        name=inner.get("name", ""),
        rank=inner.get("rank", 0),
        state=inner.get("state", "enabled"),
        profiles=profiles,
        condition_summary=_condition_summary(inner.get("condition")),
    )


def _rule_detail(entry: dict) -> AuthzRuleDetail:
    inner = entry.get("rule") or entry
    s = _rule_summary(entry)
    return AuthzRuleDetail(**s.model_dump(), condition=inner.get("condition"))


def _ps_summary(ps: dict) -> PolicySetSummary:
    return PolicySetSummary(
        id=ps.get("id", ""),
        name=ps.get("name", ""),
        rank=ps.get("rank", 0),
        state=ps.get("state", "enabled"),
        service_name=ps.get("serviceName", ""),
        condition_summary=_condition_summary(ps.get("condition")),
    )


# ── Condition evaluator ──────────────────────────────────────────────────────

def _get_ep_value(ep: dict, dictionary: str, attribute: str) -> str | None:
    """Extract the endpoint attribute value for a given ISE dictionary+attribute."""
    if dictionary == "EndPoints":
        field = _ENDPOINT_ATTR_MAP.get(attribute)
        if field:
            v = ep.get(field)
            return str(v).lower() if v is not None else ""
        # fallback: check customAttributes flat map
        ca = ep.get("custom_attributes") or {}
        if attribute in ca:
            return str(ca[attribute]).lower()
        return None
    if dictionary == "IdentityGroup" and attribute == "Name":
        # ep.group_name comes from the identity group lookup
        return (ep.get("group_name") or "").lower()
    return None


def _eval_operator(op: str, ep_val: str, rule_val: str) -> bool:
    ep_v = (ep_val or "").lower()
    r_v = (rule_val or "").lower()
    if op == "equals":
        return ep_v == r_v
    if op == "notEquals":
        return ep_v != r_v
    if op == "contains":
        return r_v in ep_v
    if op == "notContains":
        return r_v not in ep_v
    if op == "startsWith":
        return ep_v.startswith(r_v)
    if op == "endsWith":
        return ep_v.endswith(r_v)
    if op == "matches":
        import re
        try:
            return bool(re.search(r_v, ep_v))
        except re.error:
            return False
    return False


def _eval_identity_group(ep_val: str, op: str, rule_val: str) -> bool:
    """ISE-korrekt evaluering af IdentityGroup.Name.

    ISE's 'equals' på identity groups er hierarkisk: en regel mod
    'Endpoint Identity Groups:Profiled' matcher ALLE endpoints i Profiled
    og alle undergrupper (fx :Profiled:ADM-Apple-iPhone).
    Vi implementerer dette via prefix-tjek med ':' som separator.
    """
    ep_v = (ep_val or "").lower()
    r_v = (rule_val or "").lower()
    if op == "equals":
        return ep_v == r_v or ep_v.startswith(r_v + ":")
    if op == "notEquals":
        return ep_v != r_v and not ep_v.startswith(r_v + ":")
    # Øvrige operatorer: fald igennem til standard string-sammenligning
    return _eval_operator(op, ep_val, rule_val)


def _eval_condition(cond: dict | None, ep: dict) -> tuple[bool, list[MatchedCondition]]:
    """Recursively evaluate a condition against an endpoint.

    Returns (result: bool, detail_list: list[MatchedCondition]).
    Unevaluable conditions (RADIUS dicts, references) are treated as True
    (benefit of doubt) and flagged with skipped=True.
    """
    if not cond:
        return True, []

    ct = cond.get("conditionType", "")

    if ct == "ConditionReference":
        mc = MatchedCondition(
            attribute=f"[{cond.get('name', 'ref')}]",
            operator="ref",
            value="",
            matched=True,
            skipped=True,
        )
        return True, [mc]

    if ct == "ConditionAttributes":
        dn = cond.get("dictionaryName", "")
        an = cond.get("attributeName", "")
        op = cond.get("operator", "equals")
        av = cond.get("attributeValue", "")

        if dn in _UNEVALUABLE_DICTS:
            mc = MatchedCondition(
                attribute=f"{dn}.{an}",
                operator=op,
                value=av,
                matched=True,
                skipped=True,
            )
            return True, [mc]

        ep_val = _get_ep_value(ep, dn, an)
        if ep_val is None:
            # Unknown attribute — treat as skipped
            mc = MatchedCondition(
                attribute=f"{dn}.{an}",
                operator=op,
                value=av,
                matched=True,
                skipped=True,
            )
            return True, [mc]

        if dn == "IdentityGroup" and an == "Name":
            result = _eval_identity_group(ep_val, op, av)
        else:
            result = _eval_operator(op, ep_val, av)
        mc = MatchedCondition(
            attribute=f"{dn}.{an}",
            operator=_OP_LABEL.get(op, op),
            value=av,
            matched=result,
        )
        return result, [mc]

    if ct in ("ConditionAndBlock", "ConditionOrBlock"):
        is_and = ct == "ConditionAndBlock"
        children = cond.get("children", [])
        all_details: list[MatchedCondition] = []
        results: list[bool] = []
        for child in children:
            r, d = _eval_condition(child, ep)
            results.append(r)
            all_details.extend(d)
        block_result = all(results) if is_and else any(results)
        return block_result, all_details

    # Unknown condition type — skip
    return True, []


def _split_into_subrules(
    cond: dict | None, ep: dict
) -> tuple[list[MatchedCondition], list[SubRuleGroup]]:
    """Split a condition tree into global conditions + per-OR-branch sub-rules.

    Detects the first ConditionOrBlock at depth 0 or as a direct child of the
    top-level AND block.  Non-OR children of the AND are returned as global
    conditions; OR children become numbered SubRuleGroups.

    Returns (global_conditions, sub_rules).  sub_rules is empty when the
    condition has no OR branching — the caller should fall back to a flat view.
    """
    if not cond:
        return [], []

    ct = cond.get("conditionType", "")

    # Top-level is OR → each child is a sub-rule, no global conditions
    if ct == "ConditionOrBlock":
        sub_rules = []
        for i, child in enumerate(cond.get("children", []), start=1):
            _, child_details = _eval_condition(child, ep)
            sub_rules.append(SubRuleGroup(index=i, conditions=child_details))
        return [], sub_rules

    # Top-level is AND → look for a direct OR child
    if ct == "ConditionAndBlock":
        children = cond.get("children", [])
        or_child = next(
            (c for c in children if c.get("conditionType") == "ConditionOrBlock"), None
        )
        if or_child:
            global_conds: list[MatchedCondition] = []
            for c in children:
                if c is not or_child:
                    _, d = _eval_condition(c, ep)
                    global_conds.extend(d)
            sub_rules = []
            for i, child in enumerate(or_child.get("children", []), start=1):
                _, child_details = _eval_condition(child, ep)
                sub_rules.append(SubRuleGroup(index=i, conditions=child_details))
            return global_conds, sub_rules

    # No OR branching found — single flat evaluation
    _, all_details = _eval_condition(cond, ep)
    return all_details, []


# ── Service class ────────────────────────────────────────────────────────────

class PolicyService:
    def __init__(self, client) -> None:
        self._client = client

    async def list_policy_sets(self) -> list[PolicySetSummary]:
        sets = await policy_api.list_policy_sets(self._client)
        return sorted(
            [_ps_summary(ps) for ps in sets], key=lambda s: s.rank
        )

    async def get_policy_set_detail(self, policy_set_id: str) -> PolicySetDetail:
        ps = await policy_api.get_policy_set(self._client, policy_set_id)
        rules = await policy_api.list_authorization_rules(self._client, policy_set_id)
        summary = _ps_summary(ps)
        return PolicySetDetail(
            **summary.model_dump(),
            rules=[_rule_summary(r) for r in rules],
        )

    async def list_authorization_rules(self, policy_set_id: str) -> list[AuthzRuleDetail]:
        rules = await policy_api.list_authorization_rules(self._client, policy_set_id)
        return [_rule_detail(r) for r in rules]

    async def create_rule(
        self,
        policy_set_id: str,
        name: str,
        rank: int,
        condition: dict,
        profiles: list[str],
        state: str = "enabled",
    ) -> AuthzRuleDetail:
        rule = await policy_api.create_authorization_rule(
            self._client, policy_set_id, name, rank, condition, profiles, state
        )
        logger.info("Created authz rule '%s' in policy set %s", name, policy_set_id)
        return _rule_detail(rule)

    async def update_rule(
        self,
        policy_set_id: str,
        rule_id: str,
        name: str,
        rank: int,
        condition: dict,
        profiles: list[str],
        state: str = "enabled",
    ) -> AuthzRuleDetail:
        rule = await policy_api.update_authorization_rule(
            self._client, policy_set_id, rule_id, name, rank, condition, profiles, state
        )
        logger.info("Updated authz rule %s in policy set %s", rule_id, policy_set_id)
        return _rule_detail(rule)

    async def delete_rule(self, policy_set_id: str, rule_id: str) -> None:
        await policy_api.delete_authorization_rule(self._client, policy_set_id, rule_id)

    async def match_endpoint(self, policy_set_id: str, ep: dict) -> PolicyMatchResult:
        """Simulate which authorization rule first matches the given endpoint dict."""
        ps = await policy_api.get_policy_set(self._client, policy_set_id)
        rules = await policy_api.list_authorization_rules(self._client, policy_set_id)

        ps_name = ps.get("name", policy_set_id) if isinstance(ps, dict) else policy_set_id

        if not rules:
            return PolicyMatchResult(
                policy_set_id=policy_set_id,
                policy_set_name=ps_name,
                no_rules=True,
            )

        # Two-pass strategy:
        # - Definitive match: all conditions evaluable, all pass → return immediately (first wins).
        # - Partial match: evaluable conditions pass but some conditions are ConditionReferences
        #   (runtime RADIUS/session attributes we cannot evaluate) → remember first, keep searching.
        # This avoids stopping at a ConditionReference rule (e.g. Wireless_MAB) that ISE would
        # actually fail at runtime, which would hide the true matching rule further down the list.
        first_partial: PolicyMatchResult | None = None

        for entry in rules:
            inner = entry.get("rule") or entry
            cond = inner.get("condition")
            matched, details = _eval_condition(cond, ep)
            if not matched:
                continue

            profiles = entry.get("profile") or inner.get("profile") or []
            if isinstance(profiles, str):
                profiles = [profiles]
            global_conds, sub_rules = _split_into_subrules(cond, ep)
            all_conds = global_conds + [d for sr in sub_rules for d in sr.conditions]
            has_skipped = any(d.skipped for d in all_conds)

            result = PolicyMatchResult(
                policy_set_id=policy_set_id,
                policy_set_name=ps_name,
                matched_rule_id=inner.get("id"),
                matched_rule_name=inner.get("name"),
                matched_rule_rank=inner.get("rank"),
                profiles=profiles,
                condition_details=global_conds,
                sub_rules=sub_rules,
                partial_match=has_skipped,
            )

            if not has_skipped:
                return result  # Definitive match — stop here.

            if first_partial is None:
                first_partial = result  # Remember earliest partial, keep searching.

        return first_partial or PolicyMatchResult(
            policy_set_id=policy_set_id,
            policy_set_name=ps_name,
        )
