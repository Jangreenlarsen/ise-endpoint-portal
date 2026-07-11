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
// Drag-and-drop state (same-page DnD → module-var er enklere end dataTransfer).
let _dragIds = null;
let _dragSourceGid = null;
let _dragBranchPath = null;  // sat når en HEL gren trækkes → søskende-sammenlægning
const NONE = "\uE000none";  // sentinel-nøgle for tom/manglende værdi

function dimLabel(key) {
  return DIM_BY_KEY[key]?.label?.() || key;
}

function valueOf(row, key) {
  const v = row[key];
  if (Array.isArray(v)) return v.length ? v.join(", ") : "";
  return (v == null ? "" : String(v)).trim();
}

// ── Sti-/merge-helpers ────────────────────────────────────────────────────────
const MERGE_SEP = "\u0001";  // intern join af sammenlagte værdier i én bucket-nøgle

function parentOf(path) {
  const i = path.lastIndexOf("//");
  return i < 0 ? "" : path.slice(0, i);
}
function valueOfPath(path) {
  const seg = path.slice(path.lastIndexOf("//") + 2);  // "depth:value"
  return seg.slice(seg.indexOf(":") + 1);
}
function mergeMembers(key) { return key.split(MERGE_SEP); }
function nodeLabel(key) {
  return mergeMembers(key).map((m) => (m === NONE ? t("tree.none") : m)).join(" + ");
}

// ── Layout-persistering (pr. bruger i backend) ────────────────────────────────
// Gemt: groupBy + per-gren-dim + sammenlægninger + skjulte grene. IKKE expand/selektion.

const DEFAULT_GROUPBY = ["group_name", "profiler_name"];

// Initialisér træets state — brug backend-seed hvis gyldig, ellers standard.
function initTreeState(state) {
  state.treeBranchDim = {};
  state.treeMerges = {};
  state.treeHidden = {};
  const seed = state.treeLayoutSeed;
  if (seed && typeof seed === "object") {
    if (Array.isArray(seed.groupBy)) state.treeGroupBy = seed.groupBy.filter((k) => DIM_BY_KEY[k]);
    if (seed.branchDim && typeof seed.branchDim === "object") {
      for (const [p, v] of Object.entries(seed.branchDim)) if (typeof v === "string") state.treeBranchDim[p] = v;
    }
    if (seed.merges && typeof seed.merges === "object") {
      for (const [p, groups] of Object.entries(seed.merges)) {
        if (Array.isArray(groups)) state.treeMerges[p] = groups.filter((g) => Array.isArray(g) && g.length >= 2);
      }
    }
    if (seed.hidden && typeof seed.hidden === "object") {
      for (const [p, vals] of Object.entries(seed.hidden)) if (Array.isArray(vals)) state.treeHidden[p] = vals.slice();
    }
  }
  if (!Array.isArray(state.treeGroupBy)) state.treeGroupBy = DEFAULT_GROUPBY.slice();
}

// Byg det normaliserede, serialiserbare layout (tomme grupper beskåret → stabil signatur).
function currentLayout(state) {
  const merges = {};
  for (const [p, groups] of Object.entries(state.treeMerges || {})) {
    const keep = (groups || []).filter((g) => Array.isArray(g) && g.length >= 2);
    if (keep.length) merges[p] = keep;
  }
  const hidden = {};
  for (const [p, vals] of Object.entries(state.treeHidden || {})) {
    if (Array.isArray(vals) && vals.length) hidden[p] = vals;
  }
  return {
    groupBy: state.treeGroupBy || [],
    branchDim: { ...(state.treeBranchDim || {}) },
    merges,
    hidden,
  };
}

let _saveTimer = null;

// Gem layoutet debounced — men kun når signaturen faktisk har ændret sig (så
// expand/selektion-rerenders ikke udløser skrivninger).
function persistLayoutIfChanged(state, ctx) {
  if (!ctx.saveLayout) return;
  const layout = currentLayout(state);
  const sig = JSON.stringify(layout);
  if (state._treeLayoutSig === undefined) { state._treeLayoutSig = sig; return; }  // første render seeder kun
  if (sig === state._treeLayoutSig) return;
  state._treeLayoutSig = sig;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => ctx.saveLayout(layout), 600);
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderTree(container, rows, ctx) {
  const state = ctx.state;
  // Første render: seed fra backend-gemt layout (pr. bruger) hvis til stede, ellers standard.
  if (!Array.isArray(state.treeGroupBy)) initTreeState(state);
  if (!(state.treeExpanded instanceof Set)) state.treeExpanded = new Set();
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
      ${(Object.keys(state.treeBranchDim).length || Object.keys(state.treeMerges).length || Object.keys(state.treeHidden).length)
        ? `<button type="button" class="secondary small" id="tree-reset-view" title="${t("tree.reset_view_title")}">${t("tree.reset_view")}</button>`
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
  persistLayoutIfChanged(state, ctx);  // gem layout pr. bruger når (og kun når) det har ændret sig

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

// Anvend visuel sammenlægning + skjulte grene på en Map(value→rows) for et parentPath.
function applyMergesHidden(buckets, path, state) {
  for (const members of state.treeMerges[path] || []) {
    const present = members.filter((m) => buckets.has(m));
    if (present.length < 2) continue;
    const key = [...present].sort((a, b) => a.localeCompare(b)).join(MERGE_SEP);
    const combined = [];
    for (const m of present) { combined.push(...buckets.get(m)); buckets.delete(m); }
    buckets.set(key, combined);
  }
  for (const h of state.treeHidden[path] || []) buckets.delete(h);
  return buckets;
}

// Sammenlæg to (evt. allerede sammenlagte) grenværdier under et parentPath til én gren.
// Folder overlappende eksisterende merge-grupper ind, så resultatet altid er disjunkt.
function mergeValues(state, parent, a, b) {
  const groups = state.treeMerges[parent] || (state.treeMerges[parent] = []);
  const union = new Set([...mergeMembers(a), ...mergeMembers(b)]);
  const keep = [];
  for (const g of groups) {
    if (g.some((m) => union.has(m))) g.forEach((m) => union.add(m));
    else keep.push(g);
  }
  keep.push([...union]);
  state.treeMerges[parent] = keep;
}

// "+"-kontrol efter en grens børn: vælg hvordan børnene grupperes (dropdown).
function addChildControl(path, childDepth, state) {
  const overridden = path in state.treeBranchDim;
  const items = [
    ...(overridden ? [`<div class="tree-add-item" data-setdim-path="${esc(path)}" data-setdim="__default__">${t("tree.sub_default")}</div>`] : []),
    `<div class="tree-add-item" data-setdim-path="${esc(path)}" data-setdim="__leaves__">${t("tree.sub_rows")}</div>`,
    ...DIMS.map((d) => `<div class="tree-add-item" data-setdim-path="${esc(path)}" data-setdim="${esc(d.key)}">${esc(d.label())}</div>`),
  ];
  return `<div class="tree-addchild" style="--depth:${childDepth}">
    <div class="tree-addchild-wrap">
      <button type="button" class="tree-addchild-btn" title="${t("tree.addchild_title")}">+ ${t("tree.addchild")}</button>
      <div class="tree-addchild-menu hidden">${items.join("")}</div>
    </div>
  </div>`;
}

function renderNodes(rows, path, depth, dim, state) {
  if (!dim) return renderLeaves(rows, state);
  const buckets = applyMergesHidden(bucketize(rows, dim), path, state);
  const sel = state.treeSelectedIds;
  return sortedKeys(buckets).map((k) => {
    const label = nodeLabel(k);
    const isMerged = k.includes(MERGE_SEP);
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
      ? renderNodes(childRows, nodePath, depth + 1, childDim, state) +
        addChildControl(nodePath, depth + 1, state)
      : "";
    // Ikke-merged group-grene (rigtigt group_id) er ISE-drop-mål (Fase 3).
    const gid = (dim === "group_name" && !isMerged) ? (childRows[0]?.group_id || "") : "";
    const dropAttrs = gid ? ` data-drop-gid="${esc(gid)}" data-drop-gname="${esc(label)}"` : "";
    return `
      <div class="tree-node" style="--depth:${depth}">
        <div class="tree-branch${overridden ? " tree-branch-custom" : ""}${isMerged ? " tree-branch-merged" : ""}" data-path="${esc(nodePath)}" draggable="true"${dropAttrs}>
          <input type="checkbox" class="tree-branch-cb" data-path="${esc(nodePath)}"
            ${allSel ? "checked" : ""} ${someSel ? 'data-indet="1"' : ""}
            title="${t("tree.select_branch")}" />
          <span class="tree-caret">${open ? "▾" : "▸"}</span>
          <span class="tree-dim">${esc(dimLabel(dim))}:</span>
          <span class="tree-val">${esc(label)}</span>
          <span class="tree-count">${childRows.length}</span>
          ${selCount ? `<span class="tree-sel-count" title="${t("tree.selected_n").replace("{n}", selCount)}">${selCount}✓</span>` : ""}
          ${overridden ? `<span class="tree-custom-badge" title="${t("tree.custom_badge_title")}">⚙</span>` : ""}
          <button type="button" class="tree-hide-branch" data-hide-branch="${esc(nodePath)}" title="${t("tree.delete_branch_title")}">✕</button>
        </div>
        ${open ? `<div class="tree-children">${children}</div>` : ""}
      </div>`;
  }).join("");
}

// Saml alle gren-stier (ikke leaves) — bruges af "fold alt ud". Følger per-gren-dims.
function collectPaths(rows, path, depth, state, out) {
  const dim = effectiveDim(path, depth, state);
  if (!dim) return;
  const buckets = applyMergesHidden(bucketize(rows, dim), path, state);
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
    return `<tr class="tree-leaf-row${sel.has(r.id) ? " tree-leaf-selected" : ""}" data-id="${esc(r.id)}" draggable="true" title="${t("tree.open_edit")}">${cbTd}${tds}</tr>`;
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
    // Slet (skjul) en gren fra visningen — ingen ISE-ændring.
    const hide = e.target.closest("[data-hide-branch]");
    if (hide) {
      e.stopPropagation();
      const np = hide.dataset.hideBranch;
      const parent = parentOf(np);
      const val = valueOfPath(np);
      const list = state.treeHidden[parent] || (state.treeHidden[parent] = []);
      if (!list.includes(val)) list.push(val);
      // ryd op i selektion + eventuel merge, der refererer denne gren
      (state._treeBranchIds[np] || []).forEach((id) => state.treeSelectedIds.delete(id));
      ctx.rerender();
      return;
    }
    // "+"-kontrol: åbn/luk dropdown med dimensioner for niveauet.
    const addBtn = e.target.closest(".tree-addchild-btn");
    if (addBtn) {
      const menu = addBtn.parentElement.querySelector(".tree-addchild-menu");
      const wasHidden = menu?.classList.contains("hidden");
      container.querySelectorAll(".tree-addchild-menu").forEach((m) => m.classList.add("hidden"));
      if (wasHidden) menu.classList.remove("hidden");
      return;
    }
    // Vælg dimension for en grens børn (per-gren-overstyring).
    const setdim = e.target.closest("[data-setdim-path]");
    if (setdim) {
      const p = setdim.dataset.setdimPath;
      const v = setdim.dataset.setdim;
      if (v === "__default__") delete state.treeBranchDim[p];
      else if (v === "__leaves__") state.treeBranchDim[p] = "";
      else state.treeBranchDim[p] = v;
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
    if (e.target.closest("#tree-reset-view")) {
      state.treeBranchDim = {};
      state.treeMerges = {};
      state.treeHidden = {};
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
  });

  // ── Drag-and-drop: træk en leaf eller en hel gren til en gruppe-gren ───────
  container.addEventListener("dragstart", (e) => {
    const branch = e.target.closest(".tree-branch");
    const leaf = e.target.closest(".tree-leaf-row");
    if (branch) {
      _dragIds = (state._treeBranchIds[branch.dataset.path] || []).slice();
      _dragSourceGid = branch.dataset.dropGid || null;  // group-gren → dens egen gid
      _dragBranchPath = branch.dataset.path;            // → søskende-sammenlægning
    } else if (leaf) {
      _dragIds = [leaf.dataset.id];
      _dragSourceGid = null;
      _dragBranchPath = null;
    } else { return; }
    if (!_dragIds.length) { _dragIds = null; return; }
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", _dragIds.join(",")); } catch { /* ignore */ }
  });

  // Søskende-merge-mål: en anden gren på SAMME niveau (samme parent) som den trukne gren.
  function siblingMergeTarget(e) {
    if (!_dragBranchPath) return null;
    const b = e.target.closest(".tree-branch");
    if (!b || b.dataset.path === _dragBranchPath) return null;
    if (parentOf(b.dataset.path) !== parentOf(_dragBranchPath)) return null;
    return b;
  }

  container.addEventListener("dragover", (e) => {
    if (!_dragIds || !_dragIds.length) return;
    // 1) Trækker vi en hel gren over en søskende? → visuel sammenlægning.
    const sib = siblingMergeTarget(e);
    if (sib) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      sib.classList.add("tree-drop-merge");
      return;
    }
    // 2) Ellers: leaf/gren → gruppe (ISE-flyt).
    const target = e.target.closest("[data-drop-gid]");
    if (!target) return;
    if (target.dataset.dropGid === _dragSourceGid) return;  // egen gruppe → ikke drop-mål
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    target.classList.add("tree-drop-target");
  });

  container.addEventListener("dragleave", (e) => {
    const b = e.target.closest(".tree-branch");
    if (b) b.classList.remove("tree-drop-merge");
    e.target.closest("[data-drop-gid]")?.classList.remove("tree-drop-target");
  });

  container.addEventListener("drop", async (e) => {
    if (!_dragIds || !_dragIds.length) return;
    // 1) Søskende-merge → visuel sammenlægning (ingen ISE-ændring).
    const sib = siblingMergeTarget(e);
    if (sib) {
      e.preventDefault();
      sib.classList.remove("tree-drop-merge");
      const parent = parentOf(_dragBranchPath);
      const a = valueOfPath(_dragBranchPath);
      const b = valueOfPath(sib.dataset.path);
      mergeValues(state, parent, a, b);
      _dragIds = null; _dragBranchPath = null;
      ctx.rerender();
      return;
    }
    // 2) Leaf/gren → gruppe (ISE-flyt).
    const target = e.target.closest("[data-drop-gid]");
    if (!target) { _dragIds = null; _dragBranchPath = null; return; }
    e.preventDefault();
    target.classList.remove("tree-drop-target");
    const gid = target.dataset.dropGid;
    const gname = target.dataset.dropGname || "";
    const ids = _dragIds.slice();
    _dragIds = null; _dragBranchPath = null;
    if (gid === _dragSourceGid || !ctx.moveToGroup) return;
    if (!confirm(t("tree.move_confirm").replace("{n}", ids.length).replace("{g}", gname))) return;
    await ctx.moveToGroup(ids, gid, gname);
  });

  container.addEventListener("dragend", () => {
    _dragIds = null; _dragBranchPath = null;
    container.querySelectorAll(".tree-drop-target").forEach((el) => el.classList.remove("tree-drop-target"));
    container.querySelectorAll(".tree-drop-merge").forEach((el) => el.classList.remove("tree-drop-merge"));
  });

  // Luk add-/dimensions-menuer ved klik udenfor.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tree-add-wrap")) {
      container.querySelector("#tree-add-menu")?.classList.add("hidden");
    }
    if (!e.target.closest(".tree-addchild-wrap")) {
      container.querySelectorAll(".tree-addchild-menu").forEach((m) => m.classList.add("hidden"));
    }
  });
}
