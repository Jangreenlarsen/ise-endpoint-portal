import { api } from "../api.js";
import { t } from "../i18n.js";
import {
  getColumns, getOrderedColumns, esc,
  getPageSize, getCoaReauthOnSave, setCoaReauthOnSave,
  loadColVis, saveColVis,
  normalizeMac, fmtAgo, coaSummaryText,
} from "./browse-utils.js";
import { initFilter } from "./browse-filter.js";
import { initTable  } from "./browse-table.js";
import { initDetail } from "./browse-detail.js";
import { initBulk   } from "./browse-bulk.js";

export async function renderBrowse(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">${t("browse.title")}</h2>
      <span id="pxgrid-source-badge"
            title="${t("browse.pxgrid_badge_title")}"
            style="padding:3px 10px; border-radius:12px; font-size:0.8em; background:#e5e7eb; color:#374151; white-space:nowrap;">
        ${t("browse.pxgrid_badge")}
      </span>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="toolbar-group" title="${t("browse.tooltip_data")}">
          <button id="refresh-btn">${t("browse.btn_refresh")}</button>
          <button id="export-btn" class="secondary">${t("browse.btn_export")}</button>
          <div class="col-vis-wrap">
            <button id="col-vis-btn" class="secondary small" type="button"
                    title="${t("browse.tooltip_columns")}">${t("browse.btn_columns")}</button>
            <div id="col-vis-menu" class="col-vis-menu hidden"></div>
          </div>
        </div>
        <span class="toolbar-divider"></span>
        <div class="toolbar-group" title="${t("browse.tooltip_filters")}">
          <div class="views-wrap">
            <button id="views-btn" class="secondary small" type="button"
                    title="Gemte filter-views — én-klik gendan filterkombination">${t("browse.btn_views")}</button>
            <div id="views-menu" class="views-menu hidden"></div>
          </div>
          <button id="portal-filter-btn" class="secondary"
                  title="Vis kun endpoints oprettet af HyperVision ISE Portal">${t("browse.btn_portal_filter")}</button>
        </div>
        <div class="spacer"></div>
        <div class="toolbar-group" title="${t("browse.tooltip_save")}">
          <button id="coa-toggle-btn" class="secondary"
                  title="Udløs CoA reauth på ISE efter hver gemt ændring">${t("browse.btn_coa_off")}</button>
          <button id="undo-btn" class="secondary" disabled title="Fortryd alle ikke-gemte ændringer">↩ Fortryd</button>
          <button id="save-all-btn" disabled title="Gem alle ændrede endpoints">${t("browse.btn_save_all")}</button>
        </div>
        <span class="toolbar-divider"></span>
        <div class="toolbar-group" title="${t("browse.tooltip_selection")}">
          <span id="selection-count" class="hint"></span>
          <button id="bulk-edit-btn" class="secondary small" disabled>${t("browse.btn_bulk_edit")}</button>
          <button id="bulk-save-btn" class="small" disabled>${t("browse.btn_bulk_save")}</button>
          <button id="bulk-disconnect-btn" class="danger small" disabled
                  title="CoA Disconnect — deautentificér valgte klienter på WLC/switch (tvinger ny DHCP ved re-associate)">${t("browse.btn_bulk_disconnect")}</button>
          <button id="bulk-del-btn" class="danger small" disabled>${t("browse.btn_bulk_delete")}</button>
        </div>
        <span class="toolbar-divider"></span>
        <div class="toolbar-group" title="${t("browse.tooltip_view")}">
          <label class="hint page-size-label">${t("browse.label_show")}
            <select id="page-size-select">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </label>
          <span id="count" class="hint"></span>
        </div>
      </div>
      <div id="msg"></div>
      <div class="browse-table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="select-all" title="${t("browse.select_all_title")}" /></th>
              ${getOrderedColumns().map((c) => `<th data-col="${c.key}" draggable="true"${c.cls ? ` class="${c.cls}"` : ""}>${c.label}</th>`).join("")}
            </tr>
            <tr class="filter-row">
              <th><button type="button" id="filter-clear-all-btn" class="filter-clear-all-btn hidden" title="Nulstil alle søgefelter">×</button></th>
              ${getOrderedColumns().map((c) => `
                <th data-col="${c.key}"${c.cls ? ` class="${c.cls}"` : ""}>
                  <input type="text" class="col-filter-input" data-col="${c.key}"
                         placeholder="…" />
                </th>`).join("")}
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="${getColumns().length + 2}" class="empty">${t("browse.loading_rows")}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="pagination-bar" id="pagination-bar">
        <button id="page-prev" class="secondary small" disabled>&laquo; ${t("browse.page_prev")}</button>
        <span id="page-info" class="hint"></span>
        <button id="page-next" class="secondary small" disabled>${t("browse.page_next")} &raquo;</button>
      </div>
    </div>
    <div id="detail-overlay" class="modal-overlay hidden">
      <div class="modal detail-modal">
        <h3>${t("detail.title")}</h3>
        <div id="detail-msg"></div>
        <div class="detail-grid">
          <label>MAC</label><div class="detail-value" id="d-mac"></div>
          <label>Vendor</label><div class="detail-value" id="d-vendor"></div>
          <label>Name</label><div class="detail-value" id="d-name"></div>
          <label>ID</label><div class="detail-value mono" id="d-id"></div>
          <label>Identity Group</label>
          <select id="d-group"></select>
          <label>${t("detail.assignment")}</label>
          <label class="inline-cb"><input type="checkbox" id="d-static-group" /> ${t("detail.static_assign")}</label>
          <label>Description</label>
          <input type="text" id="d-description" />
          <label>Type</label>
          <select id="d-type"></select>
          <label>Owner</label>
          <select id="d-owner"></select>
          <label>${t("col.lokation")}</label>
          <select id="d-lokation"></select>
          <label>AuthzVlan</label>
          <select id="d-authzvlan"></select>
          <label>AuthzACL</label>
          <select id="d-authzacl"></select>
          <label>Platform</label>
          <div class="platform-field-wrap"><select id="d-platformtype"></select></div>
          <label>PSK Mode</label>
          <label class="inline-cb"><input type="checkbox" id="d-psk-mode" /> ${t("detail.psk_mode_lbl")}</label>
          <label id="d-psk-key-label">PSK Key</label>
          <div id="d-psk-key-wrap" class="psk-key-wrap">
            <input type="password" id="d-psk-key" autocomplete="off" />
            <button type="button" id="d-psk-show" class="secondary small">${t("detail.btn_show")}</button>
            <button type="button" id="d-psk-gen" class="secondary small">${t("detail.btn_generate")}</button>
          </div>
          <label>${t("col.roles")}</label>
          <div id="d-roles"></div>
          <label>HypervisionISEPortal</label>
          <div class="detail-value mono" id="d-hypervision"></div>
          <label>Profile ID</label>
          <div class="detail-value mono" id="d-profile-id"></div>
          <label>${t("detail.profile_name")}</label>
          <div class="detail-value" id="d-profiler-name"></div>
          <label>Static profile</label>
          <div class="detail-value" id="d-static-profile"></div>
          <label>Portal user</label>
          <div class="detail-value" id="d-portal-user"></div>
          <label>Identity store</label>
          <div class="detail-value" id="d-identity-store"></div>
          <label>${t("detail.registered")}</label>
          <div class="detail-value" id="d-create-time"></div>
          <label>${t("detail.last_updated")}</label>
          <div class="detail-value" id="d-update-time"></div>
        </div>
        <div id="d-anc-section" class="hidden anc-section">
          <div class="anc-status-row">
            <span class="anc-label">ANC Quarantine</span>
            <span id="d-anc-badge" class="anc-badge anc-free">${t("detail.anc_free")}</span>
            <span id="d-anc-loading" class="hint hidden">${t("detail.anc_loading")}</span>
          </div>
          <div id="d-anc-quarantine-row" class="anc-action-row">
            <select id="d-anc-policy" class="anc-policy-select"><option value="">${t("detail.anc_select")}</option></select>
            <button id="d-anc-apply" class="danger small">${t("detail.anc_quarantine")}</button>
          </div>
          <div id="d-anc-clear-row" class="anc-action-row hidden">
            <button id="d-anc-clear" class="secondary small">${t("detail.anc_clear")}</button>
          </div>
        </div>
        <div id="d-policy-section" class="hidden policy-section">
          <div class="policy-section-header">
            <span class="policy-section-label">RADIUS Policy</span>
            <button id="d-policy-toggle" class="secondary small">${t("detail.policy_hide")}</button>
          </div>
          <div id="d-policy-body">
            <div id="d-policy-match-area"></div>
            <div id="d-policy-wizard-area"></div>
          </div>
        </div>
        <div class="modal-actions">
          <button id="d-save">${t("detail.btn_save")}</button>
          <button id="d-disconnect" class="danger"
                  title="CoA Disconnect">${t("detail.btn_disconnect")}</button>
          <button id="d-close" class="secondary">${t("detail.btn_close")}</button>
        </div>
      </div>
    </div>
    <div id="bulk-edit-overlay" class="modal-overlay hidden">
      <div class="modal detail-modal">
        <h3>${t("bulk.title")}</h3>
        <p class="hint" id="bulk-edit-count"></p>
        <div class="modal-body">
          <label><input type="checkbox" class="be-cb" data-field="group" /> Identity Group</label>
          <select id="be-group" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="static-group" /> ${t("detail.assignment")}</label>
          <div id="be-static-group" class="be-inner-wrap disabled-overlay">
            <label class="inline-cb"><input type="checkbox" id="be-static-group-cb" disabled /> ${t("detail.static_assign")}</label>
          </div>
          <label><input type="checkbox" class="be-cb" data-field="description" /> Description</label>
          <input type="text" id="be-description" disabled />
          <label><input type="checkbox" class="be-cb" data-field="type" /> Type</label>
          <select id="be-type" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="owner" /> Owner</label>
          <select id="be-owner" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="lokation" /> ${t("col.lokation")}</label>
          <select id="be-lokation" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="authzvlan" /> AuthzVlan</label>
          <select id="be-authzvlan" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="authzacl" /> AuthzACL</label>
          <select id="be-authzacl" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="platformtype" /> Platform</label>
          <select id="be-platformtype" disabled></select>
          <label id="be-psk-mode-row" class="hidden"><input type="checkbox" class="be-cb" data-field="psk-mode" /> PSK Mode</label>
          <div id="be-psk-mode" class="be-inner-wrap disabled-overlay hidden">
            <label class="inline-cb"><input type="checkbox" id="be-psk-mode-cb" disabled /> ${t("detail.psk_mode_lbl")}</label>
          </div>
          <label id="be-psk-key-row" class="hidden"><input type="checkbox" class="be-cb" data-field="psk-key" /> PSK Key</label>
          <div id="be-psk-key" class="psk-key-wrap disabled-overlay hidden">
            <input type="password" id="be-psk-key-inp" autocomplete="off" disabled />
            <button type="button" id="be-psk-show" class="secondary small" disabled>${t("bulk.btn_show")}</button>
            <button type="button" id="be-psk-gen" class="secondary small" disabled>${t("bulk.btn_generate")}</button>
          </div>
          <label><input type="checkbox" class="be-cb" data-field="roles" /> ${t("col.roles")}</label>
          <div id="be-roles" class="be-roles-wrap disabled-overlay"></div>
        </div>
        <div class="modal-actions">
          <button id="be-apply">${t("bulk.btn_apply")}</button>
          <button id="be-cancel" class="secondary">${t("bulk.btn_cancel")}</button>
        </div>
      </div>
    </div>
  `;

  // ── Shared mutable state ──────────────────────────────────────────────────
  const savedColVis = loadColVis() || {};
  const colVis = {};
  for (const c of getColumns()) colVis[c.key] = savedColVis[c.key] !== false;

  const state = {
    allRows: [], allRowsCache: null, activeSessionMacs: null,
    groups: [],
    caValues: { Type: [], Owner: [], Lokation: [], AuthzVlan: [], AuthzACL: [], PlatformType: [] },
    roleCatalog: [], canEditRoles: false, isPskEditor: false, pskShowKey: false,
    portalOnly: false, sortCol: null, sortDir: null,
    dirtyIds: new Set(),
    currentPage: 1, currentSize: getPageSize(), totalEndpoints: 0,
    filterMode: false, loadingAll: false,
    currentFilters: [], searchDebounce: null,
    coaOnSave: getCoaReauthOnSave(), coaByLocal: new Map(),
    ancPoliciesCache: null,
    detailCurrentId: null, detailOriginalGroupId: "",
    savedViews: [], activeViewId: null,
    colVis,
    pxgridLive: false, pxgridSessionMacs: null, pxgridSessionData: null,
    pxgridLastEventTs: 0, pxgridEndpointEventCount: 0, pxgridLastEndpointEventTs: 0,
  };

  // ── Cross-module callback object (populated after all inits) ──────────────
  const cb = {};

  // ── Module initialisation ─────────────────────────────────────────────────
  const filterAPI = initFilter(container, state, api, cb);
  const tableAPI  = initTable(container, state, api, cb);
  const detailAPI = initDetail(container, state, api, cb);
  initBulk(container, state, api, cb);

  // ── CoA helpers (needed by table + detail) ────────────────────────────────
  async function runCoaForIds(entries) {
    if (!state.coaOnSave || !entries.length) return { ok: 0, fail: 0, failures: [], disconnects: 0, reauths: 0 };
    let ok = 0, fail = 0, disconnects = 0, reauths = 0;
    const failures = [];
    for (const e of entries) {
      const id           = typeof e === "string" ? e : e.id;
      const platformType = typeof e === "object" && e.platformType ? e.platformType : "";
      const useDisconnect = state.coaByLocal.get(platformType) === "disconnect";
      try {
        const res = useDisconnect ? await api.coaDisconnect(id) : await api.coaReauth(id);
        if (res?.ok) { ok++; if (useDisconnect) disconnects++; else reauths++; }
        else { fail++; failures.push({ mac: res?.mac || id, msg: `${useDisconnect ? "disconnect" : "reauth"}: ${res?.message || "fejlede"}` }); }
      } catch (err) { fail++; failures.push({ mac: id, msg: err.message }); }
    }
    return { ok, fail, failures, disconnects, reauths };
  }

  // ── pxGrid / session-status ───────────────────────────────────────────────
  function updatePxGridSourceBadge() {
    const el = container.querySelector("#pxgrid-source-badge");
    if (!el) return;
    const epAgo    = fmtAgo(state.pxgridLastEndpointEventTs);
    const agopart  = (state.pxgridEndpointEventCount > 0 && epAgo)
      ? t("browse.pxgrid_ep_ago").replace("{ago}", epAgo) : "";
    const epPart   = t("browse.pxgrid_ep_part")
      .replace("{n}", state.pxgridEndpointEventCount)
      .replace("{agopart}", state.pxgridEndpointEventCount > 0 ? agopart : "");
    if (state.pxgridLive && state.pxgridSessionMacs) {
      const sessAgo  = fmtAgo(state.pxgridLastEventTs);
      // Vis activeSessionMacs.size (fusioneret MnT+pxGrid) som aktiv-count
      const sessCount = state.activeSessionMacs ? state.activeSessionMacs.size : state.pxgridSessionMacs.size;
      el.innerHTML  = t("browse.pxgrid_push")
        .replace("{n}", sessCount)
        .replace("{ago}", sessAgo || "—")
        .replace("{ep}", epPart);
      el.style.background = "#dcfce7"; el.style.color = "#166534";
    } else if (state.activeSessionMacs) {
      el.innerHTML  = t("browse.pxgrid_pull")
        .replace("{n}", state.activeSessionMacs.size)
        .replace("{ep}", epPart);
      el.style.background = "#fef3c7"; el.style.color = "#92400e";
    } else {
      el.innerHTML  = t("browse.pxgrid_inactive").replace("{ep}", epPart);
      el.style.background = "#e5e7eb"; el.style.color = "#374151";
    }
  }

  async function refreshActiveSessionMacs(force = false) {
    if (!force) {
      if (state.pxgridLive && state.pxgridSessionMacs) {
        state.activeSessionMacs = new Set(state.pxgridSessionMacs);
        return;
      }
      if (!cb.anyFilterActive()) { state.activeSessionMacs = null; return; }
    }
    try {
      const list = await api.listActiveSessionMacs();
      state.activeSessionMacs = new Set((list || []).map(normalizeMac));
      if (state.pxgridLive) state.pxgridSessionMacs = new Set(state.activeSessionMacs);
    } catch (err) {
      console.warn("Kunne ikke hente aktive sessioner fra MnT:", err.message);
      state.activeSessionMacs = null;
    }
  }

  let endpointReloadTimer = null;
  function scheduleEndpointReload() {
    if (endpointReloadTimer) return;
    endpointReloadTimer = setTimeout(() => {
      endpointReloadTimer = null;
      if (state.dirtyIds && state.dirtyIds.size > 0) return;
      try { cb.load?.(); } catch {}
    }, 500);
  }

  let pxgridEventSource = null;
  let pxgridErrorTimer  = null;

  function startPxGridStream() {
    if (pxgridEventSource) return;
    const token = (window.localStorage && localStorage.getItem("hv_ise_token")) || "";
    if (!token) return;
    const base = window.location.origin.startsWith("file://") ? "http://localhost:8000" : "";
    try {
      pxgridEventSource = new EventSource(
        `${base}/api/pxgrid/sessions/stream?token=${encodeURIComponent(token)}`
      );
    } catch (err) { console.warn("EventSource opsætning fejlede:", err); return; }

    pxgridEventSource.addEventListener("snapshot", (e) => {
      try {
        const data = JSON.parse(e.data);
        const sessions = data.sessions || [];
        state.pxgridSessionMacs   = new Set(sessions.map((s) => normalizeMac(s.mac)));
        state.pxgridSessionData   = new Map(sessions.map((s) => [normalizeMac(s.mac), s]));
        state.pxgridLive          = true;
        state.pxgridLastEventTs   = Math.floor(Date.now() / 1000);
        // Brug pxGrid-data hvis snapshot har sessioner; bevar ellers MnT-data
        // så farver ikke forsvinder i vinduet før pxGrid-cache er seeded.
        if (sessions.length > 0) {
          state.activeSessionMacs = new Set(state.pxgridSessionMacs);
        }
        cb.applyAuthStatusColors?.();
        cb.applyFilter?.();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("upsert", (e) => {
      try {
        const data = JSON.parse(e.data);
        const mac  = normalizeMac(data.mac);
        if (!mac) return;
        if (!state.pxgridSessionMacs) state.pxgridSessionMacs = new Set();
        state.pxgridSessionMacs.add(mac);
        if (!state.pxgridSessionData) state.pxgridSessionData = new Map();
        state.pxgridSessionData.set(mac, data);
        state.pxgridLastEventTs = data.ts || Math.floor(Date.now() / 1000);
        if (!state.activeSessionMacs) state.activeSessionMacs = new Set();
        state.activeSessionMacs.add(mac);
        cb.applyAuthStatusColors?.();
        cb.applyFilter?.();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("remove", (e) => {
      try {
        const data = JSON.parse(e.data);
        const mac  = normalizeMac(data.mac);
        if (state.pxgridSessionMacs) state.pxgridSessionMacs.delete(mac);
        if (state.pxgridSessionData) state.pxgridSessionData.delete(mac);
        state.pxgridLastEventTs = data.ts || Math.floor(Date.now() / 1000);
        if (state.activeSessionMacs) state.activeSessionMacs.delete(mac);
        cb.applyAuthStatusColors?.();
        cb.applyFilter?.();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("endpoint_changed", (e) => {
      try {
        const data = JSON.parse(e.data);
        state.pxgridLastEventTs           = data.ts || Math.floor(Date.now() / 1000);
        state.pxgridEndpointEventCount   += 1;
        state.pxgridLastEndpointEventTs   = state.pxgridLastEventTs;
        scheduleEndpointReload();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("pxgrid_disabled", (e) => {
      let reason = "";
      try { reason = JSON.parse(e.data)?.reason || ""; } catch {}
      stopPxGridStream();
      if (cb.anyFilterActive?.()) refreshActiveSessionMacs().then(() => cb.applyAuthStatusColors?.());
      updatePxGridSourceBadge();
      // worker_stopped = transient restart — forsøg at genoprette SSE-stream
      // efter kort delay. pxgrid_enabled=false = permanent, genopret ikke.
      if (reason === "worker_stopped") {
        setTimeout(() => startPxGridStream(), 5000);
      }
    });
    pxgridEventSource.addEventListener("clear", () => {
      if (state.pxgridSessionMacs) state.pxgridSessionMacs.clear();
      if (state.pxgridSessionData) state.pxgridSessionData.clear();
      if (state.activeSessionMacs) state.activeSessionMacs.clear();
      cb.applyAuthStatusColors?.();
      cb.applyFilter?.();
      updatePxGridSourceBadge();
    });
    pxgridEventSource.onerror = () => {
      clearTimeout(pxgridErrorTimer);
      pxgridErrorTimer = setTimeout(() => { state.pxgridLive = false; updatePxGridSourceBadge(); }, 5000);
    };
    pxgridEventSource.onopen = () => {
      clearTimeout(pxgridErrorTimer);
      state.pxgridLive = true;
      updatePxGridSourceBadge();
    };
  }

  function stopPxGridStream() {
    clearTimeout(pxgridErrorTimer);
    pxgridErrorTimer = null;
    if (pxgridEventSource) { pxgridEventSource.close(); pxgridEventSource = null; }
    state.pxgridLive         = false;
    state.pxgridSessionMacs  = null;
    state.pxgridSessionData  = null;
    state.activeSessionMacs  = null;
    state.pxgridLastEventTs  = 0;
  }

  // ── CoA toggle ────────────────────────────────────────────────────────────
  const coaToggleBtn = container.querySelector("#coa-toggle-btn");
  function renderCoaToggle() {
    coaToggleBtn.textContent = state.coaOnSave ? t("browse.btn_coa_on") : t("browse.btn_coa_off");
    coaToggleBtn.classList.toggle("active-toggle", state.coaOnSave);
  }
  renderCoaToggle();
  coaToggleBtn.addEventListener("click", () => {
    state.coaOnSave = !state.coaOnSave;
    setCoaReauthOnSave(state.coaOnSave);
    renderCoaToggle();
  });

  // ── Populate cb with all module APIs ──────────────────────────────────────
  Object.assign(cb, filterAPI, tableAPI, detailAPI, {
    runCoaForIds, refreshActiveSessionMacs, updatePxGridSourceBadge,
  });

  // ── Sticky table header — size browse-table-wrap to viewport remainder ───
  function fitStickyTable() {
    const wrap       = container.querySelector(".browse-table-wrap");
    const pagination = container.querySelector(".pagination-bar");
    if (!wrap) return;
    wrap.style.height = "";                    // reset to measure natural layout

    // Row 1 (column names) sticks at top:0; row 2 (filter) sticks just below row 1.
    const thead  = wrap.querySelector("thead");
    const row1   = thead?.querySelector("tr:first-child");
    const row2   = thead?.querySelector("tr.filter-row");
    const row1H  = row1 ? row1.getBoundingClientRect().height : 33;
    if (row1) row1.querySelectorAll("th").forEach((th) => { th.style.top = "0px"; });
    if (row2) row2.querySelectorAll("th").forEach((th) => { th.style.top = row1H + "px"; });

    const wrapTop   = wrap.getBoundingClientRect().top;
    const paginH    = pagination ? pagination.getBoundingClientRect().height : 48;
    const available = window.innerHeight - wrapTop - paginH - 16;
    wrap.style.height = Math.max(200, available) + "px";
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  filterAPI.restoreFilters();
  tableAPI.applyColVis();

  startPxGridStream();
  updatePxGridSourceBadge();

  const badgeTickTimer = setInterval(updatePxGridSourceBadge, 5000);
  const cleanupObs = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      stopPxGridStream();
      clearInterval(badgeTickTimer);
      cleanupObs.disconnect();
      window.removeEventListener("resize", fitStickyTable);
    }
  });
  cleanupObs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", fitStickyTable);

  // force=true: poll altid MnT ved view-mount så auth-status er korrekt fra start.
  await tableAPI.load(true);
  fitStickyTable();
}
