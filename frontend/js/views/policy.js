// Policy dashboard — Idé 3: RADIUS policy sets + authorization rules.
// Three-pane layout: policy sets | rules | rule detail/editor.

import { api } from "../api.js";
import { auth } from "../auth.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const STATE_LABEL = { enabled: "Aktiv", disabled: "Inaktiv" };

// ── Condition builder helpers ─────────────────────────────────────────────────

const DICTIONARIES = [
  { name: "EndPoints",      attrs: ["Owner", "Type", "Lokation", "AuthzVlan", "AuthzACL", "PlatformType", "PSK_Mode", "Description"] },
  { name: "IdentityGroup",  attrs: ["Name"] },
  { name: "Radius",         attrs: ["Called-Station-ID", "NAS-Port-Type", "NAS-Identifier", "User-Name", "Framed-IP-Address"] },
  { name: "Network",        attrs: ["Device Name", "Location", "Device Type"] },
];

const OPERATORS = [
  { value: "equals",       label: "=" },
  { value: "notEquals",    label: "≠" },
  { value: "contains",     label: "indeholder" },
  { value: "notContains",  label: "indeholder ikke" },
  { value: "startsWith",   label: "starter med" },
  { value: "endsWith",     label: "slutter med" },
  { value: "matches",      label: "matcher (regex)" },
];

function operatorOptions(sel = "equals") {
  return OPERATORS.map((o) =>
    `<option value="${o.value}"${o.value === sel ? " selected" : ""}>${esc(o.label)}</option>`
  ).join("");
}

function dictionaryOptions(sel = "EndPoints") {
  return DICTIONARIES.map((d) =>
    `<option value="${d.name}"${d.name === sel ? " selected" : ""}>${esc(d.name)}</option>`
  ).join("");
}

function attrOptions(dictName, sel = "") {
  const d = DICTIONARIES.find((x) => x.name === dictName);
  const attrs = d ? d.attrs : [];
  return attrs.map((a) =>
    `<option value="${a}"${a === sel ? " selected" : ""}>${esc(a)}</option>`
  ).join("");
}

// Render a condition row (single attribute)
function condRowHtml(idx, cond = {}) {
  const dn = cond.dictionaryName || "EndPoints";
  const an = cond.attributeName || "";
  const op = cond.operator || "equals";
  const av = cond.attributeValue || "";
  return `
    <div class="cond-row" data-idx="${idx}">
      <select class="cond-dict" data-idx="${idx}">${dictionaryOptions(dn)}</select>
      <select class="cond-attr" data-idx="${idx}">${attrOptions(dn, an)}</select>
      <select class="cond-op"   data-idx="${idx}">${operatorOptions(op)}</select>
      <input  class="cond-val"  data-idx="${idx}" type="text" value="${esc(av)}" placeholder="verdi" />
      <button class="cond-del secondary small" data-idx="${idx}" type="button">✕</button>
    </div>`;
}

// Build a condition object from editor state
function buildCondition(rows, blockType) {
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const r = rows[0];
    return {
      conditionType: "ConditionAttributes",
      isNegate: false,
      dictionaryName: r.dict,
      attributeName: r.attr,
      operator: r.op,
      attributeValue: r.val,
    };
  }
  return {
    conditionType: blockType === "OR" ? "ConditionOrBlock" : "ConditionAndBlock",
    isNegate: false,
    children: rows.map((r) => ({
      conditionType: "ConditionAttributes",
      isNegate: false,
      dictionaryName: r.dict,
      attributeName: r.attr,
      operator: r.op,
      attributeValue: r.val,
    })),
  };
}

function readCondRows(editor) {
  return [...editor.querySelectorAll(".cond-row")].map((row) => {
    const idx = row.dataset.idx;
    return {
      dict: editor.querySelector(`.cond-dict[data-idx="${idx}"]`)?.value || "EndPoints",
      attr: editor.querySelector(`.cond-attr[data-idx="${idx}"]`)?.value || "",
      op:   editor.querySelector(`.cond-op[data-idx="${idx}"]`)?.value || "equals",
      val:  editor.querySelector(`.cond-val[data-idx="${idx}"]`)?.value || "",
    };
  });
}

// ── Condition summary renderer ────────────────────────────────────────────────

function renderConditionTree(cond, depth = 0) {
  if (!cond) return "<em>ingen betingelse</em>";
  const ct = cond.conditionType || "";
  const indent = depth * 12;
  const style = `style="margin-left:${indent}px"`;

  if (ct === "ConditionReference") {
    return `<div class="cond-tree-ref" ${style}>[Ref: ${esc(cond.name || "")}]</div>`;
  }
  if (ct === "ConditionAttributes") {
    const neg = cond.isNegate ? "<span class='cond-neg'>IKKE</span> " : "";
    return `<div class="cond-tree-single" ${style}>${neg}<span class="cond-dict-lbl">${esc(cond.dictionaryName)}</span>.<span class="cond-attr-lbl">${esc(cond.attributeName)}</span> <span class="cond-op-lbl">${esc(cond.operator)}</span> <span class="cond-val-lbl">${esc(cond.attributeValue)}</span></div>`;
  }
  if (ct === "ConditionAndBlock" || ct === "ConditionOrBlock") {
    const sep = ct === "ConditionAndBlock" ? "AND" : "OR";
    const children = (cond.children || []).map((c) => renderConditionTree(c, depth + 1)).join(
      `<div class="cond-tree-sep" ${style}>— ${sep} —</div>`
    );
    return `<div class="cond-tree-block" ${style}>${children}</div>`;
  }
  return `<div ${style}>${esc(ct)}</div>`;
}

// ── Profiles input helper ─────────────────────────────────────────────────────

const KNOWN_PROFILES = [
  "PermitAccess", "DenyAccess", "Endpoint_VLAN", "Endpoint_AirSpaceACL",
  "Endpoint_PSK-KEY", "Permit_TEMP_ACCESS",
];

function profilesInputHtml(existing = []) {
  const tags = existing.map((p) =>
    `<span class="profile-tag">${esc(p)}<button type="button" class="profile-tag-del" data-p="${esc(p)}">✕</button></span>`
  ).join("");
  const opts = KNOWN_PROFILES.map((p) =>
    `<option value="${p}">${esc(p)}</option>`
  ).join("");
  return `
    <div id="profiles-tags">${tags}</div>
    <div class="profiles-add-row">
      <select id="profile-preset"><option value="">+ vælg profil…</option>${opts}</select>
      <input type="text" id="profile-custom" placeholder="eller skriv navn…" />
      <button type="button" id="profile-add-btn" class="secondary small">Tilføj</button>
    </div>`;
}

function readProfiles(editor) {
  return [...editor.querySelectorAll(".profile-tag")].map((t) =>
    t.dataset.p || t.textContent.replace("✕", "").trim()
  ).filter(Boolean);
}

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

  let selectedSetId = null;
  let selectedSetName = "";
  let condRowIdx = 0;

  const setsList    = container.querySelector("#pol-sets-list");
  const rulesTitle  = container.querySelector("#pol-rules-title");
  const rulesMsg    = container.querySelector("#pol-rules-msg");
  const rulesList   = container.querySelector("#pol-rules-list");
  const detailMsg   = container.querySelector("#pol-detail-msg");
  const detailContent = container.querySelector("#pol-detail-content");
  const newRuleBtn  = container.querySelector("#pol-new-rule-btn");

  // ── Load policy sets ──────────────────────────────────────────────────────
  async function loadSets() {
    setsList.innerHTML = `<div class="alert info">Henter policy sets…</div>`;
    try {
      const res = await api.listPolicySets();
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

      setsList.querySelectorAll(".policy-set-item").forEach((el) => {
        el.addEventListener("click", () => selectSet(el.dataset.id, el.dataset.name));
      });
    } catch (err) {
      setsList.innerHTML = `<div class="alert error">Fejl ved hentning af policy sets: ${esc(err.message)}</div>`;
    }
  }

  // ── Select a policy set → load rules ─────────────────────────────────────
  async function selectSet(id, name) {
    selectedSetId   = id;
    selectedSetName = name;
    setsList.querySelectorAll(".policy-set-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === id)
    );
    rulesTitle.textContent = name;
    newRuleBtn?.classList.remove("hidden");
    detailContent.innerHTML = "";
    detailMsg.innerHTML = "";
    await loadRules(id);
  }

  // ── Load rules for selected set ───────────────────────────────────────────
  async function loadRules(setId) {
    rulesList.innerHTML = `<div class="alert info">Henter regler…</div>`;
    rulesMsg.innerHTML = "";
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

      rulesList.querySelectorAll(".policy-rule-item").forEach((el) => {
        el.addEventListener("click", () => selectRule(el.dataset.id, setId));
      });
    } catch (err) {
      rulesList.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
    }
  }

  // ── Show rule detail ──────────────────────────────────────────────────────
  async function selectRule(ruleId, setId) {
    detailMsg.innerHTML = `<div class="alert info">Henter regeldetaljer…</div>`;
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

  // ── Rule editor (new + edit) ──────────────────────────────────────────────
  function showRuleEditor(existing = null, setId) {
    const isNew = !existing;
    condRowIdx = 0;

    const existingRows = existing?.condition
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
        <label>Rank (prioritet — lavere = højere prioritet)
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
          ${existingRows.map((r, i) => { condRowIdx = i; return condRowHtml(i, r); }).join("")}
        </div>
        <button type="button" id="pol-add-cond" class="secondary small">+ Tilføj betingelse</button>

        <div class="editor-section-label">Autoriseringsprofiler</div>
        <div id="pol-profiles-wrap">${profilesInputHtml(existing?.profiles || [])}</div>

        <div class="detail-actions">
          <button type="button" id="pol-save-rule-btn">${isNew ? "Opret regel i ISE" : "Gem ændringer"}</button>
          <button type="button" id="pol-cancel-rule-btn" class="secondary">Annullér</button>
        </div>
      </div>`;

    // ── Condition row events ────────────────────────────────────────────────
    const condRows = detailContent.querySelector("#pol-cond-rows");

    condRows.addEventListener("change", (e) => {
      if (e.target.classList.contains("cond-dict")) {
        const idx = e.target.dataset.idx;
        const attrSel = condRows.querySelector(`.cond-attr[data-idx="${idx}"]`);
        if (attrSel) attrSel.innerHTML = attrOptions(e.target.value);
      }
    });

    condRows.addEventListener("click", (e) => {
      if (e.target.classList.contains("cond-del")) {
        const idx = e.target.dataset.idx;
        condRows.querySelector(`.cond-row[data-idx="${idx}"]`)?.remove();
      }
    });

    detailContent.querySelector("#pol-add-cond").addEventListener("click", () => {
      condRowIdx++;
      condRows.insertAdjacentHTML("beforeend", condRowHtml(condRowIdx));
    });

    // ── Profile tag events ──────────────────────────────────────────────────
    const profilesWrap = detailContent.querySelector("#pol-profiles-wrap");

    profilesWrap.addEventListener("click", (e) => {
      if (e.target.classList.contains("profile-tag-del")) {
        e.target.closest(".profile-tag")?.remove();
      }
      if (e.target.id === "profile-add-btn") {
        const preset = profilesWrap.querySelector("#profile-preset")?.value;
        const custom = profilesWrap.querySelector("#profile-custom")?.value.trim();
        const name   = preset || custom;
        if (!name) return;
        const tags = profilesWrap.querySelector("#profiles-tags");
        tags.insertAdjacentHTML("beforeend",
          `<span class="profile-tag" data-p="${esc(name)}">${esc(name)}<button type="button" class="profile-tag-del" data-p="${esc(name)}">✕</button></span>`
        );
        if (profilesWrap.querySelector("#profile-preset")) profilesWrap.querySelector("#profile-preset").value = "";
        if (profilesWrap.querySelector("#profile-custom")) profilesWrap.querySelector("#profile-custom").value = "";
      }
    });

    // ── Save ────────────────────────────────────────────────────────────────
    detailContent.querySelector("#pol-save-rule-btn").addEventListener("click", async () => {
      const editorMsg = detailContent.querySelector("#pol-editor-msg");
      const name  = detailContent.querySelector("#pol-rule-name")?.value.trim();
      const rank  = parseInt(detailContent.querySelector("#pol-rule-rank")?.value || "0", 10);
      const state = detailContent.querySelector("#pol-rule-state")?.value || "enabled";
      const bt    = detailContent.querySelector("#pol-block-type")?.value || "AND";
      const rows  = readCondRows(detailContent);
      const cond  = buildCondition(rows, bt);
      const profs = readProfiles(detailContent);

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

  // ── New rule button ───────────────────────────────────────────────────────
  newRuleBtn?.addEventListener("click", () => {
    if (!selectedSetId) return;
    showRuleEditor(null, selectedSetId);
  });

  container.querySelector("#pol-refresh").addEventListener("click", loadSets);

  await loadSets();
}

// ── Flatten condition tree to editable rows ───────────────────────────────────

function flattenConditionToRows(cond) {
  if (!cond) return [];
  const ct = cond.conditionType;
  if (ct === "ConditionAttributes") {
    return [{
      dict: cond.dictionaryName || "EndPoints",
      attr: cond.attributeName || "",
      op:   cond.operator || "equals",
      val:  cond.attributeValue || "",
    }];
  }
  if (ct === "ConditionAndBlock" || ct === "ConditionOrBlock") {
    return (cond.children || []).flatMap((c) => flattenConditionToRows(c));
  }
  return [];
}
