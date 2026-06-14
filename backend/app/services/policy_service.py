# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""RADIUS Policy Service — wraps ISE policy API + condition match simulation."""
from __future__ import annotations

import logging
from typing import Any

from app.core.custom_attr_store import PSK_MODE_ATTR
from app.core.exceptions import IseApiError
from app.ise import policy as policy_api
from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository
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
    "GuestRegistration": "guest_registration",
    "RegistretBy": "registret_by",
    "GuestExperyDate": "guest_expery_date",
    "GuestAccessExpire": "guest_access_expire",
    # Portal-specifikke custom attributes
    "HypervisionActive": "active_status",
    "HypervisionStatus": "status",
    "HypervisionISEPortal": "hypervision",
    "HypervisionRoles": "hypervision_roles",
}

# Dictionaries we CANNOT evaluate without live session data
# Radius is NOT in this list — we evaluate it when values are provided via radius_attrs
_UNEVALUABLE_DICTS = {"Network", "Device", "NetworkAccess"}


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
        return (ep.get("group_name") or "").lower()
    if dictionary == "Radius":
        # Return value if provided by user; None → condition will be skipped
        radius_attrs = ep.get("radius_attrs") or {}
        v = radius_attrs.get(attribute)
        return str(v) if v is not None else None
    return None


def _collect_radius_attrs(cond: dict | None) -> set[str]:
    """Walk a condition tree and return all Radius.* attribute names used."""
    if not cond:
        return set()
    ct = cond.get("conditionType", "")
    if ct == "ConditionAttributes":
        if cond.get("dictionaryName") == "Radius":
            return {cond.get("attributeName", "")}
        return set()
    if ct in ("ConditionAndBlock", "ConditionOrBlock"):
        result: set[str] = set()
        for child in cond.get("children", []):
            result |= _collect_radius_attrs(child)
        return result
    return set()


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

    ISE's 'equals' er hierarkisk: "Endpoint Identity Groups:Profiled" matcher
    alle endpoints i Profiled og alle undergrupper.

    Robust mod korte group-navne (ep_val = "ADM-Apple-iPhone" uden prefix):
    vi tjekker om rule_val ender med ":<ep_val>" som fallback.
    """
    ep_v = (ep_val or "").lower()
    r_v = (rule_val or "").lower()
    if op == "equals":
        if ep_v == r_v:
            return True
        # Hierarkisk: ep er descendant af rule (ep starter med rule + ":")
        if ep_v.startswith(r_v + ":"):
            return True
        # Fallback: ep_val er kortnavnet uden ISE-prefix (f.eks. "ADM-Apple-iPhone")
        # → match hvis rule_val ender med ":<ep_val>"
        if ep_v and ":" not in ep_v and r_v.endswith(":" + ep_v):
            return True
        return False
    if op == "notEquals":
        return not _eval_identity_group(ep_val, "equals", rule_val)
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
        condition: dict | None,
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

    async def _fetch_ep_from_ise(self, endpoint_id: str) -> dict:
        """Fetch live endpoint attributes from ISE ERS and return an ep dict."""
        raw = await IseEndpointRepository(self._client).get(endpoint_id)

        # Extract custom attributes from the nested ERS structure
        ca_wrapper = raw.get("customAttributes", {})
        if isinstance(ca_wrapper, dict):
            ca: dict[str, str] = {
                k: str(v) for k, v in ca_wrapper.get("customAttributes", ca_wrapper).items()
            }
        else:
            ca = {}

        group_id = raw.get("groupId", "")
        group_name = ""
        if group_id:
            try:
                groups = await IseEndpointGroupRepository(self._client).list_all()
                by_id = {g.get("id", ""): g.get("name", "") for g in groups}
                group_name = by_id.get(group_id, "")
            except Exception:
                pass

        psk_raw = ca.get(PSK_MODE_ATTR, "").lower()
        return {
            "owner":              ca.get("Owner", ""),
            "endpoint_type":      ca.get("Type", ""),
            "lokation":           ca.get("Lokation", ""),
            "authz_vlan":         ca.get("AuthzVlan", ""),
            "authz_acl":          ca.get("AuthzACL", ""),
            "platform_type":      ca.get("PlatformType", ""),
            "psk_mode":           "true" if psk_raw == "true" else "false",
            "description":        raw.get("description", ""),
            "group_name":         group_name,
            "guest_registration": ca.get("GuestRegistration", ""),
            "registret_by":       ca.get("RegistretBy", ""),
            "guest_expery_date":  ca.get("GuestExperyDate", ""),
            "guest_access_expire": ca.get("GuestAccessExpire", ""),
            "active_status":      ca.get("HypervisionActive", ""),
            "status":             ca.get("HypervisionStatus", ""),
            "hypervision":        ca.get("HypervisionISEPortal", ""),
            "hypervision_roles":  ca.get("HypervisionRoles", ""),
        }

    async def match_endpoint(self, policy_set_id: str, ep: dict) -> PolicyMatchResult:
        """Simulate which authorization rule first matches the given endpoint dict."""
        # Preserve user-supplied RADIUS values before potentially overwriting ep
        radius_attrs: dict[str, str] = ep.get("radius_attrs") or {}

        # If the caller sends endpoint_id, fetch live attributes from ISE so the
        # simulation is based on what ISE actually sees, not stale form values.
        endpoint_id = ep.get("endpoint_id", "")
        if endpoint_id:
            try:
                ep = await self._fetch_ep_from_ise(endpoint_id)
                logger.debug("simulate match: fetched live ep attrs for %s → %s", endpoint_id, ep)
            except Exception as exc:
                logger.warning("simulate match: could not fetch ep %s from ISE: %s", endpoint_id, exc)

        # Inject RADIUS values (user-provided) so _get_ep_value can evaluate them
        ep = {**ep, "radius_attrs": radius_attrs}

        ps = await policy_api.get_policy_set(self._client, policy_set_id)
        rules = await policy_api.list_authorization_rules(self._client, policy_set_id)

        ps_name = ps.get("name", policy_set_id) if isinstance(ps, dict) else policy_set_id

        if not rules:
            return PolicyMatchResult(
                policy_set_id=policy_set_id,
                policy_set_name=ps_name,
                no_rules=True,
            )

        # Collect all Radius.* attributes used across ALL rules in this policy set.
        # Return the ones not yet provided so the frontend can prompt for them.
        all_radius_attrs: set[str] = set()
        for entry in rules:
            inner = entry.get("rule") or entry
            all_radius_attrs |= _collect_radius_attrs(inner.get("condition"))
        provided_radius = set(radius_attrs.keys())
        radius_needed = sorted(all_radius_attrs - provided_radius)

        def _inject(result: PolicyMatchResult) -> PolicyMatchResult:
            return result.model_copy(update={"radius_attrs_needed": radius_needed})

        # Match strategy:
        #
        # Rules can have three shapes:
        #   a) No condition (catch-all / Default) → always matches; use as last resort only.
        #   b) All conditions evaluable, all pass → definitive match; return immediately (ISE
        #      first-match semantics apply exactly here).
        #   c) Some conditions are ConditionReference / RADIUS (unevaluable) → partial match.
        #
        # For partial matches we cannot respect strict rank ordering because RADIUS conditions
        # are unknown at simulation time.  A rule at rank 2 with 1 evaluable condition (PSK_Mode)
        # + 2 unevaluable RADIUS conditions is far less specific than a rule at rank 4 with
        # 5 evaluable conditions (Owner, Type, Lokation, PlatformType, IdentityGroup) + 1 RADIUS.
        # Picking rank-2 would be wrong when the endpoint clearly matches rank-4's specific attrs.
        #
        # Heuristic: among partial matches, prefer the rule with the MOST evaluable conditions
        # that actually passed.  Ties broken by lowest rank (ISE priority order).
        # A definitive match (shape b) always beats any partial match regardless of rank.

        best_partial: tuple[int, int, PolicyMatchResult] | None = None  # (evaluable_matched, rank, result)
        catch_all: PolicyMatchResult | None = None

        for entry in rules:
            inner = entry.get("rule") or entry
            if inner.get("state", "enabled") == "disabled":
                continue
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

            if not all_conds:
                # No-condition catch-all (Default) — last resort only.
                if catch_all is None:
                    catch_all = result
                continue

            if not has_skipped:
                # Definitive match: all conditions evaluable and pass → stop immediately.
                return _inject(result)

            # Partial match: count unique evaluable (non-skipped) conditions that matched.
            # For OR-blocks, sub_rules each repeat the same conditions — count from
            # global_conds + the single best-matching sub-rule to avoid double-counting.
            if sub_rules:
                best_sr = max(sub_rules, key=lambda sr: sum(1 for c in sr.conditions if not c.skipped and c.matched))
                score_conds = global_conds + best_sr.conditions
            else:
                score_conds = all_conds
            evaluable_matched = sum(1 for c in score_conds if not c.skipped and c.matched)
            rank = inner.get("rank") or 0
            if (
                best_partial is None
                or evaluable_matched > best_partial[0]
                or (evaluable_matched == best_partial[0] and rank < best_partial[1])
            ):
                best_partial = (evaluable_matched, rank, result)

        if best_partial:
            return _inject(best_partial[2])
        if catch_all:
            return _inject(catch_all)
        return _inject(PolicyMatchResult(
            policy_set_id=policy_set_id,
            policy_set_name=ps_name,
        ))
