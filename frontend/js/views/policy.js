// Policy dashboard — Idé 3: RADIUS policy sets + authorization rules.
// Three-pane layout: policy sets | rules | rule detail/editor.

import { api } from "../api.js";
import { auth } from "../auth.js";
import {
  condRowHtml, readCondRows, wireCondRowEvents, buildCondition, flattenConditionToRows,
  renderConditionTree,
  profilesHtml, readProfiles, wireProfileEvents,
} from "./policy-condition-builder.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const STATE_LABEL = { enabled: "Aktiv", disabled: "Inaktiv" };

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderPolicy(container) {
  const isEditor = auth.isEditor();

  container.innerHTML = `
    <div class="policy-layout">
      <aside class="policy-sets-pane">
        <div class="policy-pane-header">
          <h3>Policy Sets</h3>
          <button id="pol-refresh" class="secondary small">↺</button>
        </div>
        <div id="pol-sets-list" class="policy-sets-list"><div class="alert info">Henter…</div></div>
      </aside>

      <section class="policy-rules-pane">
        <div class="policy-pane-header">
          <h3 id="pol-rules-title">Vælg et policy set</h3>
          ${isEditor ? `<button id="pol-new-rule-btn" class="hidden">+ Ny regel</button>` : ""}
        </div>
        <div id="pol-rules-msg"></div>
        <div id="pol-rules-list" class="policy-rules-list"></div>
      </section>

      <section class="policy-detail-pane">
        <div id="pol-detail-msg"></div>
        <div id="pol-detail-content"></div>
      </section>
    </div>
  `;

  let selectedSetId   = null;
  let selectedSetName = "";
  let caValues        = {};

  const setsList      = container.querySelector("#pol-sets-list");
  const rulesTitle    = container.querySelector("#pol-rules-title");
  const rulesMsg      = container.querySelector("#pol-rules-msg");
  const rulesList     = container.querySelector("#pol-rules-list");
  const detailMsg     = container.querySelector("#pol-detail-msg");
  const detailContent = container.querySelector("#pol-detail-content");
  const newRuleBtn    = container.querySelector("#pol-new-rule-btn");

  // Fetch custom attribute values for dropdown suggestions in condition builder
  api.listCustomAttributes().then((res) => {
    if (res?.attributes) {
      for (const a of res.attributes) caValues[a.name] = a.values || [];
    }
  }).catch(() => {});

  // ── Policy sets ───────────────────────────────────────────────────────────
  async function loadSets() {
    setsList.innerHTML = `<div class="alert info">Henter policy sets…</div>`;
    try {
      const res  = await api.listPolicySets();
      const sets = res?.policy_sets || [];
      if (!sets.length) {
        setsList.innerHTML = `<div class="hint">Ingen policy sets fundet i ISE.</div>`;
        return;
      }
      setsList.innerHTML = sets.map((s) => `
        <div class="policy-set-item${s.id === selectedSetId ? " active" : ""}" data-id="${esc(s.id)}" data-name="${esc(s.name)}">
          <div class="ps-name">${esc(s.name)}</div>
          <div class="ps-meta">${esc(s.service_name || "")} · <span class="ps-state ${s.state}">${STATE_LABEL[s.state] || s.state}</span></div>
        </div>
      `).join("");
      setsList.querySelectorAll(".policy-set-item").forEach((el) =>
        el.addEventListener("click", () => selectSet(el.dataset.id, el.dataset.name))
      );
    } catch (err) {
      setsList.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
    }
  }

  async function selectSet(id, name) {
    selectedSetId   = id;
    selectedSetName = name;
    setsList.querySelectorAll(".policy-set-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === id)
    );
    rulesTitle.textContent = name;
    newRuleBtn?.classList.remove("hidden");
    detailContent.innerHTML = "";
    detailMsg.innerHTML     = "";
    await loadRules(id);
  }

  // ── Authorization rules ───────────────────────────────────────────────────
  async function loadRules(setId) {
    rulesList.innerHTML = `<div class="alert info">Henter regler…</div>`;
    rulesMsg.innerHTML  = "";
    try {
      const rules = await api.listPolicyRules(setId);
      if (!rules.length) {
        rulesList.innerHTML = `<div class="hint">Ingen autoriseringsregler i dette policy set.</div>`;
        return;
      }
      rulesList.innerHTML = rules.map((r) => `
        <div class="policy-rule-item" data-id="${esc(r.id)}" data-rank="${r.rank}">
          <div class="pr-rank">#${r.rank}</div>
          <div class="pr-body">
            <div class="pr-name">${esc(r.name)}</div>
            <div class="pr-cond">${esc(r.condition_summary || "")}</div>
            <div class="pr-profiles">${(r.profiles || []).map((p) => `<span class="profile-chip">${esc(p)}</span>`).join("")}</div>
          </div>
          <div class="pr-state ${r.state}">${STATE_LABEL[r.state] || r.state}</div>
        </div>
      `).join("");
      rulesList.querySelectorAll(".policy-rule-item").forEach((el) =>
        el.addEventListener("click", () => selectRule(el.dataset.id, setId))
      );
    } catch (err) {
      rulesList.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
    }
  }

  // ── Rule detail ───────────────────────────────────────────────────────────
  async function selectRule(ruleId, setId) {
    detailMsg.innerHTML     = `<div class="alert info">Henter regeldetaljer…</div>`;
    detailContent.innerHTML = "";
    rulesList.querySelectorAll(".policy-rule-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === ruleId)
    );
    try {
      const rules = await api.listPolicyRules(setId);
      const rule  = rules.find((r) => r.id === ruleId);
      if (!rule) { detailMsg.innerHTML = `<div class="alert error">Regel ikke fundet.</div>`; return; }
      detailMsg.innerHTML = "";
      showRuleDetail(rule, setId);
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
    }
  }

  function showRuleDetail(rule, setId) {
    const profiles = (rule.profiles || []).map((p) => `<span class="profile-chip">${esc(p)}</span>`).join("") || "—";
    detailContent.innerHTML = `
      <div class="policy-detail-card">
        <div class="detail-card-header">
          <h4>${esc(rule.name)}</h4>
          <span class="ps-state ${rule.state}">${STATE_LABEL[rule.state] || rule.state}</span>
        </div>
        <div class="detail-row"><span class="detail-lbl">Rank:</span> ${rule.rank}</div>
        <div class="detail-row"><span class="detail-lbl">Profiler:</span> ${profiles}</div>
        <div class="detail-row detail-cond-block">
          <span class="detail-lbl">Betingelse:</span>
          <div class="cond-tree">${renderConditionTree(rule.condition)}</div>
        </div>
        ${isEditor ? `
        <div class="detail-actions">
          <button id="pol-edit-rule-btn" class="secondary" data-id="${esc(rule.id)}">Rediger</button>
          <button id="pol-del-rule-btn"  class="danger"    data-id="${esc(rule.id)}">Slet regel</button>
        </div>` : ""}
      </div>`;

    if (isEditor) {
      detailContent.querySelector("#pol-edit-rule-btn")?.addEventListener("click", () =>
        showRuleEditor(rule, setId)
      );
      detailContent.querySelector("#pol-del-rule-btn")?.addEventListener("click", async () => {
        if (!confirm(`Slet reglen '${rule.name}'?\n\nDenne handling kan ikke fortrydes.`)) return;
        try {
          await api.deletePolicyRule(setId, rule.id);
          detailContent.innerHTML = `<div class="alert success">Regel slettet.</div>`;
          await loadRules(setId);
        } catch (err) {
          detailMsg.innerHTML = `<div class="alert error">Sletning fejlede: ${esc(err.message)}</div>`;
        }
      });
    }
  }

  // ── Rule editor ───────────────────────────────────────────────────────────
  function showRuleEditor(existing = null, setId) {
    const isNew    = !existing;
    const initRows = existing?.condition
      ? flattenConditionToRows(existing.condition)
      : [{ dict: "EndPoints", attr: "Owner", op: "equals", val: "" }];
    const blockType = existing?.condition?.conditionType === "ConditionOrBlock" ? "OR" : "AND";

    detailMsg.innerHTML = "";
    detailContent.innerHTML = `
      <div class="policy-editor-card">
        <h4>${isNew ? "Ny autoriseringsregel" : `Rediger: ${esc(existing?.name || "")}`}</h4>
        <div id="pol-editor-msg"></div>

        <label>Navn
          <input type="text" id="pol-rule-name" value="${esc(existing?.name || "")}" placeholder="Regelnavn…" />
        </label>
        <label>Rank <small>(lavere tal = højere prioritet)</small>
          <input type="number" id="pol-rule-rank" value="${existing?.rank ?? 0}" min="0" />
        </label>
        <label>Status
          <select id="pol-rule-state">
            <option value="enabled"${(!existing || existing.state === "enabled") ? " selected" : ""}>Aktiv</option>
            <option value="disabled"${existing?.state === "disabled" ? " selected" : ""}>Inaktiv</option>
          </select>
        </label>

        <div class="editor-section-label">Betingelser
          <select id="pol-block-type">
            <option value="AND"${blockType === "AND" ? " selected" : ""}>Alle skal matche (AND)</option>
            <option value="OR"${blockType === "OR" ? " selected" : ""}>Mindst én matcher (OR)</option>
          </select>
        </div>
        <div id="pol-cond-rows">
          ${initRows.map((r, i) => condRowHtml(i, r, caValues)).join("")}
        </div>
        <button type="button" id="pol-add-cond" class="secondary small">+ Tilføj betingelse</button>

        <div class="editor-section-label">Autoriseringsprofiler</div>
        <div id="pol-profiles-wrap">${profilesHtml(existing?.profiles || [])}</div>

        <div class="detail-actions">
          <button type="button" id="pol-save-rule-btn">${isNew ? "Opret regel i ISE" : "Gem ændringer"}</button>
          <button type="button" id="pol-cancel-rule-btn" class="secondary">Annullér</button>
        </div>
      </div>`;

    const condRowsEl   = detailContent.querySelector("#pol-cond-rows");
    const profilesWrap = detailContent.querySelector("#pol-profiles-wrap");

    const addRow = wireCondRowEvents(condRowsEl, caValues);
    wireProfileEvents(profilesWrap);

    detailContent.querySelector("#pol-add-cond").addEventListener("click", () => addRow());

    detailContent.querySelector("#pol-save-rule-btn").addEventListener("click", async () => {
      const editorMsg = detailContent.querySelector("#pol-editor-msg");
      const name  = detailContent.querySelector("#pol-rule-name")?.value.trim();
      const rank  = parseInt(detailContent.querySelector("#pol-rule-rank")?.value || "0", 10);
      const state = detailContent.querySelector("#pol-rule-state")?.value || "enabled";
      const bt    = detailContent.querySelector("#pol-block-type")?.value || "AND";
      const rows  = readCondRows(condRowsEl);
      const cond  = buildCondition(rows, bt);
      const profs = readProfiles(profilesWrap);

      if (!name) { editorMsg.innerHTML = `<div class="alert error">Angiv et regelnavn.</div>`; return; }
      if (!cond) { editorMsg.innerHTML = `<div class="alert error">Tilføj mindst én betingelse.</div>`; return; }
      if (!profs.length) { editorMsg.innerHTML = `<div class="alert error">Tilføj mindst én autoriseringsprofil.</div>`; return; }

      editorMsg.innerHTML = `<div class="alert info">Gemmer…</div>`;
      const btn = detailContent.querySelector("#pol-save-rule-btn");
      btn.disabled = true;
      try {
        if (isNew) {
          await api.createPolicyRule(setId, { policy_set_id: setId, name, rank, state, condition: cond, profiles: profs });
          editorMsg.innerHTML = `<div class="alert success">Regel oprettet i ISE.</div>`;
        } else {
          await api.updatePolicyRule(setId, existing.id, { name, rank, state, condition: cond, profiles: profs });
          editorMsg.innerHTML = `<div class="alert success">Regel gemt.</div>`;
        }
        await loadRules(setId);
        setTimeout(() => { detailContent.innerHTML = ""; }, 1500);
      } catch (err) {
        editorMsg.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    });

    detailContent.querySelector("#pol-cancel-rule-btn").addEventListener("click", () => {
      detailContent.innerHTML = "";
    });
  }

  newRuleBtn?.addEventListener("click", () => {
    if (!selectedSetId) return;
    showRuleEditor(null, selectedSetId);
  });

  container.querySelector("#pol-refresh").addEventListener("click", loadSets);

  await loadSets();
}
