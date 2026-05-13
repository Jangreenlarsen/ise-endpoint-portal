// Shared condition builder for RADIUS policy editor and rule wizard.
// Exported pure functions — no side effects except wireCondRowEvents/wireProfileEvents.

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ── Static metadata ───────────────────────────────────────────────────────────

export const DICTIONARIES = [
  { name: "EndPoints",     attrs: ["Owner", "Type", "Lokation", "AuthzVlan", "AuthzACL", "PlatformType", "PSK_Mode", "Description"] },
  { name: "IdentityGroup", attrs: ["Name"] },
  { name: "Radius",        attrs: ["Called-Station-ID", "NAS-Port-Type", "NAS-Identifier", "User-Name", "Framed-IP-Address"] },
  { name: "Network",       attrs: ["Device Name", "Location", "Device Type"] },
];

export const OPERATORS = [
  { value: "equals",      label: "=" },
  { value: "notEquals",   label: "≠" },
  { value: "contains",    label: "indeholder" },
  { value: "notContains", label: "indeholder ikke" },
  { value: "startsWith",  label: "starter med" },
  { value: "endsWith",    label: "slutter med" },
  { value: "matches",     label: "matcher (regex)" },
];

export const KNOWN_PROFILES = [
  "PermitAccess", "DenyAccess", "Endpoint_VLAN", "Endpoint_AirSpaceACL",
  "Endpoint_PSK-KEY", "Permit_TEMP_ACCESS",
];

// ── Option HTML builders ──────────────────────────────────────────────────────

function dictionaryOptions(sel = "EndPoints") {
  return DICTIONARIES.map((d) =>
    `<option value="${d.name}"${d.name === sel ? " selected" : ""}>${esc(d.name)}</option>`
  ).join("");
}

function attrOptions(dictName, sel = "") {
  const d = DICTIONARIES.find((x) => x.name === dictName);
  return (d ? d.attrs : []).map((a) =>
    `<option value="${a}"${a === sel ? " selected" : ""}>${esc(a)}</option>`
  ).join("");
}

function operatorOptions(sel = "equals") {
  return OPERATORS.map((o) =>
    `<option value="${o.value}"${o.value === sel ? " selected" : ""}>${esc(o.label)}</option>`
  ).join("");
}

// ── Value widget ──────────────────────────────────────────────────────────────
// For EndPoints attributes with known caValues: select + optional free-text.
// For all others: plain text input.

export function valueWidgetHtml(idx, dict, attr, val, caValues) {
  if (dict === "EndPoints") {
    const known = caValues?.[attr];
    if (Array.isArray(known) && known.length) {
      const isKnown = known.includes(val);
      const showCustom = Boolean(val) && !isKnown;
      const selVal = showCustom ? "__custom__" : (val || "");
      const opts =
        `<option value="">— vælg —</option>` +
        known.map((v) => `<option value="${esc(v)}"${v === selVal ? " selected" : ""}>${esc(v)}</option>`).join("") +
        `<option value="__custom__"${showCustom ? " selected" : ""}>Andet…</option>`;
      return `<span class="cond-val-wrap" data-idx="${idx}">` +
        `<select class="cond-val-sel" data-idx="${idx}">${opts}</select>` +
        `<input class="cond-val-custom" data-idx="${idx}" type="text" value="${esc(showCustom ? val : "")}" placeholder="skriv…"${showCustom ? "" : ' style="display:none"'} />` +
        `</span>`;
    }
  }
  return `<span class="cond-val-wrap" data-idx="${idx}">` +
    `<input class="cond-val" data-idx="${idx}" type="text" value="${esc(val || "")}" placeholder="værdi" />` +
    `</span>`;
}

// ── Condition row HTML ────────────────────────────────────────────────────────
// Accepts both ISE format (dictionaryName/attributeName/operator/attributeValue)
// and editor format (dict/attr/op/val).

export function condRowHtml(idx, cond = {}, caValues = {}) {
  const dn = cond.dictionaryName || cond.dict || "EndPoints";
  const an = cond.attributeName  || cond.attr || "";
  const op = cond.operator       || cond.op   || "equals";
  const av = cond.attributeValue || cond.val  || "";
  return `
    <div class="cond-row" data-idx="${idx}">
      <select class="cond-dict" data-idx="${idx}">${dictionaryOptions(dn)}</select>
      <select class="cond-attr" data-idx="${idx}">${attrOptions(dn, an)}</select>
      <select class="cond-op"   data-idx="${idx}">${operatorOptions(op)}</select>
      ${valueWidgetHtml(idx, dn, an, av, caValues)}
      <button class="cond-del secondary small" data-idx="${idx}" type="button">✕</button>
    </div>`;
}

// ── Read rows ────────────────────────────────────────────────────────────────

export function readCondRows(editor) {
  return [...editor.querySelectorAll(".cond-row")].map((row) => {
    const valSel    = row.querySelector(".cond-val-sel");
    const valCustom = row.querySelector(".cond-val-custom");
    const valPlain  = row.querySelector(".cond-val");
    let val = "";
    if (valSel) {
      val = valSel.value === "__custom__"
        ? (valCustom?.value.trim() || "")
        : valSel.value;
    } else if (valPlain) {
      val = valPlain.value;
    }
    return {
      dict: row.querySelector(".cond-dict")?.value || "EndPoints",
      attr: row.querySelector(".cond-attr")?.value || "",
      op:   row.querySelector(".cond-op")?.value   || "equals",
      val,
    };
  });
}

// ── Wire up condition row events ──────────────────────────────────────────────
// Returns an addRow(cond) function for convenience.

export function wireCondRowEvents(rowsEl, caValues = {}) {
  let _idx = rowsEl.querySelectorAll(".cond-row").length;

  rowsEl.addEventListener("change", (e) => {
    const idx = e.target.dataset?.idx;
    if (!idx) return;
    const row = rowsEl.querySelector(`.cond-row[data-idx="${idx}"]`);
    if (!row) return;

    if (e.target.classList.contains("cond-dict")) {
      const newDict = e.target.value;
      const attrSel = row.querySelector(".cond-attr");
      if (attrSel) attrSel.innerHTML = attrOptions(newDict);
      const newAttr = row.querySelector(".cond-attr")?.value || "";
      const wrap = row.querySelector(".cond-val-wrap");
      if (wrap) wrap.outerHTML = valueWidgetHtml(idx, newDict, newAttr, "", caValues);
    }

    if (e.target.classList.contains("cond-attr")) {
      const dict    = row.querySelector(".cond-dict")?.value || "EndPoints";
      const newAttr = e.target.value;
      const wrap    = row.querySelector(".cond-val-wrap");
      if (wrap) wrap.outerHTML = valueWidgetHtml(idx, dict, newAttr, "", caValues);
    }

    if (e.target.classList.contains("cond-val-sel")) {
      const custom = row.querySelector(".cond-val-custom");
      if (custom) {
        const isCustom = e.target.value === "__custom__";
        custom.style.display = isCustom ? "" : "none";
        if (!isCustom) custom.value = "";
        if (isCustom) custom.focus();
      }
    }
  });

  rowsEl.addEventListener("click", (e) => {
    if (e.target.classList.contains("cond-del")) {
      e.target.closest(".cond-row")?.remove();
    }
  });

  return function addRow(cond = {}) {
    rowsEl.insertAdjacentHTML("beforeend", condRowHtml(_idx++, cond, caValues));
  };
}

// ── Build ISE condition object ────────────────────────────────────────────────

export function buildCondition(rows, blockType) {
  if (!rows.length) return null;
  const makeAttr = (r) => ({
    conditionType: "ConditionAttributes",
    isNegate: false,
    dictionaryName: r.dict,
    attributeName:  r.attr,
    operator:       r.op,
    attributeValue: r.val,
  });
  if (rows.length === 1) return makeAttr(rows[0]);
  return {
    conditionType: blockType === "OR" ? "ConditionOrBlock" : "ConditionAndBlock",
    isNegate: false,
    children: rows.map(makeAttr),
  };
}

// ── Flatten ISE condition tree → editor rows ──────────────────────────────────

export function flattenConditionToRows(cond) {
  if (!cond) return [];
  const ct = cond.conditionType;
  if (ct === "ConditionAttributes") {
    return [{
      dict: cond.dictionaryName || "EndPoints",
      attr: cond.attributeName  || "",
      op:   cond.operator       || "equals",
      val:  cond.attributeValue || "",
    }];
  }
  if (ct === "ConditionAndBlock" || ct === "ConditionOrBlock") {
    return (cond.children || []).flatMap((c) => flattenConditionToRows(c));
  }
  return [];
}

// ── Condition tree renderer (read-only view) ──────────────────────────────────

export function renderConditionTree(cond, depth = 0) {
  if (!cond) return "<em>ingen betingelse</em>";
  const ct     = cond.conditionType || "";
  const indent = depth * 12;
  const style  = `style="margin-left:${indent}px"`;

  if (ct === "ConditionReference") {
    return `<div class="cond-tree-ref" ${style}>[Ref: ${esc(cond.name || "")}]</div>`;
  }
  if (ct === "ConditionAttributes") {
    const neg = cond.isNegate ? "<span class='cond-neg'>IKKE</span> " : "";
    return `<div class="cond-tree-single" ${style}>${neg}` +
      `<span class="cond-dict-lbl">${esc(cond.dictionaryName)}</span>.` +
      `<span class="cond-attr-lbl">${esc(cond.attributeName)}</span> ` +
      `<span class="cond-op-lbl">${esc(cond.operator)}</span> ` +
      `<span class="cond-val-lbl">${esc(cond.attributeValue)}</span></div>`;
  }
  if (ct === "ConditionAndBlock" || ct === "ConditionOrBlock") {
    const sep      = ct === "ConditionAndBlock" ? "AND" : "OR";
    const children = (cond.children || [])
      .map((c) => renderConditionTree(c, depth + 1))
      .join(`<div class="cond-tree-sep" ${style}>— ${sep} —</div>`);
    return `<div class="cond-tree-block" ${style}>${children}</div>`;
  }
  return `<div ${style}>${esc(ct)}</div>`;
}

// ── Profile widget ────────────────────────────────────────────────────────────

export function profilesHtml(existing = [], knownProfiles = KNOWN_PROFILES) {
  const tags = existing.map((p) =>
    `<span class="profile-tag" data-p="${esc(p)}">${esc(p)}` +
    `<button type="button" class="profile-tag-del" data-p="${esc(p)}">✕</button></span>`
  ).join("");
  const opts = knownProfiles.map((p) => `<option value="${p}">${esc(p)}</option>`).join("");
  return `
    <div class="profiles-tags">${tags}</div>
    <div class="profiles-add-row">
      <select class="profile-preset"><option value="">+ vælg profil…</option>${opts}</select>
      <input type="text" class="profile-custom" placeholder="eller skriv navn…" />
      <button type="button" class="profile-add-btn secondary small">Tilføj</button>
    </div>`;
}

export function readProfiles(el) {
  return [...el.querySelectorAll(".profile-tag")].map((t) => t.dataset.p).filter(Boolean);
}

export function wireProfileEvents(el) {
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("profile-tag-del")) {
      e.target.closest(".profile-tag")?.remove();
    }
    if (e.target.classList.contains("profile-add-btn")) {
      const name =
        el.querySelector(".profile-preset")?.value ||
        el.querySelector(".profile-custom")?.value.trim();
      if (!name) return;
      el.querySelector(".profiles-tags").insertAdjacentHTML(
        "beforeend",
        `<span class="profile-tag" data-p="${esc(name)}">${esc(name)}` +
        `<button type="button" class="profile-tag-del" data-p="${esc(name)}">✕</button></span>`
      );
      const preset = el.querySelector(".profile-preset"); if (preset) preset.value = "";
      const custom = el.querySelector(".profile-custom"); if (custom) custom.value = "";
    }
  });
}
