// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Filter-toolbar + saved views logic for Browse.
// initFilter wires all filter-related DOM events and returns its public API.
// Cross-module calls go via the `cb` object (populated in browse.js after all inits).

import { t } from "../i18n.js";
import {
  getColumns, esc,
  endpointCreateTime,
  normalizeMac,
  loadBrowseFilters, saveBrowseFilters,
  loadColVis, saveColVis,
  savePageSize,
  loadMarkedMacs,
} from "./browse-utils.js";

export function initFilter(container, state, api, cb) {
  const filterRow          = container.querySelector(".filter-row");
  const portalFilterBtn    = container.querySelector("#portal-filter-btn");
  const pageSizeSelect     = container.querySelector("#page-size-select");
  const viewsBtn           = container.querySelector("#views-btn");
  const viewsMenu          = container.querySelector("#views-menu");
  const msg                = container.querySelector("#msg");
  const filterClearAllBtn  = container.querySelector("#filter-clear-all-btn");
  const authStatusSelect   = container.querySelector("#auth-status-filter");
  const globalQInput       = container.querySelector("#global-q-input");
  function _fsDateTimeVal(dateId, timeId, defaultTime) {
    const d = container.querySelector(dateId)?.value;
    if (!d) return "";
    const raw = (container.querySelector(timeId)?.value || "").trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    const t = m
      ? `${String(Math.min(23, +m[1])).padStart(2, "0")}:${String(Math.min(59, +m[2])).padStart(2, "0")}`
      : defaultTime;
    return `${d}T${t}`;
  }
  const firstSeenFromVal = () => _fsDateTimeVal("#first-seen-from-d", "#first-seen-from-t", "00:00");
  const firstSeenToVal   = () => _fsDateTimeVal("#first-seen-to-d",   "#first-seen-to-t",   "23:59");
  function firstSeenAnySet() {
    return !!(container.querySelector("#first-seen-from-d")?.value
           || container.querySelector("#first-seen-to-d")?.value);
  }
  function firstSeenClearAll() {
    ["#first-seen-from-d", "#first-seen-from-t", "#first-seen-to-d", "#first-seen-to-t"]
      .forEach((id) => { const el = container.querySelector(id); if (el) el.value = ""; });
  }
  function firstSeenRestore(fromVal, toVal) {
    const fp = (fromVal || "").split("T");
    const tp = (toVal   || "").split("T");
    const fd = container.querySelector("#first-seen-from-d");
    const ft = container.querySelector("#first-seen-from-t");
    const td = container.querySelector("#first-seen-to-d");
    const tt = container.querySelector("#first-seen-to-t");
    if (fd) fd.value = fp[0] || "";
    if (ft) ft.value = fp[1] || "";
    if (td) td.value = tp[0] || "";
    if (tt) tt.value = tp[1] || "";
  }

  state.fullTextQ = "";

  function updateClearBtn() {
    const anyActive = state.portalOnly
      || Array.from(filterRow.querySelectorAll(".col-filter-input")).some((i) => i.value.trim())
      || (authStatusSelect && authStatusSelect.value !== "all")
      || state.fullTextQ
      || firstSeenAnySet();
    filterClearAllBtn.classList.toggle("hidden", !anyActive);
  }

  pageSizeSelect.value = String(state.currentSize);

  // ── Column filters ──────────────────────────────────────────────────────
  function getColumnFilters() {
    const active = [];
    filterRow.querySelectorAll(".col-filter-input").forEach((input) => {
      const col = input.dataset.col;
      const q   = (input.value || "").trim();
      if (q) {
        const colDef = getColumns().find((c) => c.key === col);
        if (colDef) {
          try { active.push({ field: colDef.field, re: new RegExp(q, "i") }); }
          catch {
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            active.push({ field: colDef.field, re: new RegExp(escaped, "i") });
          }
        }
      }
    });
    return active;
  }

  function hasActiveFilterText() {
    return Array.from(filterRow.querySelectorAll(".col-filter-input")).some((i) => i.value.trim());
  }

  function needsFilterMode() {
    return state.portalOnly
      || Array.from(filterRow.querySelectorAll(".col-filter-input")).some((i) => i.value.trim())
      || (authStatusSelect && authStatusSelect.value !== "all")
      || state.sortCol !== null
      || !!state.fullTextQ
      || firstSeenAnySet()
      || state.macPrivate || state.markedOnly;
  }

  function anyFilterActive() {
    return needsFilterMode();
  }

  function applyFiltersToRows(rows) {
    if (state.portalOnly) rows = rows.filter((r) => r.hypervision === "true");
    const filters = getColumnFilters();
    if (filters.length) rows = rows.filter((r) => filters.every((f) => f.re.test(f.field(r) || "")));
    const authFilter = authStatusSelect ? authStatusSelect.value : "all";
    if (authFilter !== "all") {
      const macs = state.activeSessionMacs || (state.pxgridLive && state.pxgridSessionMacs) || null;
      if (macs) {
        rows = rows.filter((r) => {
          const mac = normalizeMac(r.mac || r.name || "");
          return authFilter === "auth" ? macs.has(mac) : !macs.has(mac);
        });
      }
    }
    // First-seen dato/tid-range filter
    const fsFromV = firstSeenFromVal(); const fsToV = firstSeenToVal();
    if (fsFromV || fsToV) {
      const fromTs = fsFromV ? new Date(fsFromV).getTime() / 1000 : 0;
      const toTs   = fsToV   ? (new Date(fsToV).getTime() / 1000 + 59) : Infinity;
      rows = rows.filter((r) => {
        const ts = r.first_seen_at || 0;
        return ts >= fromTs && ts <= toTs;
      });
    }
    // MAC-type chips: Privat (lokalt administreret) og Inaktiv (ingen RADIUS-session)
    if (state.macPrivate) {
      rows = rows.filter((r) => {
        const first = parseInt((normalizeMac(r.mac || r.name || "").split(":")[0] || ""), 16);
        return !isNaN(first) && (first & 0x02) !== 0;
      });
    }
    // Kun markerede (fra Livscyklus)
    if (state.markedOnly) {
      const marked = loadMarkedMacs();
      rows = rows.filter((r) => marked.has(normalizeMac(r.mac || r.name || "")));
    }
    if (state.sortCol) {
      const colDef = getColumns().find((c) => c.key === state.sortCol);
      if (colDef) {
        rows = [...rows].sort((a, b) => {
          if (state.sortCol === "create_time") {
            const ta = new Date(endpointCreateTime(a) || 0).getTime();
            const tb = new Date(endpointCreateTime(b) || 0).getTime();
            return state.sortDir === "asc" ? ta - tb : tb - ta;
          }
          if (state.sortCol === "first_seen") {
            const ta = (a.first_seen_at || 0) * 1000;
            const tb = (b.first_seen_at || 0) * 1000;
            return state.sortDir === "asc" ? ta - tb : tb - ta;
          }
          if (state.sortCol === "auth_status") {
            const macs = state.activeSessionMacs || (state.pxgridLive && state.pxgridSessionMacs) || null;
            const authVal = (r) => {
              if (!macs) return "9";
              return macs.has(normalizeMac(r.mac || r.name || "")) ? "0" : "1";
            };
            return state.sortDir === "asc" ? authVal(a).localeCompare(authVal(b)) : authVal(b).localeCompare(authVal(a));
          }
          if (state.sortCol === "platform_type") {
            const sess = state.pxgridSessionData;
            const pt = (r) => {
              const nasPt = sess ? (sess.get(normalizeMac(r.mac || r.name))?.nas_device_type || "") : "";
              return (nasPt || r.platform_type || "").toLowerCase();
            };
            return state.sortDir === "asc" ? pt(a).localeCompare(pt(b)) : pt(b).localeCompare(pt(a));
          }
          const va = (colDef.field(a) || "").toLowerCase();
          const vb = (colDef.field(b) || "").toLowerCase();
          return state.sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
    }
    return rows;
  }

  // ── Filter mode (client-side) ────────────────────────────────────────────
  async function enterFilterMode() {
    if (state.loadingAll) return;
    if (state.allRowsCache) {
      state.allRows = state.allRowsCache;
      state.filterMode = true;
      state.currentPage = 1;
      return;
    }
    state.loadingAll = true;
    const cols = getColumns().length + 2;
    container.querySelector("#tbody").innerHTML =
      `<tr><td colspan="${cols}" class="empty">${t("browse.filter_loading_td")}</td></tr>`;
    msg.innerHTML = `<div class="alert info">${t("browse.filter_loading_msg")}</div>`;
    try {
      const all = await api.listAllEndpointDetails("", state.currentFilters, state.fullTextQ || "");
      state.allRowsCache = all;
      state.allRows = all;
      state.filterMode = true;
      state.currentPage = 1;
      msg.innerHTML = "";
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("browse.filter_load_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      state.loadingAll = false;
    }
  }

  function exitFilterMode() {
    if (!state.filterMode) return;
    state.filterMode = false;
    state.currentPage = 1;
    cb.load();
  }

  async function onFilterChange() {
    if (needsFilterMode()) {
      await enterFilterMode();
      await cb.refreshActiveSessionMacs();
      cb.applyFilter();
    } else {
      state.activeSessionMacs = null;
      exitFilterMode();
    }
  }

  // ── Column sort (alle kolonner) ──────────────────────────────────────────
  function updateSortHeaders() {
    container.querySelectorAll("thead tr:first-child th[data-col]").forEach((th) => {
      const colDef = getColumns().find((c) => c.key === th.dataset.col);
      if (!colDef) return;
      if (state.sortCol === th.dataset.col) {
        th.textContent = `${colDef.label} ${state.sortDir === "asc" ? "↑" : "↓"}`;
        th.classList.add("sort-active");
      } else {
        th.textContent = colDef.label;
        th.classList.remove("sort-active");
      }
    });
  }

  container.querySelectorAll("thead tr:first-child th[data-col]").forEach((th) => {
    th.classList.add("sortable-col");
    th.title = "Klik for at sortere";
    th.addEventListener("click", async () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        if (state.sortDir === "asc") { state.sortDir = "desc"; }
        else { state.sortCol = null; state.sortDir = null; }
      } else {
        state.sortCol = col;
        state.sortDir = "asc";
      }
      updateSortHeaders();
      clearActiveView();
      if (state.sortCol !== null) {
        if (!state.filterMode) await enterFilterMode();
        cb.applyFilter();
      } else {
        await onFilterChange();
      }
    });
  });

  // ── Filter persistence ───────────────────────────────────────────────────
  function snapshotFilters() {
    const cols = [];
    filterRow.querySelectorAll(".col-filter-input").forEach((input) => {
      const q = (input.value || "").trim();
      if (q) cols.push({ col: input.dataset.col, value: q });
    });
    return {
      portalOnly: state.portalOnly,
      cols,
      authStatus: authStatusSelect ? authStatusSelect.value : "all",
      colVis: { ...state.colVis },
      pageSize: state.currentSize,
      firstSeenFrom: firstSeenFromVal(),
      firstSeenTo:   firstSeenToVal(),
    };
  }

  function persistFilters() { saveBrowseFilters(snapshotFilters()); }

  function applyFilterSnapshot(s, { skipColVis = false } = {}) {
    if (!s) return;
    state.portalOnly = false;
    portalFilterBtn.classList.remove("active-toggle");
    state.currentFilters = [];
    state.sortCol = null;
    state.sortDir = null;
    updateSortHeaders();
    filterRow.querySelectorAll(".col-filter-input").forEach((input) => { input.value = ""; });
    if (authStatusSelect) authStatusSelect.value = "all";
    if (s.portalOnly) { state.portalOnly = true; portalFilterBtn.classList.add("active-toggle"); }
    if (s.authStatus && authStatusSelect) authStatusSelect.value = s.authStatus;
    if (Array.isArray(s.cols)) {
      for (const { col, value } of s.cols) {
        const input = filterRow.querySelector(`.col-filter-input[data-col="${col}"]`);
        if (input) input.value = value || "";
      }
    }
    updateClearBtn();
    if (!skipColVis && s.colVis && typeof s.colVis === "object") {
      for (const c of getColumns()) {
        if (c.key in s.colVis) state.colVis[c.key] = s.colVis[c.key] !== false;
      }
      saveColVis(state.colVis);
      cb.renderColVisMenu?.();
      cb.applyColVis?.();
    }
    if (typeof s.pageSize === "number" && s.pageSize > 0) {
      state.currentSize = s.pageSize;
      savePageSize(state.currentSize);
      pageSizeSelect.value = String(state.currentSize);
    }
    firstSeenRestore(s.firstSeenFrom || "", s.firstSeenTo || "");
  }

  function restoreFilters() { applyFilterSnapshot(loadBrowseFilters(), { skipColVis: true }); }

  // ── Event handlers ───────────────────────────────────────────────────────
  let filterDebounce = null;
  filterRow.querySelectorAll(".col-filter-input").forEach((input) => {
    input.addEventListener("input", () => {
      updateClearBtn();
      persistFilters();
      clearActiveView();
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(async () => { await onFilterChange(); }, 250);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { input.value = ""; input.dispatchEvent(new Event("input")); }
    });
  });

  if (authStatusSelect) {
    authStatusSelect.addEventListener("change", () => {
      updateClearBtn();
      persistFilters();
      clearActiveView();
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(async () => { await onFilterChange(); }, 250);
    });
  }

  if (globalQInput) {
    let qDebounce = null;
    globalQInput.addEventListener("input", () => {
      const newQ = globalQInput.value.trim();
      if (newQ === state.fullTextQ) return;
      state.fullTextQ = newQ;
      state.allRowsCache = null;
      updateClearBtn();
      clearActiveView();
      clearTimeout(qDebounce);
      qDebounce = setTimeout(async () => { await onFilterChange(); }, 400);
    });
  }

  // Wire up first-seen date inputs — rendered lazily when first_seen column is visible
  container.addEventListener("change", async (e) => {
    if (e.target.id === "first-seen-from-d" || e.target.id === "first-seen-from-t"
     || e.target.id === "first-seen-to-d"   || e.target.id === "first-seen-to-t") {
      if (e.target.id === "first-seen-from-t" || e.target.id === "first-seen-to-t") {
        const v = e.target.value.trim();
        e.target.classList.toggle("invalid", !!v && !/^\d{1,2}:\d{2}$/.test(v));
      }
      updateClearBtn();
      persistFilters();
      clearActiveView();
      await onFilterChange();
    }
  });

  filterClearAllBtn.addEventListener("click", async () => {
    applyFilterSnapshot({ portalOnly: false, cols: [], authStatus: "all" });
    state.fullTextQ = "";
    if (globalQInput) globalQInput.value = "";
    firstSeenClearAll();
    state.allRowsCache = null;
    persistFilters();
    clearActiveView();
    await onFilterChange();
  });

  portalFilterBtn.addEventListener("click", async () => {
    state.portalOnly = !state.portalOnly;
    portalFilterBtn.classList.toggle("active-toggle", state.portalOnly);
    updateClearBtn();
    persistFilters();
    clearActiveView();
    await onFilterChange();
  });

  // ── Saved views ──────────────────────────────────────────────────────────
  function updateViewsBtnLabel() {
    const active = state.savedViews.find((v) => v.id === state.activeViewId);
    viewsBtn.innerHTML = active ? `📁 <strong>${esc(active.name)}</strong> ▾` : `📁 Views ▾`;
    viewsBtn.classList.toggle("active-view", !!active);
  }

  async function reloadViews() {
    try {
      const r = await api.listMyViews();
      state.savedViews = r.views || [];
    } catch (err) {
      console.warn("Kunne ikke hente saved views:", err.message);
      state.savedViews = [];
    }
    if (state.activeViewId && !state.savedViews.find((v) => v.id === state.activeViewId)) {
      state.activeViewId = null;
    }
    renderViewsMenu();
    updateViewsBtnLabel();
  }

  function renderViewsMenu() {
    const items = state.savedViews.length === 0
      ? `<div class="views-empty">${t("browse.views_empty")}</div>`
      : state.savedViews.map((v) => {
          const isActive = v.id === state.activeViewId;
          return `
            <div class="views-item${isActive ? " views-item-active" : ""}" data-view-id="${esc(v.id)}">
              <button type="button" class="views-apply" data-view-id="${esc(v.id)}"
                      title="${t("browse.views_apply_title")}">${isActive ? "✓ " : ""}${esc(v.name)}</button>
              <button type="button" class="views-del" data-view-id="${esc(v.id)}"
                      title="${t("browse.views_del_title")}">×</button>
            </div>`;
        }).join("");
    viewsMenu.innerHTML = `
      <button type="button" class="views-clear" title="${t("browse.views_clear_title")}">
        ${t("browse.views_clear_btn")}
      </button>
      <div class="views-divider"></div>
      ${items}
      <div class="views-divider"></div>
      <button type="button" class="views-save" title="${t("browse.views_save_title")}">
        ${t("browse.views_save_btn")}
      </button>`;
  }

  function clearActiveView() {
    if (!state.activeViewId) return;
    state.activeViewId = null;
    renderViewsMenu();
    updateViewsBtnLabel();
  }

  viewsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    viewsMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!viewsMenu.contains(e.target) && e.target !== viewsBtn) viewsMenu.classList.add("hidden");
  });

  viewsMenu.addEventListener("click", async (e) => {
    e.stopPropagation();
    const tgt = e.target;

    if (tgt.classList.contains("views-clear")) {
      applyFilterSnapshot({ portalOnly: false, cols: [] });
      persistFilters();
      state.activeViewId = null;
      renderViewsMenu();
      updateViewsBtnLabel();
      msg.innerHTML = `<div class="alert info">${t("browse.views_reset_ok")}</div>`;
      viewsMenu.classList.add("hidden");
      await onFilterChange();
      return;
    }
    if (tgt.classList.contains("views-apply")) {
      const v = state.savedViews.find((x) => x.id === tgt.dataset.viewId);
      if (!v) return;
      applyFilterSnapshot(v.query || {});
      persistFilters();
      state.activeViewId = v.id;
      renderViewsMenu();
      updateViewsBtnLabel();
      msg.innerHTML = `<div class="alert info">${t("browse.views_applied").replace("{name}", esc(v.name))}</div>`;
      viewsMenu.classList.add("hidden");
      await onFilterChange();
      return;
    }
    if (tgt.classList.contains("views-del")) {
      const v = state.savedViews.find((x) => x.id === tgt.dataset.viewId);
      if (!v || !confirm(t("browse.views_del_confirm").replace("{name}", v.name))) return;
      try {
        await api.deleteMyView(v.id);
        await reloadViews();
        msg.innerHTML = `<div class="alert success">${t("browse.views_del_ok").replace("{name}", esc(v.name))}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("browse.views_del_err").replace("{msg}", esc(err.message))}</div>`;
      }
      return;
    }
    if (tgt.classList.contains("views-save")) {
      const name = prompt(t("browse.views_save_prompt"));
      if (!name || !name.trim()) return;
      const trimmed = name.trim();
      const snap     = snapshotFilters();
      const existing = state.savedViews.find((v) => (v.name || "").toLowerCase() === trimmed.toLowerCase());
      try {
        let savedId;
        if (existing) {
          if (!confirm(t("browse.views_overwrite_confirm").replace("{name}", existing.name))) return;
          await api.updateMyView(existing.id, { name: trimmed, query: snap });
          savedId = existing.id;
          msg.innerHTML = `<div class="alert success">${t("browse.views_overwrite_ok").replace("{name}", esc(trimmed))}</div>`;
        } else {
          const created = await api.createMyView(trimmed, snap);
          savedId = created && created.id;
          msg.innerHTML = `<div class="alert success">${t("browse.views_save_ok").replace("{name}", esc(trimmed))}</div>`;
        }
        state.activeViewId = savedId || null;
        await reloadViews();
        viewsMenu.classList.add("hidden");
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("browse.views_save_err").replace("{msg}", esc(err.message))}</div>`;
      }
    }
  });

  reloadViews();

  return {
    applyFiltersToRows, needsFilterMode, anyFilterActive, hasActiveFilterText,
    getColumnFilters, onFilterChange, enterFilterMode,
    exitFilterMode, clearActiveView,
    snapshotFilters, persistFilters, applyFilterSnapshot, restoreFilters,
  };
}
