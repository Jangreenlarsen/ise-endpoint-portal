// Policy dashboard — grafisk redesign.
// Layout: policy set-kort øverst → regelkort med rank-badge, betingelses-chips, profil-chips.

import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
import {
  condRowHtml, readCondRows, wireCondRowEvents, buildCondition, flattenConditionToRows,
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
        <div class="pol-sets-header">
          <span class="pol-sets-label">${t("pol.title")}</span>
          <button id="pol-refresh" class="secondary small" title="${t("pol.refresh")}">↺</button>
        </div>
        <div id="pol-sets-row" class="pol-sets-row">
          <div class="alert info">${t("pol.sets_loading")}</div>
        </div>
      </div>

      <div class="pol-rules-area">
        <div class="pol-rules-header">
          <h3 id="pol-rules-title" class="pol-rules-title">${t("pol.select_set")}</h3>
          ${isEditor ? `<button id="pol-new-rule-btn" class="hidden">+ ${t("pol.new_rule").replace("+ ", "")}</button>` : ""}
        </div>
        <div id="pol-rules-msg"></div>
        <div id="pol-rules-list" class="pol-rules-list"></div>
      </div>

    </div>
  `;

  let selectedSetId   = null;
  let selectedSetName = "";
  let caValues        = {};

  const setsRow    = container.querySelector("#pol-sets-row");
  const rulesTitle = container.querySelector("#pol-rules-title");
  const rulesMsg   = container.querySelector("#pol-rules-msg");
  const rulesList  = container.querySelector("#pol-rules-list");
  const newRuleBtn = container.querySelector("#pol-new-rule-btn");

  api.listCustomAttributes().then((res) => {
    if (res?.attributes) {
      for (const a of res.attributes) caValues[a.name] = a.values || [];
    }
  }).catch(() => {});

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
      // Restore active set selection after reload
      if (selectedSetId) {
        setsRow.querySelector(`.pol-set-card[data-id="${selectedSetId}"]`)?.classList.add("active");
      }
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
        return;
      }
      rulesList.innerHTML = rules.map((r) => renderRuleCard(r, isEditor)).join("");
      wireRuleCards(rulesList, rules, setId);
    } catch (err) {
      rulesList.innerHTML = `<div class="alert error">${t("pol.rules_error").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  // ── Rule card HTML ───────────────────────────────────────────────────────────
  function renderRuleCard(r, editor) {
    const chips    = renderConditionChips(r.condition);
    const profiles = (r.profiles || []).map((p) =>
      `<span class="profile-chip">${esc(p)}</span>`
    ).join("") || "";

    return `
      <div class="pol-rule-card" data-id="${esc(r.id)}">
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
        ${editor ? `
        <div class="pol-rule-actions">
          <button class="pol-btn-edit secondary small" data-id="${esc(r.id)}" title="${t("pol.btn_edit")}">✏</button>
          <button class="pol-btn-del  danger  small" data-id="${esc(r.id)}" title="${t("pol.btn_delete")}">🗑</button>
        </div>` : ""}
      </div>`;
  }

  function wireRuleCards(list, rules, setId) {
    list.querySelectorAll(".pol-rule-card").forEach((card) => {
      const id   = card.dataset.id;
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;

      // Click body to expand/collapse detail
      card.querySelector(".pol-rule-body")?.addEventListener("click", () =>
        toggleRuleDetail(card, rule, setId)
      );
      card.querySelector(".pol-rule-rank")?.addEventListener("click", () =>
        toggleRuleDetail(card, rule, setId)
      );

      if (isEditor) {
        card.querySelector(".pol-btn-edit")?.addEventListener("click", (e) => {
          e.stopPropagation();
          showRuleEditor(rule, setId);
        });
        card.querySelector(".pol-btn-del")?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const msg = t("pol.del_confirm").replace("{name}", rule.name);
          if (!confirm(msg)) return;
          try {
            await api.deletePolicyRule(setId, rule.id);
            rulesMsg.innerHTML = `<div class="alert success">${t("pol.del_ok")}</div>`;
            await loadRules(setId);
          } catch (err) {
            rulesMsg.innerHTML = `<div class="alert error">${t("pol.del_err").replace("{msg}", esc(err.message))}</div>`;
          }
        });
      }
    });
  }

  // ── Inline expand (rule detail) ──────────────────────────────────────────────
  function toggleRuleDetail(card, rule, setId) {
    const existing = card.querySelector(".pol-rule-detail");
    if (existing) { existing.remove(); return; }

    const profiles = (rule.profiles || []).map((p) =>
      `<span class="profile-chip">${esc(p)}</span>`
    ).join("") || "—";

    const detail = document.createElement("div");
    detail.className = "pol-rule-detail";
    detail.innerHTML = `
      <div class="pol-detail-row">
        <span class="pol-detail-lbl">${t("pol.rank_label")}:</span> ${rule.rank}
      </div>
      <div class="pol-detail-row">
        <span class="pol-detail-lbl">${t("pol.profiles_label")}:</span> ${profiles}
      </div>
      <div class="pol-detail-row pol-detail-cond">
        <span class="pol-detail-lbl">${t("pol.condition_label")}:</span>
        <div class="cond-tree">${renderConditionTree(rule.condition)}</div>
      </div>`;
    card.appendChild(detail);
  }

  // ── Rule editor (full card replace) ─────────────────────────────────────────
  function showRuleEditor(existing = null, setId) {
    const isNew    = !existing;
    const initRows = existing?.condition
      ? flattenConditionToRows(existing.condition)
      : [{ dict: "EndPoints", attr: "Owner", op: "equals", val: "" }];
    const blockType = existing?.condition?.conditionType === "ConditionOrBlock" ? "OR" : "AND";

    rulesMsg.innerHTML  = "";
    rulesList.innerHTML = `
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

        <div class="editor-section-label">${t("pol.ed_conds_label")}
          <select id="pol-block-type">
            <option value="AND"${blockType === "AND" ? " selected" : ""}>${t("pol.ed_logic_and")}</option>
            <option value="OR"${blockType === "OR" ? " selected" : ""}>${t("pol.ed_logic_or")}</option>
          </select>
        </div>
        <div id="pol-cond-rows">
          ${initRows.map((r, i) => condRowHtml(i, r, caValues)).join("")}
        </div>
        <button type="button" id="pol-add-cond" class="secondary small">${t("pol.ed_add_cond")}</button>

        <div class="editor-section-label">${t("pol.ed_profiles_label")}</div>
        <div id="pol-profiles-wrap">${profilesHtml(existing?.profiles || [])}</div>

        <div class="detail-actions">
          <button type="button" id="pol-save-rule-btn">${isNew ? t("pol.ed_save_new") : t("pol.ed_save_edit")}</button>
          <button type="button" id="pol-cancel-rule-btn" class="secondary">${t("pol.ed_cancel")}</button>
        </div>
      </div>`;

    const condRowsEl   = rulesList.querySelector("#pol-cond-rows");
    const profilesWrap = rulesList.querySelector("#pol-profiles-wrap");
    const addRow = wireCondRowEvents(condRowsEl, caValues);
    wireProfileEvents(profilesWrap);

    rulesList.querySelector("#pol-add-cond").addEventListener("click", () => addRow());

    rulesList.querySelector("#pol-save-rule-btn").addEventListener("click", async () => {
      const editorMsg = rulesList.querySelector("#pol-editor-msg");
      const name  = rulesList.querySelector("#pol-rule-name")?.value.trim();
      const rank  = parseInt(rulesList.querySelector("#pol-rule-rank")?.value || "0", 10);
      const state = rulesList.querySelector("#pol-rule-state")?.value || "enabled";
      const bt    = rulesList.querySelector("#pol-block-type")?.value || "AND";
      const rows  = readCondRows(condRowsEl);
      const cond  = buildCondition(rows, bt);
      const profs = readProfiles(profilesWrap);

      if (!name)        { editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_err_name")}</div>`; return; }
      if (!cond)        { editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_err_cond")}</div>`; return; }
      if (!profs.length){ editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_err_profile")}</div>`; return; }

      editorMsg.innerHTML = `<div class="alert info">${t("pol.ed_saving")}</div>`;
      const btn = rulesList.querySelector("#pol-save-rule-btn");
      btn.disabled = true;
      try {
        if (isNew) {
          await api.createPolicyRule(setId, { policy_set_id: setId, name, rank, state, condition: cond, profiles: profs });
          editorMsg.innerHTML = `<div class="alert success">${t("pol.ed_saved_new")}</div>`;
        } else {
          await api.updatePolicyRule(setId, existing.id, { name, rank, state, condition: cond, profiles: profs });
          editorMsg.innerHTML = `<div class="alert success">${t("pol.ed_saved_edit")}</div>`;
        }
        await loadRules(setId);
      } catch (err) {
        editorMsg.innerHTML = `<div class="alert error">${t("pol.ed_save_err").replace("{msg}", esc(err.message))}</div>`;
      } finally { btn.disabled = false; }
    });

    rulesList.querySelector("#pol-cancel-rule-btn").addEventListener("click", () =>
      loadRules(setId)
    );
  }

  newRuleBtn?.addEventListener("click", () => {
    if (!selectedSetId) return;
    showRuleEditor(null, selectedSetId);
  });

  container.querySelector("#pol-refresh").addEventListener("click", loadSets);

  await loadSets();
}
