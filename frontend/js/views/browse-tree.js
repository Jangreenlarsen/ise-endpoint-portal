// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
//
// Alternativt "gruppetræ"-view til Browse: endpoints grupperet hierarkisk efter
// en fri, bruger-valgt stak af parametre. Rent client-side over de allerede
// indlæste rows — ingen ekstra ISE-kald. Genbruger detalje-draweren (openDetail)
// til redigering af den enkelte endpoint (leaf).
import { t } from "../i18n.js";
import { esc, getOrderedColumns, normalizeMac } from "./browse-utils.js";

// Grupperbare dimensioner — managed felter der findes på hver row.
const DIMS = [
  { key: "group_name",         label: () => t("tree.dim_group") },
  { key: "profiler_name",      label: () => t("tree.dim_profile") },
  { key: "platform_type",      label: () => t("tree.dim_platform") },
  { key: "endpoint_type",      label: () => t("tree.dim_type") },
  { key: "vendor",             label: () => t("tree.dim_vendor") },
  { key: "owner",              label: () => t("tree.dim_owner") },
  { key: "lokation",           label: () => t("tree.dim_location") },
  { key: "authz_vlan",         label: () => t("tree.dim_vlan") },
  { key: "authz_acl",          label: () => t("tree.dim_acl") },
  { key: "status",             label: () => t("tree.dim_status") },
  { key: "active_status",      label: () => t("tree.dim_active") },
  { key: "guest_registration", label: () => t("tree.dim_guest") },
  { key: "registret_by",       label: () => t("tree.dim_regby") },
  { key: "hypervision",        label: () => t("tree.dim_hv") },
];
const DIM_BY_KEY = Object.fromEntries(DIMS.map((d) => [d.key, d]));
const NONE = "\uE000none";  // sentinel-nøgle for tom/manglende værdi

function dimLabel(key) {
  return DIM_BY_KEY[key]?.label?.() || key;
}

function valueOf(row, key) {
  const v = row[key];
  if (Array.isArray(v)) return v.length ? v.join(", ") : "";
  return (v == null ? "" : String(v)).trim();
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderTree(container, rows, ctx) {
  const state = ctx.state;
  if (!Array.isArray(state.treeGroupBy)) state.treeGroupBy = ["group_name", "profiler_name"];
  if (!(state.treeExpanded instanceof Set)) state.treeExpanded = new Set();
  // Per-gren overstyring: nodePath → dimKey ("" = vis rækker, fraværende = arv standard).
  if (!state.treeBranchDim || typeof state.treeBranchDim !== "object") state.treeBranchDim = {};
  // Selektion (delt kilde med bulk-toolbaren via getSelectedIds).
  if (!(state.treeSelectedIds instanceof Set)) state.treeSelectedIds = new Set();
  const groupBy = state.treeGroupBy;
  state._treeRows = rows;   // så expand-all kan materialisere alle gren-stier
  state._treeBranchIds = {}; // path → [endpoint-ids] under grenen (fyldes i renderNodes)

  // Fjern selekterede IDs der ikke længere findes (fx efter bulk-slet/reload).
  const presentIds = new Set(rows.map((r) => r.id));
  for (const id of [...state.treeSelectedIds]) {
    if (!presentIds.has(id)) state.treeSelectedIds.delete(id);
  }

  container.innerHTML = `
    <div class="tree-toolbar">
      <span class="tree-groupby-label">${t("tree.group_by")}</span>
      <div class="tree-chips">${renderChips(groupBy)}</div>
      <div class="tree-add-wrap">
        <button type="button" class="secondary small" id="tree-add-btn"
          ${groupBy.length >= DIMS.length ? "disabled" : ""}>${t("tree.add_dim")}</button>
        <div class="tree-add-menu hidden" id="tree-add-menu">${renderAddMenu(groupBy)}</div>
      </div>
      <span class="spacer"></span>
      ${Object.keys(state.treeBranchDim).length
        ? `<button type="button" class="secondary small" id="tree-reset-branches" title="${t("tree.reset_branches_title")}">${t("tree.reset_branches")}</button>`
        : ""}
      <button type="button" class="secondary small" id="tree-expand-all">${t("tree.expand_all")}</button>
      <button type="button" class="secondary small" id="tree-collapse-all">${t("tree.collapse_all")}</button>
    </div>
    <div class="tree-body">${
      rows.length
        ? (effectiveDim("", 0, state)
            ? renderNodes(rows, "", 0, effectiveDim("", 0, state), state)
            : `<div class="hint tree-empty">${t("tree.no_dims")}</div>`)
        : `<div class="hint tree-empty">${t("tree.no_rows")}</div>`
    }</div>`;

  // Native indeterminate kan ikke sættes via HTML-attribut → sæt efter render.
  container.querySelectorAll('.tree-branch-cb[data-indet="1"]').forEach((el) => { el.indeterminate = true; });
  ctx.updateSelectionUI?.();  // hold bulk-toolbaren i sync med træets selektion

  wire(container, ctx);
}

function renderChips(groupBy) {
  if (!groupBy.length) return "";
  return groupBy.map((k, i) => `
    <span class="tree-chip">
      <span class="tree-chip-num">${i + 1}</span>
      ${esc(dimLabel(k))}
      <button type="button" class="tree-chip-del" data-del-dim="${esc(k)}" title="${t("tree.remove_dim")}">✕</button>
    </span>${i < groupBy.length - 1 ? '<span class="tree-chip-arrow">▸</span>' : ""}`).join("");
}

function renderAddMenu(groupBy) {
  const avail = DIMS.filter((d) => !groupBy.includes(d.key));
  if (!avail.length) return `<div class="tree-add-item hint">${t("tree.all_dims_used")}</div>`;
  return avail.map((d) =>
    `<div class="tree-add-item" data-add-dim="${esc(d.key)}">${esc(d.label())}</div>`
  ).join("");
}

// Effektiv dimension der grupperer en grens BØRN: per-gren-overstyring vinder over
// standard-stakken (treeGroupBy[depth]). "" = vis rækker (leaves). null = ingen.
function effectiveDim(path, depth, state) {
  const override = state.treeBranchDim ? state.treeBranchDim[path] : undefined;
  if (override !== undefined) return override || null;  // "" → null (leaves)
  return state.treeGroupBy[depth] || null;
}

function bucketize(rows, dim) {
  const buckets = new Map();
  for (const r of rows) {
    const v = valueOf(r, dim) || NONE;
    let arr = buckets.get(v);
    if (!arr) { arr = []; buckets.set(v, arr); }
    arr.push(r);
  }
  return buckets;
}

function sortedKeys(buckets) {
  return [...buckets.keys()].sort((a, b) => {
    if (a === NONE) return 1;
    if (b === NONE) return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

// Kompakt kontrol pr. åben gren: vælg hvordan DENNE grens børn grupperes.
function branchGroupControl(path, childDepth, state) {
  const defaultDim = state.treeGroupBy[childDepth] || null;
  const overridden = path in state.treeBranchDim;
  const cur = overridden ? (state.treeBranchDim[path] || "__leaves__") : "__default__";
  const defLabel = defaultDim ? esc(dimLabel(defaultDim)) : t("tree.rows");
  const opts = [
    `<option value="__default__"${cur === "__default__" ? " selected" : ""}>${t("tree.sub_default")} (${defLabel})</option>`,
    `<option value="__leaves__"${cur === "__leaves__" ? " selected" : ""}>${t("tree.sub_rows")}</option>`,
    ...DIMS.map((d) => `<option value="${esc(d.key)}"${cur === d.key ? " selected" : ""}>${esc(d.label())}</option>`),
  ];
  return `<div class="tree-subgroup" style="--depth:${childDepth}">
    <span class="tree-subgroup-lbl">${t("tree.subgroup_label")}</span>
    <select class="tree-subgroup-select" data-path="${esc(path)}">${opts.join("")}</select>
    ${overridden
      ? `<button type="button" class="tree-subgroup-clear" data-clear-path="${esc(path)}" title="${t("tree.clear_branch_title")}">✕ ${t("tree.clear_branch")}</button>`
      : ""}
  </div>`;
}

function renderNodes(rows, path, depth, dim, state) {
  if (!dim) return renderLeaves(rows, state);
  const buckets = bucketize(rows, dim);
  const sel = state.treeSelectedIds;
  return sortedKeys(buckets).map((k) => {
    const label = k === NONE ? t("tree.none") : k;
    const nodePath = `${path}//${depth}:${k}`;
    const childRows = buckets.get(k);
    const ids = childRows.map((r) => r.id);
    state._treeBranchIds[nodePath] = ids;  // til gren-select af hele undertræet
    const selCount = ids.reduce((n, id) => n + (sel.has(id) ? 1 : 0), 0);
    const allSel = selCount === ids.length && ids.length > 0;
    const someSel = selCount > 0 && !allSel;
    const open = state.treeExpanded.has(nodePath);
    const childDim = effectiveDim(nodePath, depth + 1, state);
    const overridden = nodePath in state.treeBranchDim;
    const children = open
      ? branchGroupControl(nodePath, depth + 1, state) +
        renderNodes(childRows, nodePath, depth + 1, childDim, state)
      : "";
    return `
      <div class="tree-node" style="--depth:${depth}">
        <div class="tree-branch${overridden ? " tree-branch-custom" : ""}" data-path="${esc(nodePath)}">
          <input type="checkbox" class="tree-branch-cb" data-path="${esc(nodePath)}"
            ${allSel ? "checked" : ""} ${someSel ? 'data-indet="1"' : ""}
            title="${t("tree.select_branch")}" />
          <span class="tree-caret">${open ? "▾" : "▸"}</span>
          <span class="tree-dim">${esc(dimLabel(dim))}:</span>
          <span class="tree-val">${esc(label)}</span>
          <span class="tree-count">${childRows.length}</span>
          ${selCount ? `<span class="tree-sel-count" title="${t("tree.selected_n").replace("{n}", selCount)}">${selCount}✓</span>` : ""}
          ${overridden ? `<span class="tree-custom-badge" title="${t("tree.custom_badge_title")}">⚙</span>` : ""}
        </div>
        ${open ? `<div class="tree-children">${children}</div>` : ""}
      </div>`;
  }).join("");
}

// Saml alle gren-stier (ikke leaves) — bruges af "fold alt ud". Følger per-gren-dims.
function collectPaths(rows, path, depth, state, out) {
  const dim = effectiveDim(path, depth, state);
  if (!dim) return;
  const buckets = bucketize(rows, dim);
  for (const [k, childRows] of buckets) {
    const nodePath = `${path}//${depth}:${k}`;
    out.add(nodePath);
    collectPaths(childRows, nodePath, depth + 1, state, out);
  }
}

const LEAF_CAP = 200;

// Synlige, ordnede kolonner MINUS dem der allerede er grupperet efter i træet.
function leafColumns(state) {
  const grouped = new Set(state.treeGroupBy || []);
  const colVis = state.colVis || {};
  return getOrderedColumns().filter(
    (c) => colVis[c.key] !== false && !grouped.has(c.key)
  );
}

// Live-session-MACs (samme kilde som tabellens applyAuthStatusColors) → farvning.
function liveSessionMacs(state) {
  return state.activeSessionMacs || (state.pxgridLive && state.pxgridSessionMacs) || null;
}

function leafBadges(r) {
  let b = "";
  if (r.status === "Decommissioned") b += `<span class="tree-badge decomm" title="${t("tree.decomm")}">⚰</span>`;
  if (r.active_status === "Inaktiv") b += `<span class="tree-badge inaktiv" title="${t("detail.active_status_inaktiv")}">⊘</span>`;
  else if (r.active_status === "Aktiv") b += `<span class="tree-badge aktiv" title="${t("detail.active_status_aktiv")}">✓</span>`;
  return b;
}

// Leaves render'es som en mini-tabel med SAMME synlige kolonner som tabel-viewet
// (minus de grupperede) + pxGrid-live-farve på MAC (samme td.mac-cell-CSS).
function renderLeaves(rows, state) {
  const cols = leafColumns(state);
  const live = liveSessionMacs(state);
  const sel = state.treeSelectedIds;
  const shown = rows.slice(0, LEAF_CAP);

  const head = `<thead><tr><th class="tree-leaf-cb-th"></th>${
    cols.map((c) => `<th${c.cls ? ` class="${c.cls}"` : ""}>${esc(c.label)}</th>`).join("")
  }</tr></thead>`;

  const body = shown.map((r) => {
    const mac = r.mac || r.name || "";
    const macCls = live ? (live.has(normalizeMac(mac)) ? " auth-active" : " auth-failed") : "";
    const tds = cols.map((c) => {
      if (c.key === "mac") {
        return `<td class="mac-cell${macCls}"><a class="mac-link">${esc(mac)}</a>${leafBadges(r)}</td>`;
      }
      let val = "";
      try { val = c.field ? c.field(r) : (r[c.key] ?? ""); } catch { val = ""; }
      return `<td${c.cls ? ` class="${c.cls}"` : ""}>${esc(String(val ?? ""))}</td>`;
    }).join("");
    const cbTd = `<td class="tree-leaf-cb-td"><input type="checkbox" class="tree-leaf-cb" data-id="${esc(r.id)}"${sel.has(r.id) ? " checked" : ""} /></td>`;
    return `<tr class="tree-leaf-row${sel.has(r.id) ? " tree-leaf-selected" : ""}" data-id="${esc(r.id)}" title="${t("tree.open_edit")}">${cbTd}${tds}</tr>`;
  }).join("");

  const more = rows.length > LEAF_CAP
    ? `<tr><td class="tree-more" colspan="${cols.length + 1}">${t("tree.more").replace("{n}", rows.length - LEAF_CAP)}</td></tr>`
    : "";

  return `<table class="tree-leaf-table"><colgroup></colgroup>${head}<tbody>${body}${more}</tbody></table>`;
}

// ── Interaktion (delegeret, idempotent) ───────────────────────────────────────

function wire(container, ctx) {
  if (container._treeWired) return;
  container._treeWired = true;
  const state = ctx.state;

  container.addEventListener("click", (e) => {
    // Checkboxe håndteres af change-listener — lad ikke klik toggle gren/leaf.
    if (e.target.matches(".tree-branch-cb, .tree-leaf-cb")) return;
    if (e.target.closest("#tree-add-btn")) {
      container.querySelector("#tree-add-menu")?.classList.toggle("hidden");
      return;
    }
    const add = e.target.closest("[data-add-dim]");
    if (add) {
      if (!state.treeGroupBy.includes(add.dataset.addDim)) {
        state.treeGroupBy = [...state.treeGroupBy, add.dataset.addDim];
      }
      ctx.rerender();
      return;
    }
    const del = e.target.closest("[data-del-dim]");
    if (del) {
      state.treeGroupBy = state.treeGroupBy.filter((d) => d !== del.dataset.delDim);
      ctx.rerender();
      return;
    }
    const branch = e.target.closest(".tree-branch");
    if (branch) {
      const p = branch.dataset.path;
      if (state.treeExpanded.has(p)) state.treeExpanded.delete(p);
      else state.treeExpanded.add(p);
      ctx.rerender();
      return;
    }
    const leaf = e.target.closest(".tree-leaf-row");
    if (leaf) {
      ctx.openDetail(leaf.dataset.id);
      return;
    }
    if (e.target.closest("#tree-expand-all")) {
      collectPaths(state._treeRows || [], "", 0, state, state.treeExpanded);
      ctx.rerender();
      return;
    }
    if (e.target.closest("#tree-collapse-all")) {
      state.treeExpanded.clear();
      ctx.rerender();
      return;
    }
    if (e.target.closest("#tree-reset-branches")) {
      state.treeBranchDim = {};
      ctx.rerender();
      return;
    }
    const clear = e.target.closest("[data-clear-path]");
    if (clear) {
      delete state.treeBranchDim[clear.dataset.clearPath];
      ctx.rerender();
      return;
    }
  });

  container.addEventListener("change", (e) => {
    // Gren-checkbox: vælg/fravælg alle endpoints under grenen (hele undertræet).
    const branchCb = e.target.closest(".tree-branch-cb");
    if (branchCb) {
      const ids = state._treeBranchIds[branchCb.dataset.path] || [];
      if (branchCb.checked) ids.forEach((id) => state.treeSelectedIds.add(id));
      else ids.forEach((id) => state.treeSelectedIds.delete(id));
      ctx.rerender();  // renderTree opdaterer også bulk-toolbaren
      return;
    }
    // Enkelt endpoint-checkbox.
    const leafCb = e.target.closest(".tree-leaf-cb");
    if (leafCb) {
      if (leafCb.checked) state.treeSelectedIds.add(leafCb.dataset.id);
      else state.treeSelectedIds.delete(leafCb.dataset.id);
      ctx.rerender();
      return;
    }
    // Per-gren undergruppering: vælg dimension for en grens børn.
    const sel = e.target.closest(".tree-subgroup-select");
    if (!sel) return;
    const p = sel.dataset.path;
    const v = sel.value;
    if (v === "__default__") delete state.treeBranchDim[p];
    else if (v === "__leaves__") state.treeBranchDim[p] = "";
    else state.treeBranchDim[p] = v;
    ctx.rerender();
  });

  // Luk add-menu ved klik udenfor.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tree-add-wrap")) {
      container.querySelector("#tree-add-menu")?.classList.add("hidden");
    }
  });
}
