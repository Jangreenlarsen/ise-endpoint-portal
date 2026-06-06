// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Policy dashboard — 3-panel layout: sidebar (sets) | rule list | detail/editor.

import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
import { esc } from "./browse-utils.js";
import {
  groupEditorHtml, wireGroupEditor, readGroupCondition,
  renderConditionTree, renderConditionChips,
  profilesHtml, readProfiles, wireProfileEvents,
} from "./policy-condition-builder.js";

function stateLabel(s) {
  return s === "enabled" ? t("pol.state_enabled") : t("pol.state_disabled");
}

// ── Authz profile detail helpers ──────────────────────────────────────────────

function renderProfileDetailCard(d) {
  const accessCls = d.access_type === "ACCESS_ACCEPT" ? "pd-accept"
                  : d.access_type === "ACCESS_REJECT" ? "pd-reject" : "pd-neutral";
  const accessLabel = d.access_type === "ACCESS_ACCEPT" ? "ACCEPT"
                    : d.access_type === "ACCESS_REJECT" ? "REJECT"
                    : d.access_type || "—";

  const rows = [];
  if (d.dacl_name) rows.push(`<span class="pd-attr">DACL: <em>${esc(d.dacl_name)}</em></span>`);
  if (d.vlan)      rows.push(`<span class="pd-attr">VLAN: <em>${esc(d.vlan)}</em></span>`);
  if (d.radius_profile) rows.push(`<span class="pd-attr">RADIUS-profile: <em>${esc(d.radius_profile)}</em></span>`);
  for (const a of (d.advanced_attrs || [])) {
    rows.push(`<span class="pd-attr">${esc(a)}</span>`);
  }
  if (d.description && !d.dacl_name && !d.vlan && !d.advanced_attrs?.length) {
    rows.push(`<span class="pd-attr hint">${esc(d.description)}</span>`);
  }

  return `
    <div class="pol-pd-card">
      <div class="pol-pd-card-hd">
        <span class="pol-authz-icon">→</span>
        <span class="pol-pd-name">${esc(d.name)}</span>
        <span class="pol-pd-badge ${accessCls}">${accessLabel}</span>
        ${d.profile_type ? `<span class="pol-pd-type">${esc(d.profile_type)}</span>` : ""}
      </div>
      ${rows.length ? `<div class="pol-pd-attrs">${rows.join("")}</div>` : ""}
    </div>`;
}

async function loadAndRenderProfileDetails(container, profiles) {
  if (!profiles?.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="pol-pd-loading">${t("pol.pd_loading")}</div>`;
  const results = await Promise.allSettled(profiles.map((p) => api.getAuthzProfile(p)));
  if (!document.contains(container)) return;
  const cards = results.map((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      return renderProfileDetailCard(r.value);
    }
    return `<div class="pol-pd-card pol-pd-error"><span class="pol-authz-icon">→</span><span class="pol-pd-name">${esc(profiles[i])}</span><span class="pd-attr hint">${t("pol.pd_unavailable")}</span></div>`;
  });
  container.innerHTML = cards.join("");
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderPolicy(container) {
  const isEditor = auth.isEditor();

  container.innerHTML = `
    <div class="pol-page">

      <!-- ── Sidebar: Policy Sets ── -->
      <div class="pol-sidebar">
        <div class="pol-sidebar-hd">
          <span class="pol-sidebar-title">${t("pol.title")}</span>
          <button id="pol-refresh" class="secondary small" title="${t("pol.refresh")}">↺</button>
        </div>
        <div id="pol-sets-list" class="pol-sets-list">
          <div class="pol-sets-loading">${t("pol.sets_loading")}</div>
        </div>
      </div>

      <!-- ── Center: Authorization rule list ── -->
      <div class="pol-rules-panel">
        <div class="pol-rules-header">
          <h3 id="pol-rules-title" class="pol-rules-title">${t("pol.select_set")}</h3>
          ${isEditor ? `<button id="pol-new-rule-btn" class="hidden small">${t("pol.new_rule")}</button>` : ""}
        </div>
        <div id="pol-rules-msg"></div>
        <div id="pol-rules-list" class="pol-rules-list"></div>
      </div>

      <!-- ── Right: Detail / editor ── -->
      <div class="pol-detail-panel" id="pol-detail-panel">
        <div class="pol-detail-placeholder">${t("pol.select_set")}</div>
      </div>

    </div>
  `;

  let selectedSetId   = null;
  let selectedSetName = "";
  let selectedRuleId  = null;
  let caValues        = {};

  const setsList    = container.querySelector("#pol-sets-list");
  const rulesTitle  = container.querySelector("#pol-rules-title");
  const rulesMsg    = container.querySelector("#pol-rules-msg");
  const rulesList   = container.querySelector("#pol-rules-list");
  const detailPanel = container.querySelector("#pol-detail-panel");
  const newRuleBtn  = container.querySelector("#pol-new-rule-btn");

  api.listCustomAttributes().then((res) => {
    if (res?.attributes) {
      for (const a of res.attributes) caValues[a.name] = a.values || [];
    }
  }).catch((err) => {
    console.warn("[policy] Custom attributes unavailable:", err.message);
  }).finally(() => {
    // Portal-managed attributes have fixed value sets — always override
    caValues["HypervisionActive"]  = ["Aktiv", "Inaktiv"];
    caValues["HypervisionStatus"]  = ["Decommissioned"];
    caValues["PSK_Mode"]           = ["true", "false"];
    caValues["GuestRegistration"]  = ["true", "false"];
  });

  api.listGroups().then((res) => {
    const groups = Array.isArray(res) ? res : (res?.groups || []);
    caValues["__IdentityGroup_Name__"] = groups
      .map((g) => g.name).filter(Boolean)
      .map((n) => n.startsWith("Endpoint Identity Groups:") ? n : "Endpoint Identity Groups:" + n);
  }).catch((err) => {
    console.warn("[policy] Identity groups unavailable:", err.message);
  });

  function clearDetail() {
    selectedRuleId = null;
    detailPanel.innerHTML = `<div class="pol-detail-placeholder">${t("pol.select_set")}</div>`;
    rulesList.querySelectorAll(".pol-rule-card").forEach((c) => c.classList.remove("active"));
  }

  // ── Policy sets sidebar ───────────────────────────────────────────────────
  async function loadSets() {
    setsList.innerHTML = `<div class="pol-sets-loading">${t("pol.sets_loading")}</div>`;
    try {
      const res  = await api.listPolicySets();
      const sets = res?.policy_sets || [];
      if (!sets.length) {
        setsList.innerHTML = `<div class="pol-sets-empty">${t("pol.sets_empty")}</div>`;
        return;
      }
      setsList.innerHTML = sets.map((s) => `
        <div class="pol-set-item${s.id === selectedSetId ? " active" : ""}" data-id="${esc(s.id)}" data-name="${esc(s.name)}">
          <div class="pol-set-dot ${s.state}"></div>
          <div class="pol-set-item-info">
            <div class="pol-set-item-name">${esc(s.name)}</div>
            ${s.service_name ? `<div class="pol-set-item-meta">${esc(s.service_name)}</div>` : ""}
          </div>
          <span class="pol-set-state-pill ${s.state}">${stateLabel(s.state)}</span>
        </div>
      `).join("");
      setsList.querySelectorAll(".pol-set-item").forEach((el) =>
        el.addEventListener("click", () => selectSet(el.dataset.id, el.dataset.name))
      );
    } catch (err) {
      setsList.innerHTML = `<div class="alert error">${t("pol.sets_error").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  async function selectSet(id, name) {
    selectedSetId   = id;
    selectedSetName = name;
    setsList.querySelectorAll(".pol-set-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === id)
    );
    rulesTitle.textContent = `Authz : ${name}`;
    newRuleBtn?.classList.remove("hidden");
    clearDetail();
    await loadRules(id);
  }

  // ── Authorization rules ───────────────────────────────────────────────────
  async function loadRules(setId) {
    rulesList.innerHTML = `<div class="alert info">${t("pol.rules_loading")}</div>`;
    rulesMsg.innerHTML  = "";
    try {
      const rules = await api.listPolicyRules(setId);
      if (!rules.length) {
        rulesList.innerHTML = `<div class="hint pol-empty-hint">${t("pol.rules_empty")}</div>`;
        clearDetail();
        return;
      }
      rulesList.innerHTML = rules.map((r) => renderRuleCard(r, isEditor)).join("");
      wireRuleCards(rulesList, rules, setId);
      if (selectedRuleId) {
        const still = rules.find((r) => r.id === selectedRuleId);
        if (still) showRuleDetail(still, setId);
        else clearDetail();
      }
    } catch (err) {
      rulesList.innerHTML = `<div class="alert error">${t("pol.rules_error").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  // ── Rule card HTML ────────────────────────────────────────────────────────
  function renderRuleCard(r) {
    const chips    = renderConditionChips(r.condition);
    const profiles = (r.profiles || []).map((p) =>
      `<span class="profile-chip">${esc(p)}</span>`
    ).join("") || "";
    const expanded = r.id === selectedRuleId ? " expanded" : "";

    return `
      <div class="pol-rule-card${r.id === selectedRuleId ? " active" : ""}${expanded}" data-id="${esc(r.id)}">
        <div class="pol-rule-rank">
          <span class="pol-rank-badge">${r.rank}</span>
        </div>
        <div class="pol-rule-body">
          <div class="pol-rule-top">
            <span class="pol-rule-name">${esc(r.name)}</span>
            <span class="pol-state-badge ${r.state}">${stateLabel(r.state)}</span>
            <span class="pol-rule-chevron">▸</span>
          </div>
          <div class="pol-rule-expand">
            <div class="pol-rule-chips">${chips}</div>
            ${profiles ? `<div class="pol-rule-profiles"><span class="pol-profiles-arrow">→</span>${profiles}</div>` : ""}
          </div>
        </div>
      </div>`;
  }

  function wireRuleCards(list, rules, setId) {
    let dragSrcId = null;

    list.querySelectorAll(".pol-rule-card").forEach((card) => {
      const id   = card.dataset.id;
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;

      card.addEventListener("click", () => {
        const isExpanded = card.classList.contains("expanded");
        list.querySelectorAll(".pol-rule-card.expanded").forEach((c) => {
          if (c !== card) c.classList.remove("expanded");
        });
        if (isExpanded) {
          card.classList.remove("expanded");
          if (selectedRuleId === id) clearDetail();
        } else {
          card.classList.add("expanded");
          showRuleDetail(rule, setId);
        }
      });

      if (!isEditor) return;

      card.draggable = true;

      card.addEventListener("dragstart", (e) => {
        dragSrcId = id;
        card.classList.add("pol-rule-dragging");
        e.dataTransfer.effectAllowed = "move";
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("pol-rule-dragging");
        list.querySelectorAll(".pol-rule-drag-over").forEach((c) => c.classList.remove("pol-rule-drag-over"));
      });

      card.addEventListener("dragover", (e) => {
        if (dragSrcId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        list.querySelectorAll(".pol-rule-drag-over").forEach((c) => c.classList.remove("pol-rule-drag-over"));
        card.classList.add("pol-rule-drag-over");
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("pol-rule-drag-over");
      });

      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        card.classList.remove("pol-rule-drag-over");
        if (!dragSrcId || dragSrcId === id) return;
        const srcRule = rules.find((r) => r.id === dragSrcId);
        const dstRule = rule;
        if (!srcRule) return;
        try {
          await api.updatePolicyRule(setId, srcRule.id, {
            name: srcRule.name,
            rank: dstRule.rank,
            state: srcRule.state,
            condition: srcRule.condition,
            profiles: srcRule.profiles,
          });
          await loadRules(setId);
        } catch (err) {
          console.error("Regel-flytning fejlede:", err.message);
        }
      });
    });
  }

  // ── Rule detail (right panel) ─────────────────────────────────────────────
  function showRuleDetail(rule, setId) {
    selectedRuleId = rule.id;
    rulesList.querySelectorAll(".pol-rule-card").forEach((c) =>
      c.classList.toggle("active", c.dataset.id === rule.id)
    );

    const profileChips = (rule.profiles || []).map((p) =>
      `<div class="pol-authz-chip"><span class="pol-authz-icon">→</span>${esc(p)}</div>`
    ).join("") || `<span class="pol-detail-empty">—</span>`;

    detailPanel.innerHTML = `
      <div class="pol-detail-card">
        <div class="pol-detail-card-header">
          <span class="pol-rank-badge">${rule.rank}</span>
          <h4>${esc(rule.name)}</h4>
          <span class="pol-state-badge ${rule.state}">${stateLabel(rule.state)}</span>
        </div>

        <div class="pol-detail-split">
          <div class="pol-detail-cond-col">
            <div class="pol-detail-col-label">${t("pol.condition_label")}</div>
            <div class="cond-tree">${renderConditionTree(rule.condition)}</div>
          </div>
          <div class="pol-detail-profiles-col">
            <div class="pol-detail-col-label">${t("pol.profiles_label")}</div>
            <div class="pol-authz-list">${profileChips}</div>
          </div>
        </div>

        <div class="pol-pd-section">
          <div class="pol-detail-col-label">${t("pol.pd_section_label")}</div>
          <div id="pol-pd-details"></div>
        </div>

        ${isEditor ? `
        <div class="detail-actions">
          <button id="pol-detail-edit" class="secondary">${t("pol.btn_edit")}</button>
          <button id="pol-detail-del"  class="danger">${t("pol.btn_delete")}</button>
        </div>` : ""}
      </div>`;

    loadAndRenderProfileDetails(
      detailPanel.querySelector("#pol-pd-details"),
      rule.profiles || []
    );

    if (isEditor) {
      detailPanel.querySelector("#pol-detail-edit")?.addEventListener("click", () =>
        showRuleEditor(rule, setId)
      );
      detailPanel.querySelector("#pol-detail-del")?.addEventListener("click", async () => {
        if (!confirm(t("pol.del_confirm").replace("{name}", rule.name))) return;
        try {
          await api.deletePolicyRule(setId, rule.id);
          rulesMsg.innerHTML = `<div class="alert success">${t("pol.del_ok")}</div>`;
          selectedRuleId = null;
          clearDetail();
          await loadRules(setId);
        } catch (err) {
          rulesMsg.innerHTML = `<div class="alert error">${t("pol.del_err").replace("{msg}", esc(err.message))}</div>`;
        }
      });
    }
  }

  // ── Rule editor (right panel) ─────────────────────────────────────────────
  function showRuleEditor(existing = null, setId) {
    const isNew = !existing;

    if (existing) {
      selectedRuleId = existing.id;
      rulesList.querySelectorAll(".pol-rule-card").forEach((c) =>
        c.classList.toggle("active", c.dataset.id === existing.id)
      );
    }

    rulesMsg.innerHTML = "";
    detailPanel.innerHTML = `
      <div class="pol-editor-card">
        <h4>${isNew ? t("pol.ed_new_title") : t("pol.ed_edit_title").replace("{name}", esc(existing?.name || ""))}</h4>
        <div id="pol-editor-msg"></div>

        <label>${t("pol.ed_name_label")}
          <input type="text" id="pol-rule-name" value="${esc(existing?.name || "")}" placeholder="${t("pol.ed_name_ph")}" />
        </label>
        <label>${t("pol.ed_rank_label")} <small>${t("pol.ed_rank_hint")}</small>
          <input type="number" id="pol-rule-rank" value="${existing?.rank ?? 0}" min="0" />
        </label>
        <label>${t("pol.ed_state_label")}
          <select id="pol-rule-state">
            <option value="enabled"${(!existing || existing.state === "enabled") ? " selected" : ""}>${t("pol.ed_state_enabled")}</option>
            <option value="disabled"${existing?.state === "disabled" ? " selected" : ""}>${t("pol.ed_state_disabled")}</option>
          </select>
        </label>

        <div class="editor-section-label">${t("pol.ed_conds_label")}</div>
        <div id="pol-cond-editor">${groupEditorHtml(existing?.condition ?? null, caValues)}</div>

        <div class="editor-section-label">${t("pol.ed_profiles_label")}</div>
        <div id="pol-profiles-wrap">${profilesHtml(existing?.profiles || [])}</div>

        <div class="pol-pd-section">
          <div class="pol-detail-col-label">${t("pol.pd_section_label")}</div>
          <div id="pol-pd-details-ed"></div>
        </div>

        <div class="detail-actions">
          <button type="button" id="pol-save-rule-btn">${isNew ? t("pol.ed_save_new") : t("pol.ed_save_edit")}</button>
          <button type="button" id="pol-cancel-rule-btn" class="secondary">${t("pol.ed_cancel")}</button>
        </div>
      </div>`;

    const condEditorEl  = detailPanel.querySelector("#pol-cond-editor");
    const profilesWrap  = detailPanel.querySelector("#pol-profiles-wrap");
    const pdDetailsEd   = detailPanel.querySelector("#pol-pd-details-ed");
    wireGroupEditor(condEditorEl, caValues);
    wireProfileEvents(profilesWrap, () => {
      loadAndRenderProfileDetails(pdDetailsEd, readProfiles(profilesWrap));
    });
    loadAndRenderProfileDetails(pdDetailsEd, existing?.profiles || []);

    detailPanel.querySelector("#pol-save-rule-btn").addEventListener("click", async () => {
      const editorMsg = detailPanel.querySelector("#pol-editor-msg");
      const name  = detailPanel.querySelector("#pol-rule-name")?.value.trim();
      const rank  = parseInt(detailPanel.querySelector("#pol-rule-rank")?.value || "0", 10);
      const state = detailPanel.querySelector("#pol-rule-state")?.value || "enabled";
      const cond  = readGroupCondition(condEditorEl);
      const profs = readProfiles(profilesWrap);

      if (!name)         { editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_err_name")}</div>`; return; }
      if (!cond)         { editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_err_cond")}</div>`; return; }
      if (!profs.length) { editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_err_profile")}</div>`; return; }

      editorMsg.innerHTML = `<div class="alert info">${t("pol.ed_saving")}</div>`;
      const btn = detailPanel.querySelector("#pol-save-rule-btn");
      btn.disabled = true;
      try {
        if (isNew) {
          await api.createPolicyRule(setId, { policy_set_id: setId, name, rank, state, condition: cond, profiles: profs });
          editorMsg.innerHTML = `<div class="alert success">${t("pol.ed_saved_new")}</div>`;
          selectedRuleId = null;
        } else {
          await api.updatePolicyRule(setId, existing.id, { name, rank, state, condition: cond, profiles: profs });
          editorMsg.innerHTML = `<div class="alert success">${t("pol.ed_saved_edit")}</div>`;
        }
        await loadRules(setId);
      } catch (err) {
        editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_save_err").replace("{msg}", esc(err.message))}</div>`;
        btn.disabled = false;
      }
    });

    detailPanel.querySelector("#pol-cancel-rule-btn").addEventListener("click", () => {
      if (existing) showRuleDetail(existing, setId);
      else clearDetail();
    });
  }

  newRuleBtn?.addEventListener("click", () => {
    if (!selectedSetId) return;
    showRuleEditor(null, selectedSetId);
  });

  container.querySelector("#pol-refresh").addEventListener("click", loadSets);

  await loadSets();

  return function cleanup() {
    // Listeners er på container-children der erstattes ved næste render.
    // Cleanup bruges primært til at signalere til app.js at view håndterer livscyklus korrekt.
  };
}
