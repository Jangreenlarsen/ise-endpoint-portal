import { api } from "../api.js";
import { toIseCsv, downloadCsv } from "../csv.js";

const FRONTEND_PREFS_KEY = "ise_portal_prefs";
function getPageSize() {
  try {
    const prefs = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    return prefs.pageSize || 100;
  } catch { return 100; }
}
function savePageSize(size) {
  try {
    const prefs = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    prefs.pageSize = size;
    localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}
function getCoaReauthOnSave() {
  try {
    const prefs = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    return !!prefs.coaReauthOnSave;
  } catch { return false; }
}
function setCoaReauthOnSave(enabled) {
  try {
    const prefs = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    prefs.coaReauthOnSave = !!enabled;
    localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

const BROWSE_FILTERS_KEY = "ise_portal_browse_filters";
function loadBrowseFilters() {
  try {
    return JSON.parse(localStorage.getItem(BROWSE_FILTERS_KEY) || "null");
  } catch { return null; }
}
function saveBrowseFilters(state) {
  try {
    localStorage.setItem(BROWSE_FILTERS_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function esc(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Column definitions: key = data field accessor, label = header text
const COLUMNS = [
  { key: "mac",            label: "MAC",            field: (r) => r.mac || r.name },
  { key: "vendor",         label: "Vendor",         field: (r) => r.vendor || "" },
  { key: "group_name",     label: "Identity Group", field: (r) => r.group_name },
  { key: "static_group",   label: "Tilknytning",    field: (r) => r.static_group ? "Statisk" : "Dynamisk" },
  { key: "description",    label: "Description",    field: (r) => r.description },
  { key: "endpoint_type",  label: "Type",           field: (r) => r.endpoint_type },
  { key: "owner",          label: "Owner",          field: (r) => r.owner },
  { key: "lokation",       label: "Lokation",       field: (r) => r.lokation },
  { key: "authz_vlan",     label: "AuthzVlan",      field: (r) => r.authz_vlan },
  { key: "authz_acl",      label: "AuthzACL",       field: (r) => r.authz_acl },
  { key: "platform_type",  label: "Platform",       field: (r) => r.platform_type },
  { key: "roles",          label: "Roller",         field: (r) => (r.roles || []).join(", ") },
];

const COLVIS_KEY = "ise_portal_browse_colvis";
function loadColVis() {
  try {
    const raw = localStorage.getItem(COLVIS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveColVis(state) {
  try { localStorage.setItem(COLVIS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export async function renderBrowse(container) {
  container.innerHTML = `
    <h2>Browse / Edit endpoints</h2>
    <div class="card">
      <div class="toolbar">
        <button id="refresh-btn">Refresh</button>
        <button id="export-btn" class="secondary">Export CSV</button>
        <button id="portal-filter-btn" class="secondary" title="Vis kun endpoints oprettet af HyperVision ISE Portal">Kun portal</button>
        <button id="coa-toggle-btn" class="secondary" title="Udløs CoA reauth på ISE efter hver gemt ændring">CoA reauth: FRA</button>
        <button id="save-all-btn" disabled title="Gem alle ændrede endpoints">Gem alle</button>
        <div class="server-filter"
             title="Server-side ERS filter på MAC — for Name/Description brug kolonnefilter-rækken nedenfor">
          <select id="filter-field" class="filter-field">
            <option value="mac">MAC</option>
          </select>
          <select id="filter-op" class="filter-op">
            <option value="CONTAINS">CONTAINS</option>
            <option value="EQ">EQ</option>
            <option value="NEQ">NEQ</option>
            <option value="STARTSW">STARTSW</option>
            <option value="ENDSW">ENDSW</option>
          </select>
          <input type="search" id="filter-value" class="mac-search filter-value"
                 placeholder="Værdi (server-side MAC)" autocomplete="off" />
        </div>
        <div class="spacer"></div>
        <div class="col-vis-wrap">
          <button id="col-vis-btn" class="secondary small" type="button"
                  title="Vis/skjul kolonner">Kolonner ▾</button>
          <div id="col-vis-menu" class="col-vis-menu hidden"></div>
        </div>
        <button id="bulk-edit-btn" class="secondary small" disabled>Rediger valgte</button>
        <button id="bulk-save-btn" class="small" disabled>Gem valgte</button>
        <button id="bulk-disconnect-btn" class="danger small" disabled
                title="CoA Disconnect — deautentificér valgte klienter på WLC/switch (tvinger ny DHCP ved re-associate)">Disconnect valgte</button>
        <button id="bulk-del-btn" class="danger small" disabled>Slet valgte</button>
        <span id="selection-count" class="hint"></span>
        <span id="pxgrid-source-badge" class="hint"
              title="Hvor auth-status kommer fra: pxGrid push (live) eller MnT pull (5-15s forsinkelse)"
              style="margin-left:auto; padding:2px 8px; border-radius:10px; font-size:0.8em; background:#e5e7eb; color:#374151;">
          ⚪ Auth-status: ukendt
        </span>
        <label class="hint page-size-label">Vis
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
      <div id="msg"></div>
      <div class="browse-table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="select-all" title="Vælg alle" /></th>
              ${COLUMNS.map((c) => `<th>${c.label}</th>`).join("")}
            </tr>
            <tr class="filter-row">
              <th></th>
              ${COLUMNS.map((c) => `
                <th>
                  <div class="col-filter">
                    <label class="col-filter-toggle" title="Aktivér filter for ${c.label}">
                      <input type="checkbox" class="col-filter-cb" data-col="${c.key}" />
                    </label>
                    <input type="text" class="col-filter-input" data-col="${c.key}"
                           placeholder="regex..." disabled />
                  </div>
                </th>`).join("")}
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="${COLUMNS.length + 2}" class="empty">Indlæser...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="pagination-bar" id="pagination-bar">
        <button id="page-prev" class="secondary small" disabled>&laquo; Forrige</button>
        <span id="page-info" class="hint"></span>
        <button id="page-next" class="secondary small" disabled>N\u00e6ste &raquo;</button>
      </div>
    </div>
    <div id="detail-overlay" class="modal-overlay hidden">
      <div class="modal detail-modal">
        <h3>Endpoint detaljer</h3>
        <div id="detail-msg"></div>
        <div class="detail-grid">
          <label>MAC</label><div class="detail-value" id="d-mac"></div>
          <label>Vendor</label><div class="detail-value" id="d-vendor"></div>
          <label>Name</label><div class="detail-value" id="d-name"></div>
          <label>ID</label><div class="detail-value mono" id="d-id"></div>
          <label>Identity Group</label>
          <select id="d-group"></select>
          <label>Tilknytning</label>
          <label class="inline-cb"><input type="checkbox" id="d-static-group" /> Statisk gruppetildeling</label>
          <label>Description</label>
          <input type="text" id="d-description" />
          <label>Type</label>
          <select id="d-type"></select>
          <label>Owner</label>
          <select id="d-owner"></select>
          <label>Lokation</label>
          <select id="d-lokation"></select>
          <label>AuthzVlan</label>
          <select id="d-authzvlan"></select>
          <label>AuthzACL</label>
          <select id="d-authzacl"></select>
          <label>Platform</label>
          <select id="d-platformtype"></select>
          <label>Roller</label>
          <div id="d-roles"></div>
          <label>HypervisionISEPortal</label>
          <div class="detail-value mono" id="d-hypervision"></div>
          <label>Profile ID</label>
          <div class="detail-value mono" id="d-profile-id"></div>
          <label>Static profile</label>
          <div class="detail-value" id="d-static-profile"></div>
          <label>Portal user</label>
          <div class="detail-value" id="d-portal-user"></div>
          <label>Identity store</label>
          <div class="detail-value" id="d-identity-store"></div>
        </div>
        <div class="modal-actions">
          <button id="d-save">Gem ændringer</button>
          <button id="d-disconnect" class="danger"
                  title="CoA Disconnect — deautentificér klienten på WLC/switch (tvinger ny DHCP ved re-associate)">Disconnect</button>
          <button id="d-close" class="secondary">Luk</button>
        </div>
      </div>
    </div>
    <div id="bulk-edit-overlay" class="modal-overlay hidden">
      <div class="modal">
        <h3>Rediger valgte endpoints</h3>
        <p class="hint" id="bulk-edit-count"></p>
        <div class="modal-body">
          <label><input type="checkbox" class="be-cb" data-field="group" /> Identity Group</label>
          <select id="be-group" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="description" /> Description</label>
          <input type="text" id="be-description" disabled />
          <label><input type="checkbox" class="be-cb" data-field="type" /> Type</label>
          <select id="be-type" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="owner" /> Owner</label>
          <select id="be-owner" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="lokation" /> Lokation</label>
          <select id="be-lokation" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="authzvlan" /> AuthzVlan</label>
          <select id="be-authzvlan" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="authzacl" /> AuthzACL</label>
          <select id="be-authzacl" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="platformtype" /> Platform</label>
          <select id="be-platformtype" disabled></select>
          <label><input type="checkbox" class="be-cb" data-field="roles" /> Roller</label>
          <div id="be-roles" class="be-roles-wrap disabled-overlay"></div>
        </div>
        <div class="modal-actions">
          <button id="be-apply">Anvend</button>
          <button id="be-cancel" class="secondary">Annuller</button>
        </div>
      </div>
    </div>
  `;

  const tbody = container.querySelector("#tbody");
  const msg = container.querySelector("#msg");
  const count = container.querySelector("#count");
  const selectionCount = container.querySelector("#selection-count");
  const portalFilterBtn = container.querySelector("#portal-filter-btn");
  const filterRow = container.querySelector(".filter-row");
  const selectAllCb = container.querySelector("#select-all");
  const bulkSaveBtn = container.querySelector("#bulk-save-btn");
  const bulkDelBtn = container.querySelector("#bulk-del-btn");
  const bulkDisconnectBtn = container.querySelector("#bulk-disconnect-btn");
  const saveAllBtn = container.querySelector("#save-all-btn");
  const bulkEditBtn = container.querySelector("#bulk-edit-btn");
  const bulkEditOverlay = container.querySelector("#bulk-edit-overlay");
  const coaToggleBtn = container.querySelector("#coa-toggle-btn");
  let coaOnSave = getCoaReauthOnSave();
  function renderCoaToggle() {
    coaToggleBtn.textContent = `CoA reauth: ${coaOnSave ? "TIL" : "FRA"}`;
    coaToggleBtn.classList.toggle("active-toggle", coaOnSave);
  }
  renderCoaToggle();
  coaToggleBtn.addEventListener("click", () => {
    coaOnSave = !coaOnSave;
    setCoaReauthOnSave(coaOnSave);
    renderCoaToggle();
  });

  // {localLabel: "reauth"|"disconnect"} — hentes fra PlatformType-mappingen.
  // Tomt fallback => alle CoA bliver reauth.
  let coaByLocal = new Map();

  // entries: [{ id, platformType }]. CoA-metoden vælges ud fra
  // platformType-labelens mapping (reauth eller disconnect). AireOS WLC
  // honorerer fx ikke CoA-Reauth pålideligt — der binder brugeren typisk
  // sit AireOS-label til "disconnect" i mapping-editoren.
  async function runCoaForIds(entries) {
    if (!coaOnSave || !entries.length) return { ok: 0, fail: 0, failures: [], disconnects: 0, reauths: 0 };
    let ok = 0;
    let fail = 0;
    let disconnects = 0;
    let reauths = 0;
    const failures = [];
    for (const e of entries) {
      const id = typeof e === "string" ? e : e.id;
      const platformType = (typeof e === "object" && e.platformType ? e.platformType : "");
      const useDisconnect = coaByLocal.get(platformType) === "disconnect";
      try {
        const res = useDisconnect ? await api.coaDisconnect(id) : await api.coaReauth(id);
        if (res?.ok) {
          ok++;
          if (useDisconnect) disconnects++; else reauths++;
        } else {
          fail++;
          failures.push({
            mac: res?.mac || id,
            msg: `${useDisconnect ? "disconnect" : "reauth"}: ${res?.message || "fejlede"}`,
          });
        }
      } catch (err) {
        fail++;
        failures.push({ mac: id, msg: err.message });
      }
    }
    return { ok, fail, failures, disconnects, reauths };
  }
  let allRows = [];           // rows on current page (paged mode) or ALL rows (filtered mode)
  let allRowsCache = null;    // cached full dataset when filters have been used
  // {MAC → "active"} hentet fra MnT når mindst ét filter er aktivt. Bruges
  // til at farve række-checkboxen grøn (aktiv session) eller rød (ingen).
  // Null = ikke hentet (intet filter / load ikke kørt endnu) → ingen farve.
  let activeSessionMacs = null;
  let groups = [];
  let caValues = { Type: [], Owner: [], Lokation: [], AuthzVlan: [], AuthzACL: [], PlatformType: [] };
  let roleCatalog = [];
  let canEditRoles = false;
  let portalOnly = false;
  const dirtyIds = new Set();
  let currentPage = 1;
  let currentSize = getPageSize();
  let totalEndpoints = 0;
  let filterMode = false;     // true = all data loaded, client-side filter+pagination
  let loadingAll = false;
  const pageSizeSelect = container.querySelector("#page-size-select");
  const pagePrev = container.querySelector("#page-prev");
  const pageNext = container.querySelector("#page-next");
  const pageInfo = container.querySelector("#page-info");
  const filterFieldSelect = container.querySelector("#filter-field");
  const filterOpSelect = container.querySelector("#filter-op");
  const filterValueInput = container.querySelector("#filter-value");
  let currentFilters = [];
  let searchDebounce = null;

  function buildServerFilters() {
    const value = filterValueInput.value.trim();
    if (!value) return [];
    const field = filterFieldSelect.value;
    const op = filterOpSelect.value;
    return [`${field}.${op}.${value}`];
  }
  pageSizeSelect.value = String(currentSize);

  // Column visibility — persistede pr. kolonne, default vis alt.
  const colVisBtn = container.querySelector("#col-vis-btn");
  const colVisMenu = container.querySelector("#col-vis-menu");
  let colVis = (() => {
    const saved = loadColVis() || {};
    const out = {};
    for (const c of COLUMNS) out[c.key] = saved[c.key] !== false;
    return out;
  })();

  function applyColVis() {
    const table = container.querySelector(".browse-table-wrap table");
    if (!table) return;
    COLUMNS.forEach((c, i) => {
      const visible = colVis[c.key] !== false;
      // +2 fordi første kolonne er checkbox (index 1 i nth-child)
      const nth = i + 2;
      table.querySelectorAll(`thead tr > th:nth-child(${nth})`).forEach((el) => {
        el.classList.toggle("col-hidden", !visible);
      });
      table.querySelectorAll(`tbody tr > td:nth-child(${nth})`).forEach((el) => {
        el.classList.toggle("col-hidden", !visible);
      });
    });
  }

  function renderColVisMenu() {
    colVisMenu.innerHTML = COLUMNS.map((c) => `
      <label class="col-vis-item">
        <input type="checkbox" class="col-vis-cb" data-col="${c.key}"
               ${colVis[c.key] !== false ? "checked" : ""} />
        ${esc(c.label)}
      </label>
    `).join("") + `
      <div class="col-vis-actions">
        <button type="button" class="small secondary" id="col-vis-all">Vis alle</button>
      </div>
    `;
    colVisMenu.querySelectorAll(".col-vis-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        colVis[cb.dataset.col] = cb.checked;
        saveColVis(colVis);
        applyColVis();
      });
    });
    const allBtn = colVisMenu.querySelector("#col-vis-all");
    if (allBtn) {
      allBtn.addEventListener("click", () => {
        for (const c of COLUMNS) colVis[c.key] = true;
        saveColVis(colVis);
        renderColVisMenu();
        applyColVis();
      });
    }
  }
  renderColVisMenu();

  colVisBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    colVisMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!colVisMenu.contains(e.target) && e.target !== colVisBtn) {
      colVisMenu.classList.add("hidden");
    }
  });

  function snapshotFilters() {
    const cols = [];
    filterRow.querySelectorAll(".col-filter-cb:checked").forEach((cb) => {
      const input = filterRow.querySelector(`.col-filter-input[data-col="${cb.dataset.col}"]`);
      cols.push({ col: cb.dataset.col, value: input ? input.value : "" });
    });
    return {
      portalOnly,
      server: {
        field: filterFieldSelect.value,
        op: filterOpSelect.value,
        value: filterValueInput.value,
      },
      cols,
    };
  }
  function persistFilters() {
    saveBrowseFilters(snapshotFilters());
  }
  function restoreFilters() {
    const s = loadBrowseFilters();
    if (!s) return;
    if (s.portalOnly) {
      portalOnly = true;
      portalFilterBtn.classList.add("active-toggle");
    }
    if (s.server) {
      if (s.server.field) filterFieldSelect.value = s.server.field;
      if (s.server.op) filterOpSelect.value = s.server.op;
      if (s.server.value) filterValueInput.value = s.server.value;
      currentFilters = buildServerFilters();
    }
    if (Array.isArray(s.cols)) {
      for (const { col, value } of s.cols) {
        const cb = filterRow.querySelector(`.col-filter-cb[data-col="${col}"]`);
        const input = filterRow.querySelector(`.col-filter-input[data-col="${col}"]`);
        if (cb && input) {
          cb.checked = true;
          input.disabled = false;
          input.value = value || "";
        }
      }
    }
  }

  function totalPages() {
    return Math.max(1, Math.ceil(totalEndpoints / currentSize));
  }

  function updatePaginationUI() {
    const tp = totalPages();
    pagePrev.disabled = currentPage <= 1;
    pageNext.disabled = currentPage >= tp;
    pageInfo.textContent = `Side ${currentPage} af ${tp} (${totalEndpoints} total)`;
  }

  async function enterFilterMode() {
    if (filterMode) return;  // already in filter mode
    if (loadingAll) return;  // already loading
    if (allRowsCache) {
      // Use cached full dataset
      allRows = allRowsCache;
      filterMode = true;
      currentPage = 1;
      return;
    }
    // Need to fetch all endpoints from backend
    loadingAll = true;
    const cols = COLUMNS.length + 2;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Henter alle endpoints fra ISE...</td></tr>`;
    msg.innerHTML = `<div class="alert info">Henter alle endpoints for at kunne filtrere på tværs af sider...</div>`;
    try {
      const all = await api.listAllEndpointDetails("", currentFilters);
      allRowsCache = all;
      allRows = all;
      filterMode = true;
      currentPage = 1;
      msg.innerHTML = "";
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke hente alle endpoints: ${err.message}</div>`;
    } finally {
      loadingAll = false;
    }
  }

  function exitFilterMode() {
    if (!filterMode) return;
    filterMode = false;
    currentPage = 1;
    load();
  }

  async function onFilterChange() {
    if (needsFilterMode()) {
      await enterFilterMode();
      await refreshActiveSessionMacs();
      applyFilter();
    } else {
      // No filters active — ryd auth-status og gå tilbage til server-side pagination
      activeSessionMacs = null;
      exitFilterMode();
    }
  }

  // Wire up filter checkboxes: enable/disable the corresponding input
  filterRow.querySelectorAll(".col-filter-cb").forEach((cb) => {
    const input = filterRow.querySelector(`.col-filter-input[data-col="${cb.dataset.col}"]`);
    cb.addEventListener("change", async () => {
      input.disabled = !cb.checked;
      if (!cb.checked) input.value = "";
      persistFilters();
      await onFilterChange();
      if (cb.checked) input.focus();
    });
  });
  filterRow.querySelectorAll(".col-filter-input").forEach((input) => {
    input.addEventListener("input", () => {
      persistFilters();
      if (filterMode) applyFilter();
    });
  });

  // Multi-select role chips. Catalog roles render as toggleable checkbox-chips
  // (kun admin/editor må toggle); roller udenfor kataloget — fx username-tags
  // fra registrar auto-tag — vises som disabled chips så de bevares ved save.
  function rolesChipsHtml(selected, opts = {}) {
    const editable = opts.editable !== false && canEditRoles;
    const sel = (selected || []).slice();
    const selLower = new Set(sel.map((s) => (s || "").toLowerCase()));
    const catalogLower = new Set(roleCatalog.map((r) => r.name.toLowerCase()));
    const items = [];
    for (const r of roleCatalog) {
      const checked = selLower.has(r.name.toLowerCase()) ? "checked" : "";
      const dis = editable ? "" : "disabled";
      items.push(
        `<label class="role-chip" title="${esc(r.description || r.name)}">` +
        `<input type="checkbox" class="row-role-chip" data-role="${esc(r.name)}" ${checked} ${dis} />` +
        `<span>${esc(r.name)}</span></label>`,
      );
    }
    for (const r of sel) {
      if (!catalogLower.has(r.toLowerCase())) {
        items.push(
          `<span class="role-chip role-chip-extern" title="Bruger-tag eller rolle uden for katalog">` +
          `${esc(r)}</span>`,
        );
      }
    }
    if (!items.length) return `<span class="hint">—</span>`;
    return `<div class="role-chips">${items.join("")}</div>`;
  }

  function optionsHtml(values, selected) {
    const opts = [`<option value="">—</option>`];
    for (const v of values) {
      const sel = v === selected ? " selected" : "";
      opts.push(`<option value="${esc(v)}"${sel}>${esc(v)}</option>`);
    }
    return opts.join("");
  }

  function groupOptionsHtml(selectedId) {
    const opts = [`<option value="">— ingen —</option>`];
    for (const g of groups) {
      const sel = g.id === selectedId ? " selected" : "";
      opts.push(`<option value="${esc(g.id)}"${sel}>${esc(g.name)}</option>`);
    }
    return opts.join("");
  }

  function getColumnFilters() {
    const activeFilters = [];
    filterRow.querySelectorAll(".col-filter-cb:checked").forEach((cb) => {
      const col = cb.dataset.col;
      const input = filterRow.querySelector(`.col-filter-input[data-col="${col}"]`);
      const q = (input.value || "").trim();
      if (q) {
        const colDef = COLUMNS.find((c) => c.key === col);
        if (colDef) {
          try {
            const re = new RegExp(q, "i");
            activeFilters.push({ field: colDef.field, re });
          } catch {
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            activeFilters.push({ field: colDef.field, re: new RegExp(escaped, "i") });
          }
        }
      }
    });
    return activeFilters;
  }

  function needsFilterMode() {
    // Any column filter checkbox checked (even without text yet) or portal toggle on
    return portalOnly || filterRow.querySelector(".col-filter-cb:checked") !== null;
  }

  function anyFilterActive() {
    // Server-side MAC-filter tæller også — uden for filterMode betyder det
    // at antallet af rækker er begrænset, så auth-status må gerne hentes.
    return needsFilterMode() || currentFilters.length > 0;
  }

  function normalizeMac(s) {
    return (s || "").replace(/-/g, ":").trim().toUpperCase();
  }

  async function refreshActiveSessionMacs() {
    // Phase 3 (3.5.0): når pxGrid SSE-stream er live har vi allerede fresh
    // data — vis altid auth-status farver, uafhængigt af filter (SSE-data
    // kostede ikke noget ekstra ISE-kald). MnT-polden kun for at skåne ISE
    // ved store unfiltered datasets.
    if (pxgridLive && pxgridSessionMacs) {
      activeSessionMacs = new Set(pxgridSessionMacs);
      return;
    }
    if (!anyFilterActive()) {
      activeSessionMacs = null;
      return;
    }
    try {
      const list = await api.listActiveSessionMacs();
      activeSessionMacs = new Set((list || []).map(normalizeMac));
    } catch (err) {
      console.warn("Kunne ikke hente aktive sessioner fra MnT:", err.message);
      activeSessionMacs = null;
    }
  }

  // Push/pull-indikator + last-event tidsstempel.
  let pxgridLastEventTs = 0;
  function updatePxGridSourceBadge() {
    const el = container.querySelector("#pxgrid-source-badge");
    if (!el) return;
    if (pxgridLive && pxgridSessionMacs) {
      const ago = pxgridLastEventTs
        ? Math.max(0, Math.floor(Date.now() / 1000 - pxgridLastEventTs))
        : null;
      const agoStr = ago === null ? "—"
        : ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.floor(ago/60)}m` : `${Math.floor(ago/3600)}t`;
      el.textContent = `🟢 Auth-status: PUSH (pxGrid · ${pxgridSessionMacs.size} aktive · sidste event ${agoStr} siden)`;
      el.style.background = "#dcfce7";
      el.style.color = "#166534";
    } else if (activeSessionMacs) {
      el.textContent = `🟡 Auth-status: PULL (MnT-poll · ${activeSessionMacs.size} aktive)`;
      el.style.background = "#fef3c7";
      el.style.color = "#92400e";
    } else {
      el.textContent = "⚪ Auth-status: inaktiv (intet filter + pxGrid offline)";
      el.style.background = "#e5e7eb";
      el.style.color = "#374151";
    }
  }

  // ── PxGrid SSE-stream (3.5.0) ────────────────────────────────────────
  // EventSource der lytter på /api/pxgrid/sessions/stream og holder en
  // live MAC-set opdateret. Hvis stream'en virker bruger refreshActiveSessionMacs
  // den i stedet for at polle MnT. Auto-reconnect indbygget i EventSource.
  let pxgridEventSource = null;
  let pxgridLive = false;
  let pxgridSessionMacs = null;  // Set<MAC> eller null hvis ikke streamer

  function startPxGridStream() {
    if (pxgridEventSource) return;
    const token = (window.localStorage && localStorage.getItem("hv_ise_token")) || "";
    if (!token) return;
    const base = window.location.origin.startsWith("file://")
      ? "http://localhost:8000" : "";
    try {
      pxgridEventSource = new EventSource(
        `${base}/api/pxgrid/sessions/stream?token=${encodeURIComponent(token)}`
      );
    } catch (err) {
      console.warn("EventSource opsætning fejlede:", err);
      return;
    }
    pxgridEventSource.addEventListener("snapshot", (e) => {
      try {
        const data = JSON.parse(e.data);
        pxgridSessionMacs = new Set((data.sessions || []).map(s => normalizeMac(s.mac)));
        pxgridLive = true;
        pxgridLastEventTs = Math.floor(Date.now() / 1000);
        activeSessionMacs = new Set(pxgridSessionMacs);
        applyAuthStatusColors();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("upsert", (e) => {
      try {
        const data = JSON.parse(e.data);
        const mac = normalizeMac(data.mac);
        if (!mac) return;
        if (!pxgridSessionMacs) pxgridSessionMacs = new Set();
        pxgridSessionMacs.add(mac);
        pxgridLastEventTs = data.ts || Math.floor(Date.now() / 1000);
        if (!activeSessionMacs) activeSessionMacs = new Set();
        activeSessionMacs.add(mac);
        applyAuthStatusColors();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("remove", (e) => {
      try {
        const data = JSON.parse(e.data);
        const mac = normalizeMac(data.mac);
        if (pxgridSessionMacs) pxgridSessionMacs.delete(mac);
        pxgridLastEventTs = data.ts || Math.floor(Date.now() / 1000);
        if (activeSessionMacs) activeSessionMacs.delete(mac);
        applyAuthStatusColors();
        updatePxGridSourceBadge();
      } catch {}
    });
    pxgridEventSource.addEventListener("clear", () => {
      if (pxgridSessionMacs) pxgridSessionMacs.clear();
      if (activeSessionMacs) activeSessionMacs.clear();
      applyAuthStatusColors();
      updatePxGridSourceBadge();
    });
    pxgridEventSource.onerror = () => {
      pxgridLive = false;
      updatePxGridSourceBadge();
    };
    pxgridEventSource.onopen = () => {
      pxgridLive = true;
      updatePxGridSourceBadge();
    };
  }

  function stopPxGridStream() {
    if (pxgridEventSource) {
      pxgridEventSource.close();
      pxgridEventSource = null;
    }
    pxgridLive = false;
    pxgridSessionMacs = null;
  }

  // Start stream'en proaktivt — hvis pxGrid er disabled returnerer endpoint'et
  // 401/snapshot vil være tom, og vi falder tilbage til MnT uden brugeren
  // mærker noget. Cleanup når view skiftes:
  startPxGridStream();
  updatePxGridSourceBadge();
  // Tæl "sidste event N siden" op live så badge ikke ser fastfrosset ud.
  const badgeTickTimer = setInterval(updatePxGridSourceBadge, 5000);
  const cleanupObs = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      stopPxGridStream();
      clearInterval(badgeTickTimer);
      cleanupObs.disconnect();
    }
  });
  cleanupObs.observe(document.body, { childList: true, subtree: true });

  function applyAuthStatusColors() {
    const rows = tbody.querySelectorAll("tr[data-id]");
    rows.forEach((tr) => {
      const cb = tr.querySelector(".row-select");
      if (!cb) return;
      cb.classList.remove("auth-active", "auth-failed");
      if (!activeSessionMacs) return;
      const macCell = tr.querySelector(".mac-cell");
      const mac = normalizeMac(macCell ? macCell.textContent : "");
      if (!mac) return;
      if (activeSessionMacs.has(mac)) {
        cb.classList.add("auth-active");
      } else {
        cb.classList.add("auth-failed");
      }
    });
  }

  function applyFiltersToRows(rows) {
    if (portalOnly) {
      rows = rows.filter((r) => r.hypervision === "true");
    }
    const filters = getColumnFilters();
    if (filters.length) {
      rows = rows.filter((r) => filters.every((f) => f.re.test(f.field(r) || "")));
    }
    return rows;
  }

  function hasActiveFilterText() {
    return Array.from(filterRow.querySelectorAll(".col-filter-input")).some(
      (i) => !i.disabled && i.value.trim(),
    );
  }

  function getSelectedIds() {
    return Array.from(tbody.querySelectorAll(".row-select:checked")).map(
      (cb) => cb.closest("tr").dataset.id,
    );
  }

  function updateDirtyUI() {
    saveAllBtn.disabled = dirtyIds.size === 0;
    const label = dirtyIds.size ? `Gem alle (${dirtyIds.size})` : "Gem alle";
    saveAllBtn.textContent = label;
  }

  function markDirty(tr) {
    const id = tr.dataset.id;
    if (!id) return;
    dirtyIds.add(id);
    tr.classList.add("dirty");
    // Auto-select the row så bulk-handlinger (Gem valgte / Disconnect valgte)
    // automatisk inkluderer den ændrede række — sparer brugeren et klik.
    const cb = tr.querySelector(".row-select");
    if (cb && !cb.checked) {
      cb.checked = true;
      updateSelectionUI();
    }
    updateDirtyUI();
  }

  function updateSelectionUI() {
    const selected = getSelectedIds();
    const hasSelection = selected.length > 0;
    bulkSaveBtn.disabled = !hasSelection;
    bulkDelBtn.disabled = !hasSelection;
    bulkDisconnectBtn.disabled = !hasSelection;
    bulkEditBtn.disabled = !hasSelection;
    selectionCount.textContent = hasSelection ? `${selected.length} valgt` : "";

    // sync select-all state
    const allCbs = tbody.querySelectorAll(".row-select");
    if (allCbs.length && selected.length === allCbs.length) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else if (selected.length > 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
  }

  function renderRows(rows) {
    const cols = COLUMNS.length + 2;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Ingen resultater</td></tr>`;
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr data-id="${esc(r.id)}"${dirtyIds.has(r.id) ? ' class="dirty"' : ''}>
        <td class="select-cell"><input type="checkbox" class="row-select" /></td>
        <td class="mac-cell"><a href="#" class="mac-link" title="Vis detaljer">${esc(r.mac || r.name)}</a></td>
        <td class="vendor-cell-td">${esc(r.vendor || "")}</td>
        <td><select class="grp-select">${groupOptionsHtml(r.group_id)}</select></td>
        <td class="assign-cell">${r.static_group ? "Statisk" : "Dynamisk"}</td>
        <td><input type="text" class="desc-input" value="${esc(r.description || "")}" /></td>
        <td><select class="ca-type">${optionsHtml(caValues.Type, r.endpoint_type)}</select></td>
        <td><select class="ca-owner">${optionsHtml(caValues.Owner, r.owner)}</select></td>
        <td><select class="ca-lokation">${optionsHtml(caValues.Lokation, r.lokation)}</select></td>
        <td><select class="ca-authzvlan">${optionsHtml(caValues.AuthzVlan, r.authz_vlan)}</select></td>
        <td><select class="ca-authzacl">${optionsHtml(caValues.AuthzACL, r.authz_acl)}</select></td>
        <td><select class="ca-platformtype">${optionsHtml(caValues.PlatformType, r.platform_type)}</select></td>
        <td class="roles-cell">${rolesChipsHtml(r.roles)}</td>
      </tr>
    `).join("");
    updateSelectionUI();
    updateDirtyUI();
    applyColVis();
    applyAuthStatusColors();
  }

  function applyFilter() {
    if (filterMode) {
      // Client-side filter + pagination on full dataset
      const filtered = applyFiltersToRows(allRows);
      totalEndpoints = filtered.length;
      // Clamp currentPage
      const tp = totalPages();
      if (currentPage > tp) currentPage = tp;
      // Slice for current page
      const start = (currentPage - 1) * currentSize;
      const pageRows = filtered.slice(start, start + currentSize);
      renderRows(pageRows);
      updatePaginationUI();
      if (hasActiveFilterText() || portalOnly) {
        count.textContent = `${filtered.length} / ${allRows.length} endpoints (filtreret)`;
      } else {
        count.textContent = `${allRows.length} endpoints`;
      }
    } else {
      // Server-side pagination — allRows is already just one page
      renderRows(allRows);
      updatePaginationUI();
      count.textContent = `${allRows.length} / ${totalEndpoints} endpoints`;
    }
  }

  async function load() {
    const cols = COLUMNS.length + 2;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Henter detaljer fra ISE...</td></tr>`;
    msg.innerHTML = "";
    dirtyIds.clear();
    updateDirtyUI();
    // Reset filter mode — Refresh always starts fresh
    filterMode = false;
    allRowsCache = null;
    try {
      const [caData, grps, result, dacls, mapping, roles, me] = await Promise.all([
        api.listCustomAttributes(),
        api.listGroups(),
        api.listEndpointDetails(currentPage, currentSize, "", currentFilters),
        api.listDacls().catch(() => []),
        api.getPlatformMapping().catch(() => ({ mappings: [] })),
        api.listEndpointRoles().catch(() => ({ roles: [] })),
        api.authMe().catch(() => null),
      ]);
      groups = grps;
      roleCatalog = (roles && Array.isArray(roles.roles)) ? roles.roles : [];
      canEditRoles = !!me && (me.role === "admin" || me.role === "editor");
      for (const a of caData.attributes) {
        if (a.name in caValues) caValues[a.name] = a.values;
      }
      // AuthzACL dropdown is sourced live from ISE DACLs (not the local store)
      caValues.AuthzACL = (dacls || []).map((d) => d.name).filter(Boolean).sort();
      // Build {local: coa} lookup for CoA dispatch (disconnect vs reauth)
      coaByLocal = new Map(
        (mapping.mappings || [])
          .filter((m) => m.local)
          .map((m) => [m.local, m.coa || "reauth"]),
      );
      allRows = result.items;
      totalEndpoints = result.total;

      // If filters are active, immediately switch to filter mode
      if (needsFilterMode()) {
        await enterFilterMode();
      }

      // Hent MnT auth-status kun når et filter er aktivt — undgår et MnT-kald
      // pr. load når man browser alle endpoints uden filter.
      await refreshActiveSessionMacs();

      applyFilter();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      tbody.innerHTML = "";
    }
  }

  // Portal-only toggle
  portalFilterBtn.addEventListener("click", async () => {
    portalOnly = !portalOnly;
    portalFilterBtn.classList.toggle("active-toggle", portalOnly);
    persistFilters();
    await onFilterChange();
  });

  // Checkbox: select-all toggle
  selectAllCb.addEventListener("change", () => {
    const checked = selectAllCb.checked;
    tbody.querySelectorAll(".row-select").forEach((cb) => { cb.checked = checked; });
    updateSelectionUI();
  });

  // Checkbox: individual row toggle
  tbody.addEventListener("change", (e) => {
    if (e.target.classList.contains("row-select")) {
      updateSelectionUI();
      return;
    }
    // Mark row dirty on select/dropdown change
    const tr = e.target.closest("tr");
    if (tr && (e.target.matches("select") || e.target.matches("input:not(.row-select)"))) {
      markDirty(tr);
    }
  });

  // Mark row dirty on text input
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr");
    if (tr && e.target.matches("input:not(.row-select)")) {
      markDirty(tr);
    }
  });

  // Build save payload for a single table row
  function buildSavePayload(tr) {
    const id = tr.dataset.id;
    const description = tr.querySelector(".desc-input").value;
    const selectedGroupId = tr.querySelector(".grp-select").value;
    const endpointType = tr.querySelector(".ca-type").value;
    const owner = tr.querySelector(".ca-owner").value;
    const lokation = tr.querySelector(".ca-lokation").value;
    const authzVlan = tr.querySelector(".ca-authzvlan").value;
    const authzAcl = tr.querySelector(".ca-authzacl").value;
    const platformType = tr.querySelector(".ca-platformtype").value;

    const row = allRows.find((r) => r.id === id);
    const originalGroupId = row ? (row.group_id || "") : "";
    const groupChanged = selectedGroupId !== originalGroupId;

    // Saml roller: katalog-chips fra UI + eksterne roller (fx username-tags)
    // som ikke er i kataloget bevares uændret. Bagsiden auto-tagger ikke når
    // CSV ikke er tom, så vi sender den fulde liste.
    const checkedChips = tr.querySelectorAll(".row-role-chip:checked");
    const selectedCatalogRoles = Array.from(checkedChips).map((cb) => cb.dataset.role);
    const catalogLower = new Set(roleCatalog.map((c) => c.name.toLowerCase()));
    const externalRoles = ((row && row.roles) || []).filter(
      (r) => !catalogLower.has((r || "").toLowerCase()),
    );
    const hypervisionRoles = [...externalRoles, ...selectedCatalogRoles].join(",");

    let group_id = null;
    let static_group_assignment = null;
    if (groupChanged) {
      if (!selectedGroupId) {
        const unknownGroup = groups.find(
          (g) => g.name.toLowerCase() === "unknown",
        );
        if (unknownGroup) {
          group_id = unknownGroup.id;
          static_group_assignment = false;
        }
      } else {
        group_id = selectedGroupId;
      }
    }

    return {
      id,
      mac: tr.querySelector(".mac-cell").textContent,
      payload: {
        description,
        group_id,
        static_group_assignment,
        custom_attributes: {
          Type: endpointType,
          Owner: owner,
          Lokation: lokation,
          AuthzVlan: authzVlan,
          AuthzACL: authzAcl,
          PlatformType: platformType,
          HypervisionRoles: hypervisionRoles,
        },
      },
      localUpdate: { description, group_id, static_group_assignment, groupChanged, endpointType, owner, lokation, authzVlan, authzAcl, platformType },
      platformType,
    };
  }

  function coaSummaryText(coa) {
    const bits = [];
    if (coa.reauths) bits.push(`${coa.reauths} reauth`);
    if (coa.disconnects) bits.push(`${coa.disconnects} disconnect (AireOS)`);
    const okPart = bits.length ? bits.join(" + ") : `${coa.ok} ok`;
    return `, CoA: ${okPart}${coa.fail ? `, ${coa.fail} fejl` : ""}`;
  }

  // Save all dirty rows
  saveAllBtn.addEventListener("click", async () => {
    if (!dirtyIds.size) return;
    saveAllBtn.disabled = true;
    const ids = [...dirtyIds];
    msg.innerHTML = `<div class="alert info">Gemmer ${ids.length} ændrede endpoints...</div>`;
    let ok = 0;
    let fail = 0;
    const savedEntries = [];
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { payload, platformType } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        dirtyIds.delete(id);
        savedEntries.push({ id, platformType });
        ok++;
      } catch {
        fail++;
      }
    }
    let coaSummary = "";
    if (coaOnSave && savedEntries.length) {
      msg.innerHTML = `<div class="alert info">Udløser CoA for ${savedEntries.length} endpoints...</div>`;
      const coa = await runCoaForIds(savedEntries);
      coaSummary = coaSummaryText(coa);
    }
    await load();
    const parts = [];
    if (ok) parts.push(`${ok} gemt`);
    if (fail) parts.push(`${fail} fejlede`);
    const cls = fail ? "error" : "success";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}${coaSummary}</div>`;
  });

  // Bulk save selected
  bulkSaveBtn.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    bulkSaveBtn.disabled = true;
    msg.innerHTML = `<div class="alert info">Gemmer ${ids.length} endpoints...</div>`;
    let ok = 0;
    let fail = 0;
    const savedEntries = [];
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { payload, platformType } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        dirtyIds.delete(id);
        savedEntries.push({ id, platformType });
        ok++;
      } catch {
        fail++;
      }
    }
    let coaSummary = "";
    if (coaOnSave && savedEntries.length) {
      msg.innerHTML = `<div class="alert info">Udløser CoA for ${savedEntries.length} endpoints...</div>`;
      const coa = await runCoaForIds(savedEntries);
      coaSummary = coaSummaryText(coa);
    }
    await load();
    const parts = [];
    if (ok) parts.push(`${ok} gemt`);
    if (fail) parts.push(`${fail} fejlede`);
    const cls = fail ? "error" : "success";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}${coaSummary}</div>`;
  });

  // Bulk delete
  bulkDelBtn.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const macs = ids.map((id) => {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      return tr ? tr.querySelector(".mac-cell").textContent : id;
    });
    if (!confirm(`Slet ${ids.length} endpoints?\n\n${macs.join("\n")}`)) return;
    bulkDelBtn.disabled = true;
    msg.innerHTML = `<div class="alert info">Sletter ${ids.length} endpoints...</div>`;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await api.deleteEndpoint(id);
        allRows = allRows.filter((r) => r.id !== id);
        if (allRowsCache) allRowsCache = allRowsCache.filter((r) => r.id !== id);
        ok++;
      } catch {
        fail++;
      }
    }
    applyFilter();
    const parts = [];
    if (ok) parts.push(`${ok} slettet`);
    if (fail) parts.push(`${fail} fejlede`);
    const cls = fail ? "error" : "success";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}</div>`;
    bulkDelBtn.disabled = false;
  });

  bulkDisconnectBtn.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const macs = ids.map((id) => {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      return tr ? tr.querySelector(".mac-cell").textContent : id;
    });
    if (!confirm(
      `CoA Disconnect ${ids.length} klient(er)?\n\n` +
      `${macs.join("\n")}\n\n` +
      `De bliver deautentificeret på WLC/switch og skal gen-associere. ` +
      `Ny IP kun hvis VLAN/subnet er ændret eller DHCP-lease er udløbet.`,
    )) return;
    bulkDisconnectBtn.disabled = true;
    msg.innerHTML = `<div class="alert info">Sender CoA Disconnect til ${ids.length} klient(er)...</div>`;
    let ok = 0;
    let fail = 0;
    const failures = [];
    for (const id of ids) {
      try {
        const res = await api.coaDisconnect(id);
        if (res?.ok) ok++;
        else {
          fail++;
          failures.push(`${res?.mac || id}: ${res?.message || "fejlede"}`);
        }
      } catch (err) {
        fail++;
        failures.push(`${id}: ${err.message}`);
      }
    }
    const parts = [];
    if (ok) parts.push(`${ok} disconnected`);
    if (fail) parts.push(`${fail} fejlede`);
    const cls = fail ? (ok ? "info" : "error") : "success";
    const detail = failures.length ? `<br><small>${failures.slice(0, 5).map(esc).join("<br>")}</small>` : "";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}${detail}</div>`;
    bulkDisconnectBtn.disabled = false;
  });

  // Bulk edit modal
  bulkEditBtn.addEventListener("click", () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    container.querySelector("#bulk-edit-count").textContent = `${ids.length} endpoints valgt`;
    // Populate dropdowns
    container.querySelector("#be-group").innerHTML = groupOptionsHtml("");
    container.querySelector("#be-type").innerHTML = optionsHtml(caValues.Type, "");
    container.querySelector("#be-owner").innerHTML = optionsHtml(caValues.Owner, "");
    container.querySelector("#be-lokation").innerHTML = optionsHtml(caValues.Lokation, "");
    container.querySelector("#be-authzvlan").innerHTML = optionsHtml(caValues.AuthzVlan, "");
    container.querySelector("#be-authzacl").innerHTML = optionsHtml(caValues.AuthzACL, "");
    container.querySelector("#be-platformtype").innerHTML = optionsHtml(caValues.PlatformType, "");
    container.querySelector("#be-roles").innerHTML = rolesChipsHtml([], { editable: true });
    container.querySelector("#be-description").value = "";
    // Reset checkboxes
    bulkEditOverlay.querySelectorAll(".be-cb").forEach((cb) => {
      cb.checked = false;
      const field = cb.dataset.field;
      const ctrl = bulkEditOverlay.querySelector(`#be-${field}`);
      if (!ctrl) return;
      if (ctrl.tagName === "DIV") {
        ctrl.classList.add("disabled-overlay");
      } else {
        ctrl.disabled = true;
      }
    });
    bulkEditOverlay.classList.remove("hidden");
  });

  // Toggle enable/disable per field in bulk edit
  bulkEditOverlay.querySelectorAll(".be-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const ctrl = bulkEditOverlay.querySelector(`#be-${cb.dataset.field}`);
      if (!ctrl) return;
      if (ctrl.tagName === "DIV") {
        ctrl.classList.toggle("disabled-overlay", !cb.checked);
      } else {
        ctrl.disabled = !cb.checked;
      }
    });
  });

  container.querySelector("#be-cancel").addEventListener("click", () => {
    bulkEditOverlay.classList.add("hidden");
  });

  container.querySelector("#be-apply").addEventListener("click", () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const fields = {};
    bulkEditOverlay.querySelectorAll(".be-cb:checked").forEach((cb) => {
      const field = cb.dataset.field;
      if (field === "roles") {
        const chips = bulkEditOverlay.querySelectorAll("#be-roles .row-role-chip:checked");
        fields.roles = Array.from(chips).map((c) => c.dataset.role);
        return;
      }
      const ctrl = bulkEditOverlay.querySelector(`#be-${field}`);
      if (ctrl) fields[field] = ctrl.value;
    });
    if (!Object.keys(fields).length) {
      bulkEditOverlay.classList.add("hidden");
      return;
    }
    // Apply values to selected rows in the table
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      if ("group" in fields) tr.querySelector(".grp-select").value = fields.group;
      if ("description" in fields) tr.querySelector(".desc-input").value = fields.description;
      if ("type" in fields) tr.querySelector(".ca-type").value = fields.type;
      if ("owner" in fields) tr.querySelector(".ca-owner").value = fields.owner;
      if ("lokation" in fields) tr.querySelector(".ca-lokation").value = fields.lokation;
      if ("authzvlan" in fields) tr.querySelector(".ca-authzvlan").value = fields.authzvlan;
      if ("authzacl" in fields) tr.querySelector(".ca-authzacl").value = fields.authzacl;
      if ("platformtype" in fields) tr.querySelector(".ca-platformtype").value = fields.platformtype;
      if ("roles" in fields) {
        const row = allRows.find((r) => r.id === id);
        const catalogLower = new Set(roleCatalog.map((c) => c.name.toLowerCase()));
        const externalRoles = ((row && row.roles) || []).filter(
          (r) => !catalogLower.has((r || "").toLowerCase()),
        );
        const newRoles = [...externalRoles, ...fields.roles];
        const cell = tr.querySelector(".roles-cell");
        if (cell) cell.innerHTML = rolesChipsHtml(newRoles);
      }
      markDirty(tr);
    }
    bulkEditOverlay.classList.add("hidden");
    msg.innerHTML = `<div class="alert info">${ids.length} endpoints opdateret lokalt — tryk "Gem alle" eller "Gem valgte" for at gemme til ISE.</div>`;
  });

  pagePrev.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      if (filterMode) { applyFilter(); } else { load(); }
    }
  });
  pageNext.addEventListener("click", () => {
    if (currentPage < totalPages()) {
      currentPage++;
      if (filterMode) { applyFilter(); } else { load(); }
    }
  });
  pageSizeSelect.addEventListener("change", () => {
    currentSize = parseInt(pageSizeSelect.value, 10);
    savePageSize(currentSize);
    currentPage = 1;
    if (filterMode) { applyFilter(); } else { load(); }
  });

  container.querySelector("#refresh-btn").addEventListener("click", load);

  function triggerFilterChange(immediate = false) {
    if (searchDebounce) clearTimeout(searchDebounce);
    const fire = () => {
      const next = buildServerFilters();
      const nextKey = next.join("|");
      const curKey = currentFilters.join("|");
      if (nextKey === curKey) return;
      currentFilters = next;
      currentPage = 1;
      load();
    };
    if (immediate) fire();
    else searchDebounce = setTimeout(fire, 400);
  }
  filterValueInput.addEventListener("input", () => { persistFilters(); triggerFilterChange(false); });
  filterFieldSelect.addEventListener("change", () => { persistFilters(); triggerFilterChange(true); });
  filterOpSelect.addEventListener("change", () => { persistFilters(); triggerFilterChange(true); });

  // Endpoint detail modal
  const detailOverlay = container.querySelector("#detail-overlay");
  const detailMsg = container.querySelector("#detail-msg");
  let detailCurrentId = null;
  let detailOriginalGroupId = "";

  async function openDetail(id) {
    detailCurrentId = id;
    detailMsg.innerHTML = `<div class="alert info">Henter fra ISE...</div>`;
    detailOverlay.classList.remove("hidden");
    try {
      const d = await api.getEndpoint(id);
      detailOriginalGroupId = d.group_id || "";
      container.querySelector("#d-mac").textContent = d.mac || d.name || "";
      container.querySelector("#d-vendor").textContent = d.vendor || "—";
      container.querySelector("#d-name").textContent = d.name || "";
      container.querySelector("#d-id").textContent = d.id || "";
      container.querySelector("#d-group").innerHTML = groupOptionsHtml(d.group_id);
      container.querySelector("#d-static-group").checked = !!d.static_group;
      container.querySelector("#d-description").value = d.description || "";
      container.querySelector("#d-type").innerHTML = optionsHtml(caValues.Type, d.endpoint_type);
      container.querySelector("#d-owner").innerHTML = optionsHtml(caValues.Owner, d.owner);
      container.querySelector("#d-lokation").innerHTML = optionsHtml(caValues.Lokation, d.lokation);
      container.querySelector("#d-authzvlan").innerHTML = optionsHtml(caValues.AuthzVlan, d.authz_vlan);
      container.querySelector("#d-authzacl").innerHTML = optionsHtml(caValues.AuthzACL, d.authz_acl);
      container.querySelector("#d-platformtype").innerHTML = optionsHtml(caValues.PlatformType, d.platform_type);
      container.querySelector("#d-roles").innerHTML = rolesChipsHtml(d.roles);
      container.querySelector("#d-roles").dataset.original = JSON.stringify(d.roles || []);
      container.querySelector("#d-hypervision").textContent = d.hypervision || "—";
      container.querySelector("#d-profile-id").textContent = d.profile_id || "—";
      container.querySelector("#d-static-profile").textContent = d.static_profile ? "Ja" : "Nej";
      container.querySelector("#d-portal-user").textContent = d.portal_user || "—";
      const store = [d.identity_store, d.identity_store_id].filter(Boolean).join(" / ");
      container.querySelector("#d-identity-store").textContent = store || "—";
      detailMsg.innerHTML = "";
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Kunne ikke hente: ${err.message}</div>`;
    }
  }

  function closeDetail() {
    detailOverlay.classList.add("hidden");
    detailCurrentId = null;
    detailMsg.innerHTML = "";
  }

  tbody.addEventListener("click", (e) => {
    const link = e.target.closest(".mac-link");
    if (!link) return;
    e.preventDefault();
    const tr = link.closest("tr");
    if (tr && tr.dataset.id) openDetail(tr.dataset.id);
  });

  container.querySelector("#d-close").addEventListener("click", closeDetail);
  detailOverlay.addEventListener("click", (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  container.querySelector("#d-disconnect").addEventListener("click", async () => {
    if (!detailCurrentId) return;
    const mac = container.querySelector("#d-mac").textContent || "";
    if (!confirm(
      `CoA Disconnect ${mac}?\n\n` +
      `Klienten bliver deautentificeret på WLC/switch og skal gen-associere. ` +
      `Ny IP kun hvis VLAN/subnet er ændret eller DHCP-lease er udløbet.`,
    )) return;
    const btn = container.querySelector("#d-disconnect");
    btn.disabled = true;
    detailMsg.innerHTML = `<div class="alert info">Sender CoA Disconnect...</div>`;
    try {
      const res = await api.coaDisconnect(detailCurrentId);
      if (res?.ok) {
        detailMsg.innerHTML = `<div class="alert success">Disconnect sendt: ${esc(res.message || "OK")}</div>`;
      } else {
        detailMsg.innerHTML = `<div class="alert error">Disconnect fejlede: ${esc(res?.message || "ukendt fejl")}</div>`;
      }
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Disconnect fejlede: ${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector("#d-save").addEventListener("click", async () => {
    if (!detailCurrentId) return;
    const saveBtn = container.querySelector("#d-save");
    saveBtn.disabled = true;
    detailMsg.innerHTML = `<div class="alert info">Gemmer...</div>`;
    const selectedGroupId = container.querySelector("#d-group").value;
    const staticGroup = container.querySelector("#d-static-group").checked;
    const groupChanged = selectedGroupId !== detailOriginalGroupId;
    let group_id = null;
    let static_group_assignment = null;
    if (groupChanged) {
      if (!selectedGroupId) {
        const unknownGroup = groups.find((g) => g.name.toLowerCase() === "unknown");
        if (unknownGroup) {
          group_id = unknownGroup.id;
          static_group_assignment = false;
        }
      } else {
        group_id = selectedGroupId;
        static_group_assignment = staticGroup;
      }
    } else if (selectedGroupId) {
      static_group_assignment = staticGroup;
    }
    const dRolesEl = container.querySelector("#d-roles");
    const checkedChips = dRolesEl.querySelectorAll(".row-role-chip:checked");
    const selectedCatalogRoles = Array.from(checkedChips).map((cb) => cb.dataset.role);
    let originalRoles = [];
    try { originalRoles = JSON.parse(dRolesEl.dataset.original || "[]"); } catch { /* ignore */ }
    const catalogLower = new Set(roleCatalog.map((c) => c.name.toLowerCase()));
    const externalRoles = originalRoles.filter(
      (r) => !catalogLower.has((r || "").toLowerCase()),
    );
    const hypervisionRoles = [...externalRoles, ...selectedCatalogRoles].join(",");
    const payload = {
      description: container.querySelector("#d-description").value,
      group_id,
      static_group_assignment,
      custom_attributes: {
        Type: container.querySelector("#d-type").value,
        Owner: container.querySelector("#d-owner").value,
        Lokation: container.querySelector("#d-lokation").value,
        AuthzVlan: container.querySelector("#d-authzvlan").value,
        AuthzACL: container.querySelector("#d-authzacl").value,
        PlatformType: container.querySelector("#d-platformtype").value,
        HypervisionRoles: hypervisionRoles,
      },
    };
    try {
      await api.updateEndpoint(detailCurrentId, payload);
      const savedId = detailCurrentId;
      const platformType = container.querySelector("#d-platformtype").value;
      let coaSummary = "";
      if (coaOnSave) {
        const action = coaByLocal.get(platformType) === "disconnect" ? "disconnect" : "reauth";
        detailMsg.innerHTML = `<div class="alert info">Gemt — udløser CoA ${action}...</div>`;
        const coa = await runCoaForIds([{ id: savedId, platformType }]);
        if (coa.ok) {
          coaSummary = ` CoA ${action} sendt.`;
        } else if (coa.failures.length) {
          coaSummary = ` CoA fejlede: ${coa.failures[0].msg}`;
        }
      }
      closeDetail();
      await load();
      msg.innerHTML = `<div class="alert success">Endpoint gemt.${coaSummary}</div>`;
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
    } finally {
      saveBtn.disabled = false;
    }
  });

  const exportBtn = container.querySelector("#export-btn");
  exportBtn.addEventListener("click", async () => {
    const selectedIds = getSelectedIds();
    let exportRows;
    let allLabel = "";
    if (selectedIds.length) {
      const selSet = new Set(selectedIds);
      exportRows = allRows.filter((r) => selSet.has(r.id));
    } else if (filterMode) {
      exportRows = applyFiltersToRows(allRows);
    } else {
      // Ingen selektion + ingen client-side filter: hent alle endpoints på tværs af sider.
      exportBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">Henter alle endpoints fra ISE for export...</div>`;
      try {
        if (allRowsCache) {
          exportRows = allRowsCache;
        } else {
          exportRows = await api.listAllEndpointDetails("", currentFilters);
          allRowsCache = exportRows;
        }
        allLabel = " (alle)";
      } catch (err) {
        msg.innerHTML = `<div class="alert error">Kunne ikke hente alle endpoints: ${err.message}</div>`;
        exportBtn.disabled = false;
        return;
      }
      exportBtn.disabled = false;
    }
    if (!exportRows.length) {
      msg.innerHTML = `<div class="alert info">Ingen endpoints at eksportere.</div>`;
      return;
    }
    const csv = toIseCsv(exportRows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `ise-endpoints-${date}.csv`);
    const label = selectedIds.length ? `${exportRows.length} valgte` : `${exportRows.length}${allLabel}`;
    msg.innerHTML = `<div class="alert success">Eksporteret ${label} endpoints.</div>`;
  });

  restoreFilters();
  applyColVis();
  await load();
}
