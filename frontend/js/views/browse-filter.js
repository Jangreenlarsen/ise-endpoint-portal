// Filter-toolbar + saved views logic for Browse.
// initFilter wires all filter-related DOM events and returns its public API.
// Cross-module calls go via the `cb` object (populated in browse.js after all inits).

import {
  getColumns, esc,
  endpointCreateTime,
  normalizeMac,
  loadBrowseFilters, saveBrowseFilters,
  loadColVis, saveColVis,
  savePageSize,
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

  function updateClearBtn() {
    const anyActive = state.portalOnly
      || Array.from(filterRow.querySelectorAll(".col-filter-input")).some((i) => i.value.trim())
      || (authStatusSelect && authStatusSelect.value !== "all");
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
      || state.sortCol !== null;
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
    if (state.sortCol) {
      const colDef = getColumns().find((c) => c.key === state.sortCol);
      if (colDef) {
        rows = [...rows].sort((a, b) => {
          if (state.sortCol === "create_time") {
            const ta = new Date(endpointCreateTime(a) || 0).getTime();
            const tb = new Date(endpointCreateTime(b) || 0).getTime();
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
    if (state.filterMode || state.loadingAll) return;
    if (state.allRowsCache) {
      state.allRows = state.allRowsCache;
      state.filterMode = true;
      state.currentPage = 1;
      return;
    }
    state.loadingAll = true;
    const cols = getColumns().length + 2;
    container.querySelector("#tbody").innerHTML =
      `<tr><td colspan="${cols}" class="empty">Henter alle endpoints fra ISE...</td></tr>`;
    msg.innerHTML = `<div class="alert info">Henter alle endpoints for at kunne filtrere på tværs af sider...</div>`;
    try {
      const all = await api.listAllEndpointDetails("", state.currentFilters);
      state.allRowsCache = all;
      state.allRows = all;
      state.filterMode = true;
      state.currentPage = 1;
      msg.innerHTML = "";
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke hente alle endpoints: ${err.message}</div>`;
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
    };
  }

  function persistFilters() { saveBrowseFilters(snapshotFilters()); }

  function applyFilterSnapshot(s) {
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
    if (s.colVis && typeof s.colVis === "object") {
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
  }

  function restoreFilters() { applyFilterSnapshot(loadBrowseFilters()); }

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

  filterClearAllBtn.addEventListener("click", async () => {
    applyFilterSnapshot({ portalOnly: false, cols: [], authStatus: "all" });
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
      ? `<div class="views-empty">Ingen gemte views endnu</div>`
      : state.savedViews.map((v) => {
          const isActive = v.id === state.activeViewId;
          return `
            <div class="views-item${isActive ? " views-item-active" : ""}" data-view-id="${esc(v.id)}">
              <button type="button" class="views-apply" data-view-id="${esc(v.id)}"
                      title="Aktivér dette view">${isActive ? "✓ " : ""}${esc(v.name)}</button>
              <button type="button" class="views-del" data-view-id="${esc(v.id)}"
                      title="Slet view">×</button>
            </div>`;
        }).join("");
    viewsMenu.innerHTML = `
      <button type="button" class="views-clear" title="Ryd alle filtre og aktivt view">
        🚫 Ryd alle filtre (ingen view)
      </button>
      <div class="views-divider"></div>
      ${items}
      <div class="views-divider"></div>
      <button type="button" class="views-save" title="Gem nuværende filter-kombination">
        💾 Gem nuværende filtre som view…
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
      msg.innerHTML = `<div class="alert info">Alle filtre nulstillet.</div>`;
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
      msg.innerHTML = `<div class="alert info">View "${esc(v.name)}" anvendt.</div>`;
      viewsMenu.classList.add("hidden");
      await onFilterChange();
      return;
    }
    if (tgt.classList.contains("views-del")) {
      const v = state.savedViews.find((x) => x.id === tgt.dataset.viewId);
      if (!v || !confirm(`Slet view "${v.name}"?`)) return;
      try {
        await api.deleteMyView(v.id);
        await reloadViews();
        msg.innerHTML = `<div class="alert success">View "${esc(v.name)}" slettet.</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">Kunne ikke slette: ${esc(err.message)}</div>`;
      }
      return;
    }
    if (tgt.classList.contains("views-save")) {
      const name = prompt(
        "Navn på view (fx 'Mine printere', 'PLC-HalA aktive')\n" +
        "Gemmer nuværende filterkombination — Kun portal, server-MAC-filter, kolonnefiltre."
      );
      if (!name || !name.trim()) return;
      const trimmed = name.trim();
      const snap     = snapshotFilters();
      const existing = state.savedViews.find((v) => (v.name || "").toLowerCase() === trimmed.toLowerCase());
      try {
        let savedId;
        if (existing) {
          if (!confirm(`Et view med navnet "${existing.name}" findes allerede.\n\nOverskriv det med nuværende filtre?`)) return;
          await api.updateMyView(existing.id, { name: trimmed, query: snap });
          savedId = existing.id;
          msg.innerHTML = `<div class="alert success">View "${esc(trimmed)}" overskrevet.</div>`;
        } else {
          const created = await api.createMyView(trimmed, snap);
          savedId = created && created.id;
          msg.innerHTML = `<div class="alert success">View "${esc(trimmed)}" gemt.</div>`;
        }
        state.activeViewId = savedId || null;
        await reloadViews();
        viewsMenu.classList.add("hidden");
      } catch (err) {
        msg.innerHTML = `<div class="alert error">Kunne ikke gemme: ${esc(err.message)}</div>`;
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
