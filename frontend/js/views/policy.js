// Policy dashboard — master-detail layout.
// Venstre: regelkort-liste. Højre: detail/editor. Max-width så det ikke strækker sig.

import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
import {
  groupEditorHtml, wireGroupEditor, readGroupCondition,
  renderConditionTree, renderConditionChips,
  profilesHtml, readProfiles, wireProfileEvents,
} from "./policy-condition-builder.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function stateLabel(s) {
  return s === "enabled" ? t("pol.state_enabled") : t("pol.state_disabled");
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderPolicy(container) {
  const isEditor = auth.isEditor();

  container.innerHTML = `
    <div class="pol-page">

      <div class="pol-sets-bar">
        <div class="pol-inner">
          <div class="pol-sets-header">
            <span class="pol-sets-label">${t("pol.title")}</span>
            <button id="pol-refresh" class="secondary small" title="${t("pol.refresh")}">↺</button>
          </div>
          <div id="pol-sets-row" class="pol-sets-row">
            <div class="alert info">${t("pol.sets_loading")}</div>
          </div>
        </div>
      </div>

      <div class="pol-body">
        <div class="pol-inner pol-split">

          <div class="pol-list-col">
            <div class="pol-rules-header">
              <h3 id="pol-rules-title" class="pol-rules-title">${t("pol.select_set")}</h3>
              ${isEditor ? `<button id="pol-new-rule-btn" class="hidden">${t("pol.new_rule")}</button>` : ""}
            </div>
            <div id="pol-rules-msg"></div>
            <div id="pol-rules-list" class="pol-rules-list"></div>
          </div>

          <div class="pol-detail-col" id="pol-detail-panel">
            <div class="pol-detail-placeholder">${t("pol.select_set")}</div>
          </div>

        </div>
      </div>

    </div>
  `;

  let selectedSetId   = null;
  let selectedSetName = "";
  let selectedRuleId  = null;
  let caValues        = {};

  const setsRow     = container.querySelector("#pol-sets-row");
  const rulesTitle  = container.querySelector("#pol-rules-title");
  const rulesMsg    = container.querySelector("#pol-rules-msg");
  const rulesList   = container.querySelector("#pol-rules-list");
  const detailPanel = container.querySelector("#pol-detail-panel");
  const newRuleBtn  = container.querySelector("#pol-new-rule-btn");

  api.listCustomAttributes().then((res) => {
    if (res?.attributes) {
      for (const a of res.attributes) caValues[a.name] = a.values || [];
    }
  }).catch(() => {});

  api.listGroups().then((res) => {
    const groups = Array.isArray(res) ? res : (res?.groups || []);
    caValues["__IdentityGroup_Name__"] = groups
      .map((g) => g.name).filter(Boolean)
      .map((n) => n.startsWith("Endpoint Identity Groups:") ? n : "Endpoint Identity Groups:" + n);
  }).catch(() => {});

  function clearDetail() {
    selectedRuleId = null;
    detailPanel.innerHTML = `<div class="pol-detail-placeholder">${t("pol.select_set")}</div>`;
    rulesList.querySelectorAll(".pol-rule-card").forEach((c) => c.classList.remove("active"));
  }

  // ── Policy sets ─────────────────────────────────────────────────────────────
  async function loadSets() {
    setsRow.innerHTML = `<div class="alert info">${t("pol.sets_loading")}</div>`;
    try {
      const res  = await api.listPolicySets();
      const sets = res?.policy_sets || [];
      if (!sets.length) {
        setsRow.innerHTML = `<div class="hint">${t("pol.sets_empty")}</div>`;
        return;
      }
      setsRow.innerHTML = sets.map((s) => `
        <div class="pol-set-card${s.id === selectedSetId ? " active" : ""}" data-id="${esc(s.id)}" data-name="${esc(s.name)}">
          <div class="pol-set-name">${esc(s.name)}</div>
          <div class="pol-set-meta">${esc(s.service_name || "")}</div>
          <span class="pol-set-badge ${s.state}">${stateLabel(s.state)}</span>
        </div>
      `).join("");
      setsRow.querySelectorAll(".pol-set-card").forEach((el) =>
        el.addEventListener("click", () => selectSet(el.dataset.id, el.dataset.name))
      );
    } catch (err) {
      setsRow.innerHTML = `<div class="alert error">${t("pol.sets_error").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  async function selectSet(id, name) {
    selectedSetId   = id;
    selectedSetName = name;
    setsRow.querySelectorAll(".pol-set-card").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === id)
    );
    rulesTitle.textContent = name;
    newRuleBtn?.classList.remove("hidden");
    clearDetail();
    await loadRules(id);
  }

  // ── Authorization rules ──────────────────────────────────────────────────────
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
      // Restore selection if same rule still exists
      if (selectedRuleId) {
        const still = rules.find((r) => r.id === selectedRuleId);
        if (still) {
          showRuleDetail(still, setId);
        } else {
          clearDetail();
        }
      }
    } catch (err) {
      rulesList.innerHTML = `<div class="alert error">${t("pol.rules_error").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  // ── Rule card HTML ───────────────────────────────────────────────────────────
  function renderRuleCard(r) {
    const chips    = renderConditionChips(r.condition);
    const profiles = (r.profiles || []).map((p) =>
      `<span class="profile-chip">${esc(p)}</span>`
    ).join("") || "";

    return `
      <div class="pol-rule-card${r.id === selectedRuleId ? " active" : ""}" data-id="${esc(r.id)}">
        <div class="pol-rule-rank">
          <span class="pol-rank-badge">${r.rank}</span>
        </div>
        <div class="pol-rule-body">
          <div class="pol-rule-top">
            <span class="pol-rule-name">${esc(r.name)}</span>
            <span class="pol-state-badge ${r.state}">${stateLabel(r.state)}</span>
          </div>
          <div class="pol-rule-chips">${chips}</div>
          ${profiles ? `<div class="pol-rule-profiles"><span class="pol-profiles-arrow">→</span>${profiles}</div>` : ""}
        </div>
      </div>`;
  }

  function wireRuleCards(list, rules, setId) {
    list.querySelectorAll(".pol-rule-card").forEach((card) => {
      const id   = card.dataset.id;
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;

      card.addEventListener("click", () => {
        if (selectedRuleId === id) { clearDetail(); return; }
        showRuleDetail(rule, setId);
      });
    });
  }

  // ── Rule detail (right panel) ────────────────────────────────────────────────
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

        ${isEditor ? `
        <div class="detail-actions">
          <button id="pol-detail-edit" class="secondary">${t("pol.btn_edit")}</button>
          <button id="pol-detail-del"  class="danger">${t("pol.btn_delete")}</button>
        </div>` : ""}
      </div>`;

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

  // ── Rule editor (right panel) ────────────────────────────────────────────────
  function showRuleEditor(existing = null, setId) {
    const isNew = !existing;

    // Mark card active if editing existing
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

        <div class="detail-actions">
          <button type="button" id="pol-save-rule-btn">${isNew ? t("pol.ed_save_new") : t("pol.ed_save_edit")}</button>
          <button type="button" id="pol-cancel-rule-btn" class="secondary">${t("pol.ed_cancel")}</button>
        </div>
      </div>`;

    const condEditorEl = detailPanel.querySelector("#pol-cond-editor");
    const profilesWrap = detailPanel.querySelector("#pol-profiles-wrap");
    wireGroupEditor(condEditorEl, caValues);
    wireProfileEvents(profilesWrap);

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
      if (existing) {
        showRuleDetail(existing, setId);
      } else {
        clearDetail();
      }
    });
  }

  newRuleBtn?.addEventListener("click", () => {
    if (!selectedSetId) return;
    showRuleEditor(null, selectedSetId);
  });

  container.querySelector("#pol-refresh").addEventListener("click", loadSets);

  await loadSets();
}
