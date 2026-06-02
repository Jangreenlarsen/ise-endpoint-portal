// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Shared condition builder for RADIUS policy editor and rule wizard.
// Supports nested AND/OR groups matching ISE's ConditionAndBlock/ConditionOrBlock structure.

import { t } from "../i18n.js";
import { esc } from "./browse-utils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const IDENTITY_GROUP_PREFIX = "Endpoint Identity Groups:";

function normalizeIdentityGroupValue(dict, attr, val) {
  if (dict !== "IdentityGroup" || attr !== "Name") return val;
  if (!val || val.startsWith(IDENTITY_GROUP_PREFIX)) return val;
  return IDENTITY_GROUP_PREFIX + val;
}

// ── Static metadata ───────────────────────────────────────────────────────────

export const DICTIONARIES = [
  { name: "EndPoints",     attrs: ["Owner", "Type", "Lokation", "AuthzVlan", "AuthzACL", "PlatformType", "PSK_Mode", "Description", "HypervisionActive", "HypervisionStatus"] },
  { name: "IdentityGroup", attrs: ["Name"] },
  { name: "Radius",        attrs: ["Called-Station-ID", "NAS-Port-Type", "NAS-Identifier", "User-Name", "Framed-IP-Address"] },
];

export function OPERATORS() {
  return [
    { value: "equals",      label: t("pol.cb_op_eq") },
    { value: "notEquals",   label: t("pol.cb_op_neq") },
    { value: "contains",    label: t("pol.cb_op_contains") },
    { value: "notContains", label: t("pol.cb_op_notcontains") },
    { value: "startsWith",  label: t("pol.cb_op_startswith") },
    { value: "endsWith",    label: t("pol.cb_op_endswith") },
    { value: "matches",     label: t("pol.cb_op_matches") },
  ];
}

export const KNOWN_PROFILES = [
  "PermitAccess", "DenyAccess", "Endpoint_VLAN", "Endpoint_DACL",
  "Endpoint_AirSpaceACL", "Endpoint_PSK-KEY", "Permit_TEMP_ACCESS",
];

// ── Internal option HTML builders ─────────────────────────────────────────────

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
  return OPERATORS().map((o) =>
    `<option value="${o.value}"${o.value === sel ? " selected" : ""}>${esc(o.label)}</option>`
  ).join("");
}

// ── Value widget ──────────────────────────────────────────────────────────────

export function valueWidgetHtml(idx, dict, attr, val, caValues) {
  let known = null;
  if (dict === "EndPoints") {
    known = caValues?.[attr];
  } else {
    known = caValues?.[`__${dict}_${attr}__`];
  }
  if (Array.isArray(known) && known.length) {
    // IdentityGroup:Name — hierarchical optgroups mirroring ISE group tree
    if (dict === "IdentityGroup" && attr === "Name") {
      const PREFIX  = IDENTITY_GROUP_PREFIX;
      const items   = known.filter((v) => v.startsWith(PREFIX)).sort();
      const outside = known.filter((v) => !v.startsWith(PREFIX));

      // level1: direct children ("EIG:X"), deeper: "EIG:X:Y" etc.
      const level1  = items.filter((v) => !v.slice(PREFIX.length).includes(":"));
      const deeper  = items.filter((v) =>  v.slice(PREFIX.length).includes(":"));

      // Group deeper values by immediate parent full-path
      const byParent = new Map();
      for (const v of deeper) {
        const parts     = v.split(":");
        const parentKey = parts.slice(0, -1).join(":");
        if (!byParent.has(parentKey)) byParent.set(parentKey, []);
        byParent.get(parentKey).push(v);
      }

      const selAttr = (v) => v === val ? " selected" : "";

      let opts = `<option value="">${t("pol.cb_select_val")}</option>`;

      // Root optgroup
      opts += `<optgroup label="${esc(PREFIX.slice(0, -1))}">`;
      for (const v of level1) {
        opts += `<option value="${esc(v)}"${selAttr(v)}>${esc(v.slice(PREFIX.length))}</option>`;
      }
      opts += `</optgroup>`;

      // Sub-optgroups (one per parent with children)
      for (const [parentPath, children] of [...byParent.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const parentLabel = "↳ " + (parentPath.startsWith(PREFIX) ? parentPath.slice(PREFIX.length) : parentPath);
        opts += `<optgroup label="${esc(parentLabel)}">`;
        for (const v of children) {
          const display = v.split(":").pop();
          opts += `<option value="${esc(v)}"${selAttr(v)}>${esc(display)}</option>`;
        }
        opts += `</optgroup>`;
      }

      // Values without the standard prefix (edge cases)
      for (const v of outside) {
        opts += `<option value="${esc(v)}"${selAttr(v)}>${esc(v)}</option>`;
      }

      return `<span class="cond-val-wrap" data-idx="${idx}">` +
        `<select class="cond-val-sel" data-idx="${idx}">${opts}</select>` +
        `</span>`;
    }
    const isKnown    = known.includes(val);
    const showCustom = Boolean(val) && !isKnown;
    const selVal     = showCustom ? "__custom__" : (val || "");
    const opts =
      `<option value="">${t("pol.cb_select_val")}</option>` +
      known.map((v) => `<option value="${esc(v)}"${v === selVal ? " selected" : ""}>${esc(v)}</option>`).join("") +
      `<option value="__custom__"${showCustom ? " selected" : ""}>${t("pol.cb_other")}</option>`;
    return `<span class="cond-val-wrap" data-idx="${idx}">` +
      `<select class="cond-val-sel" data-idx="${idx}">${opts}</select>` +
      `<input class="cond-val-custom" data-idx="${idx}" type="text" value="${esc(showCustom ? val : "")}" placeholder="${t("pol.cb_val_ph")}"${showCustom ? "" : ' style="display:none"'} />` +
      `</span>`;
  }
  return `<span class="cond-val-wrap" data-idx="${idx}">` +
    `<input class="cond-val" data-idx="${idx}" type="text" value="${esc(val || "")}" placeholder="${t("pol.cb_val_ph")}" />` +
    `</span>`;
}

// ── Condition row HTML ────────────────────────────────────────────────────────

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

// ── Read rows (flat — used by browse-detail wizard legacy path) ───────────────

export function readCondRows(editor) {
  return [...editor.querySelectorAll(".cond-row")].map((row) => {
    const valSel    = row.querySelector(".cond-val-sel");
    const valCustom = row.querySelector(".cond-val-custom");
    const valPlain  = row.querySelector(".cond-val");
    let val = "";
    if (valSel) {
      val = valSel.value === "__custom__" ? (valCustom?.value.trim() || "") : valSel.value;
    } else if (valPlain) {
      val = valPlain.value;
    }
    const dict = row.querySelector(".cond-dict")?.value || "EndPoints";
    const attr = row.querySelector(".cond-attr")?.value || "";
    return {
      dict,
      attr,
      op: row.querySelector(".cond-op")?.value || "equals",
      val: normalizeIdentityGroupValue(dict, attr, val),
    };
  });
}

// ── Wire condition row events (flat — backward compat) ────────────────────────

export function wireCondRowEvents(rowsEl, caValues = {}) {
  let _idx = rowsEl.querySelectorAll(".cond-row").length;
  _bindRowChangeEvents(rowsEl, caValues);
  rowsEl.addEventListener("click", (e) => {
    if (e.target.classList.contains("cond-del")) {
      e.target.closest(".cond-row")?.remove();
    }
  });
  return function addRow(cond = {}) {
    rowsEl.insertAdjacentHTML("beforeend", condRowHtml(_idx++, cond, caValues));
  };
}

// ── Build ISE condition (flat — backward compat) ──────────────────────────────

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

// ── Flatten ISE condition tree → editor rows (backward compat) ────────────────

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

// ═══════════════════════════════════════════════════════════════════════════════
// ── Nested Group Editor ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Renders a recursive AND/OR group editor that preserves ISE's nesting.
// Usage:
//   container.innerHTML = `...<div id="cond-editor">${groupEditorHtml(rule.condition, caValues)}</div>`;
//   wireGroupEditor(container.querySelector("#cond-editor"), caValues);
//   const cond = readGroupCondition(container.querySelector("#cond-editor"));

let _gid = 0;  // global counter for unique data-idx across all rendered rows

export function groupEditorHtml(condition, caValues) {
  _gid = 0;
  return _groupHtml(condition, caValues, 0);
}

function _defaultCond() {
  return { conditionType: "ConditionAttributes", dictionaryName: "EndPoints", attributeName: "Owner", operator: "equals", attributeValue: "" };
}

function _groupHtml(cond, caValues, depth) {
  let type = "AND";
  let children = [];

  const ct = cond?.conditionType;
  if (!cond || (!ct)) {
    children = [_defaultCond()];
  } else if (ct === "ConditionAndBlock") {
    type = "AND";
    children = cond.children?.length ? cond.children : [_defaultCond()];
  } else if (ct === "ConditionOrBlock") {
    type = "OR";
    children = cond.children?.length ? cond.children : [_defaultCond()];
  } else if (ct === "ConditionAttributes") {
    // Single condition at root — wrap in AND
    type = "AND";
    children = [cond];
  } else {
    children = [_defaultCond()];
  }

  const delBtn = depth > 0
    ? `<button class="cond-group-del danger small" type="button" title="${t("pol.ed_del_group")}">✕</button>`
    : "";
  const dragHandle = depth > 0
    ? `<span class="cond-drag-handle" draggable="true" title="${t("pol.drag_handle_title")}">⠿</span>`
    : "";

  const childrenHtml = children.map((child) => {
    const cct = child?.conditionType;
    if (cct === "ConditionAndBlock" || cct === "ConditionOrBlock") {
      return _groupHtml(child, caValues, depth + 1);
    }
    return _rowHtml(child, caValues);
  }).join("");

  return `
    <div class="cond-group${depth === 0 ? " cond-group-root" : ""}" data-depth="${depth}">
      <div class="cond-group-header">
        ${dragHandle}
        <select class="cond-group-type">
          <option value="AND"${type === "AND" ? " selected" : ""}>AND</option>
          <option value="OR"${type === "OR" ? " selected" : ""}>OR</option>
        </select>
        <span class="cond-group-type-hint">${type === "AND" ? t("pol.ed_logic_and") : t("pol.ed_logic_or")}</span>
        ${delBtn}
      </div>
      <div class="cond-group-children">
        ${childrenHtml}
      </div>
      <div class="cond-group-footer">
        <button class="cond-add-row secondary small" type="button">+ ${t("pol.ed_add_cond")}</button>
        <button class="cond-add-group secondary small" type="button">+ ${t("pol.ed_add_group")}</button>
      </div>
    </div>`;
}

function _rowHtml(cond, caValues) {
  const idx = _gid++;
  const dn = cond?.dictionaryName || "EndPoints";
  const an = cond?.attributeName  || "";
  const op = cond?.operator       || "equals";
  const av = cond?.attributeValue || "";
  return `
    <div class="cond-row" data-idx="${idx}">
      <span class="cond-drag-handle" draggable="true" title="${t("pol.drag_handle_title")}">⠿</span>
      <select class="cond-dict" data-idx="${idx}">${dictionaryOptions(dn)}</select>
      <select class="cond-attr" data-idx="${idx}">${attrOptions(dn, an)}</select>
      <select class="cond-op"   data-idx="${idx}">${operatorOptions(op)}</select>
      ${valueWidgetHtml(idx, dn, an, av, caValues)}
      <button class="cond-del secondary small" data-idx="${idx}" type="button">✕</button>
    </div>`;
}

// ── Drag-and-drop reordering ───────────────────────────────────────────────────

function _wireDragDrop(rootEl, caValues) {
  let dragEl    = null;  // the .cond-row or .cond-group being moved
  let dropEl    = null;  // current indicator target
  let dropBefore = false;

  function _dropTarget(el) {
    // Walk up from el to find a direct child of a .cond-group-children container
    let n = el;
    while (n && n !== rootEl) {
      if (
        (n.classList.contains("cond-row") || n.classList.contains("cond-group")) &&
        n.parentElement?.classList.contains("cond-group-children")
      ) return n;
      n = n.parentElement;
    }
    return null;
  }

  function _clearIndicators() {
    rootEl.querySelectorAll(".cond-drop-before, .cond-drop-after").forEach((el) => {
      el.classList.remove("cond-drop-before", "cond-drop-after");
    });
    dropEl = null;
  }

  // dragstart fires on the handle span (which carries draggable="true")
  rootEl.addEventListener("dragstart", (e) => {
    if (!e.target.classList.contains("cond-drag-handle")) return;
    const el = _dropTarget(e.target);
    if (!el) { e.preventDefault(); return; }
    dragEl = el;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    requestAnimationFrame(() => dragEl?.classList.add("cond-dragging"));
  });

  rootEl.addEventListener("dragend", () => {
    dragEl?.classList.remove("cond-dragging");
    _clearIndicators();
    dragEl = null;
  });

  rootEl.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    const target = _dropTarget(e.target);
    if (!target || target === dragEl || dragEl.contains(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = target.getBoundingClientRect();
    dropBefore = e.clientY < rect.top + rect.height / 2;
    if (target !== dropEl || target.classList.contains("cond-drop-before") !== dropBefore) {
      _clearIndicators();
      target.classList.add(dropBefore ? "cond-drop-before" : "cond-drop-after");
      dropEl = target;
    }
  });

  rootEl.addEventListener("drop", (e) => {
    if (!dragEl || !dropEl) return;
    e.preventDefault();
    const parent = dropEl.parentElement;
    if (!parent) return;
    if (dropBefore) parent.insertBefore(dragEl, dropEl);
    else dropEl.after(dragEl);
    _clearIndicators();
    _bindRowChangeEvents(rootEl, caValues);
    dragEl = null;
  });
}

// ── Wire group editor events ───────────────────────────────────────────────────

export function wireGroupEditor(rootEl, caValues = {}) {
  _bindRowChangeEvents(rootEl, caValues);
  _wireDragDrop(rootEl, caValues);

  rootEl.addEventListener("click", (e) => {
    // Add condition row to nearest group
    if (e.target.classList.contains("cond-add-row")) {
      e.stopPropagation();
      const group    = e.target.closest(".cond-group");
      const children = group?.querySelector(":scope > .cond-group-children");
      if (children) {
        children.insertAdjacentHTML("beforeend", _rowHtml(_defaultCond(), caValues));
        // Rebind change events for newly added row
        _bindRowChangeEvents(rootEl, caValues);
      }
      return;
    }

    // Add sub-group to nearest group
    if (e.target.classList.contains("cond-add-group")) {
      e.stopPropagation();
      const group    = e.target.closest(".cond-group");
      const children = group?.querySelector(":scope > .cond-group-children");
      const depth    = parseInt(group?.dataset.depth ?? "0") + 1;
      if (children) {
        _gid = Math.max(_gid, rootEl.querySelectorAll(".cond-row").length + 100);
        const newGroupHtml = _groupHtml(null, caValues, depth);
        children.insertAdjacentHTML("beforeend", newGroupHtml);
        _bindRowChangeEvents(rootEl, caValues);
      }
      return;
    }

    // Delete condition row
    if (e.target.classList.contains("cond-del")) {
      e.target.closest(".cond-row")?.remove();
      return;
    }

    // Delete group
    if (e.target.classList.contains("cond-group-del")) {
      e.target.closest(".cond-group")?.remove();
      return;
    }
  });

  // Update hint label when AND/OR type changes
  rootEl.addEventListener("change", (e) => {
    if (e.target.classList.contains("cond-group-type")) {
      const header = e.target.closest(".cond-group-header");
      const hint   = header?.querySelector(".cond-group-type-hint");
      if (hint) {
        hint.textContent = e.target.value === "AND" ? t("pol.ed_logic_and") : t("pol.ed_logic_or");
      }
    }
  });
}

// ── Read group editor → ISE condition ─────────────────────────────────────────

export function readGroupCondition(rootEl) {
  const groupEl = rootEl.classList.contains("cond-group")
    ? rootEl
    : rootEl.querySelector(".cond-group");
  if (!groupEl) return null;
  return _readGroup(groupEl);
}

function _readGroup(groupEl) {
  const type        = groupEl.querySelector(":scope > .cond-group-header > .cond-group-type")?.value || "AND";
  const childrenEl  = groupEl.querySelector(":scope > .cond-group-children");
  if (!childrenEl) return null;

  const children = [];
  for (const child of childrenEl.children) {
    if (child.classList.contains("cond-row")) {
      const c = _readRow(child);
      if (c) children.push(c);
    } else if (child.classList.contains("cond-group")) {
      const g = _readGroup(child);
      if (g) children.push(g);
    }
  }
  if (!children.length) return null;
  if (children.length === 1 && children[0].conditionType !== "ConditionAndBlock" && children[0].conditionType !== "ConditionOrBlock") {
    return children[0];
  }
  return {
    conditionType: type === "OR" ? "ConditionOrBlock" : "ConditionAndBlock",
    isNegate: false,
    children,
  };
}

function _readRow(rowEl) {
  const dict = rowEl.querySelector(".cond-dict")?.value || "EndPoints";
  const attr = rowEl.querySelector(".cond-attr")?.value || "";
  const op   = rowEl.querySelector(".cond-op")?.value   || "equals";
  const valSel    = rowEl.querySelector(".cond-val-sel");
  const valCustom = rowEl.querySelector(".cond-val-custom");
  const valPlain  = rowEl.querySelector(".cond-val");
  let val = "";
  if (valSel)       val = valSel.value === "__custom__" ? (valCustom?.value.trim() || "") : valSel.value;
  else if (valPlain) val = valPlain.value;
  return { conditionType: "ConditionAttributes", isNegate: false, dictionaryName: dict, attributeName: attr, operator: op, attributeValue: normalizeIdentityGroupValue(dict, attr, val) };
}

// ── Shared: bind row-level change events (dict/attr/val-sel changes) ──────────

function _bindRowChangeEvents(el, caValues) {
  // Remove and re-add to avoid duplicates — use a flag on the element
  if (el._rowChangeBound) {
    el.removeEventListener("change", el._rowChangeHandler);
    el.removeEventListener("blur",   el._rowBlurHandler, true);
  }
  el._rowChangeHandler = (e) => {
    const idx = e.target.dataset?.idx;
    if (!idx) return;
    const row = el.querySelector(`.cond-row[data-idx="${idx}"]`);
    if (!row) return;

    if (e.target.classList.contains("cond-dict")) {
      const newDict = e.target.value;
      row.querySelector(".cond-attr").innerHTML = attrOptions(newDict);
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
      const custom  = row.querySelector(".cond-val-custom");
      if (custom) {
        const isCustom = e.target.value === "__custom__";
        custom.style.display = isCustom ? "" : "none";
        if (!isCustom) custom.value = "";
        if (isCustom)  custom.focus();
      }
    }
  };
  // Auto-prefix IdentityGroup:Name value on blur so user sees the full path
  el._rowBlurHandler = (e) => {
    const input = e.target;
    if (!input.classList.contains("cond-val") && !input.classList.contains("cond-val-custom")) return;
    const idx = input.dataset?.idx;
    if (!idx) return;
    const row  = el.querySelector(`.cond-row[data-idx="${idx}"]`);
    if (!row) return;
    const dict = row.querySelector(".cond-dict")?.value || "";
    const attr = row.querySelector(".cond-attr")?.value || "";
    const normalized = normalizeIdentityGroupValue(dict, attr, input.value);
    if (normalized !== input.value) input.value = normalized;
  };
  el.addEventListener("change", el._rowChangeHandler);
  el.addEventListener("blur",   el._rowBlurHandler, true);
  el._rowChangeBound = true;
}

// ── Condition chips (compact visual summary) ──────────────────────────────────

export function renderConditionChips(cond, depth = 0) {
  if (!cond) return `<span class="cond-chip cond-chip-empty">${t("pol.no_condition")}</span>`;
  const ct = cond.conditionType || "";

  if (ct === "ConditionReference") {
    return `<span class="cond-chip cond-chip-ref">${t("pol.cond_ref").replace("{name}", esc(cond.name || ""))}</span>`;
  }
  if (ct === "ConditionAttributes") {
    const neg   = cond.isNegate ? "NOT " : "";
    const opLbl = OPERATORS().find((o) => o.value === cond.operator)?.label || esc(cond.operator || "");
    return `<span class="cond-chip">${neg}${esc(cond.dictionaryName)}<span class="cond-chip-dot">:</span>${esc(cond.attributeName)} <span class="cond-chip-op">${opLbl}</span> <span class="cond-chip-val">${esc(cond.attributeValue)}</span></span>`;
  }
  if (ct === "ConditionAndBlock" || ct === "ConditionOrBlock") {
    const sep      = ct === "ConditionAndBlock" ? "AND" : "OR";
    const sep_html = `<span class="cond-chip-sep">${sep}</span>`;
    return (cond.children || []).map((c) => renderConditionChips(c, depth + 1)).join(sep_html);
  }
  return `<span class="cond-chip cond-chip-ref">${esc(ct)}</span>`;
}

// ── Condition tree renderer (read-only) ───────────────────────────────────────

export function renderConditionTree(cond, depth = 0) {
  if (!cond) return `<em>${t("pol.no_condition")}</em>`;
  const ct     = cond.conditionType || "";
  const indent = depth * 12;
  const style  = `style="margin-left:${indent}px"`;

  if (ct === "ConditionReference") {
    return `<div class="cond-tree-ref" ${style}>${t("pol.cond_ref").replace("{name}", esc(cond.name || ""))}</div>`;
  }
  if (ct === "ConditionAttributes") {
    const neg   = cond.isNegate ? "<span class='cond-neg'>NOT</span> " : "";
    const opLbl = OPERATORS().find((o) => o.value === cond.operator)?.label || esc(cond.operator || "");
    return `<div class="cond-tree-single" ${style}>${neg}` +
      `<span class="cond-dict-lbl">${esc(cond.dictionaryName)}</span>.` +
      `<span class="cond-attr-lbl">${esc(cond.attributeName)}</span> ` +
      `<span class="cond-op-lbl">${opLbl}</span> ` +
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
      <select class="profile-preset"><option value="">${t("pol.cb_profile_sel")}</option>${opts}</select>
      <input type="text" class="profile-custom" placeholder="${t("pol.cb_profile_ph")}" />
      <button type="button" class="profile-add-btn secondary small">${t("pol.cb_profile_add")}</button>
    </div>`;
}

export function readProfiles(el) {
  return [...el.querySelectorAll(".profile-tag")].map((t) => t.dataset.p).filter(Boolean);
}

export function wireProfileEvents(el, onChange = null) {
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("profile-tag-del")) {
      e.target.closest(".profile-tag")?.remove();
      onChange?.();
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
      onChange?.();
    }
  });
}
