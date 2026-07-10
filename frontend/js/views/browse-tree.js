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
  const groupBy = state.treeGroupBy;
  state._treeRows = rows;  // så expand-all kan materialisere alle gren-stier

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
      <button type="button" class="secondary small" id="tree-expand-all">${t("tree.expand_all")}</button>
      <button type="button" class="secondary small" id="tree-collapse-all">${t("tree.collapse_all")}</button>
    </div>
    <div class="tree-body">${
      groupBy.length
        ? (rows.length
            ? renderLevel(rows, groupBy, 0, "", state)
            : `<div class="hint tree-empty">${t("tree.no_rows")}</div>`)
        : `<div class="hint tree-empty">${t("tree.no_dims")}</div>`
    }</div>`;

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

function renderLevel(rows, groupBy, depth, pathPrefix, state) {
  const dimKey = groupBy[depth];
  const buckets = new Map();
  for (const r of rows) {
    const v = valueOf(r, dimKey) || NONE;
    let arr = buckets.get(v);
    if (!arr) { arr = []; buckets.set(v, arr); }
    arr.push(r);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === NONE) return 1;
    if (b === NONE) return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const isLast = depth === groupBy.length - 1;

  return keys.map((k) => {
    const label = k === NONE ? t("tree.none") : k;
    const nodePath = `${pathPrefix}//${depth}:${k}`;
    const childRows = buckets.get(k);
    const open = state.treeExpanded.has(nodePath);
    const children = open
      ? (isLast
          ? renderLeaves(childRows, state)
          : renderLevel(childRows, groupBy, depth + 1, nodePath, state))
      : "";
    return `
      <div class="tree-node" style="--depth:${depth}">
        <div class="tree-branch" data-path="${esc(nodePath)}">
          <span class="tree-caret">${open ? "▾" : "▸"}</span>
          <span class="tree-dim">${esc(dimLabel(dimKey))}:</span>
          <span class="tree-val">${esc(label)}</span>
          <span class="tree-count">${childRows.length}</span>
        </div>
        ${open ? `<div class="tree-children">${children}</div>` : ""}
      </div>`;
  }).join("");
}

// Saml alle gren-stier (ikke leaves) — bruges af "fold alt ud".
function collectPaths(rows, groupBy, depth, pathPrefix, out) {
  if (depth >= groupBy.length) return;
  const dimKey = groupBy[depth];
  const buckets = new Map();
  for (const r of rows) {
    const v = valueOf(r, dimKey) || NONE;
    let arr = buckets.get(v);
    if (!arr) { arr = []; buckets.set(v, arr); }
    arr.push(r);
  }
  for (const [k, childRows] of buckets) {
    const nodePath = `${pathPrefix}//${depth}:${k}`;
    out.add(nodePath);
    collectPaths(childRows, groupBy, depth + 1, nodePath, out);
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
  const shown = rows.slice(0, LEAF_CAP);

  const head = `<thead><tr>${
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
    return `<tr class="tree-leaf-row" data-id="${esc(r.id)}" title="${t("tree.open_edit")}">${tds}</tr>`;
  }).join("");

  const more = rows.length > LEAF_CAP
    ? `<tr><td class="tree-more" colspan="${cols.length || 1}">${t("tree.more").replace("{n}", rows.length - LEAF_CAP)}</td></tr>`
    : "";

  return `<table class="tree-leaf-table"><colgroup></colgroup>${head}<tbody>${body}${more}</tbody></table>`;
}

// ── Interaktion (delegeret, idempotent) ───────────────────────────────────────

function wire(container, ctx) {
  if (container._treeWired) return;
  container._treeWired = true;
  const state = ctx.state;

  container.addEventListener("click", (e) => {
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
      collectPaths(state._treeRows || [], state.treeGroupBy || [], 0, "", state.treeExpanded);
      ctx.rerender();
      return;
    }
    if (e.target.closest("#tree-collapse-all")) {
      state.treeExpanded.clear();
      ctx.rerender();
      return;
    }
  });

  // Luk add-menu ved klik udenfor.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tree-add-wrap")) {
      container.querySelector("#tree-add-menu")?.classList.add("hidden");
    }
  });
}
