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

function esc(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Column definitions: key = data field accessor, label = header text
const COLUMNS = [
  { key: "mac",            label: "MAC",            field: (r) => r.mac || r.name },
  { key: "group_name",     label: "Identity Group", field: (r) => r.group_name },
  { key: "static_group",   label: "Tilknytning",    field: (r) => r.static_group ? "Statisk" : "Dynamisk" },
  { key: "description",    label: "Description",    field: (r) => r.description },
  { key: "endpoint_type",  label: "Type",           field: (r) => r.endpoint_type },
  { key: "owner",          label: "Owner",          field: (r) => r.owner },
  { key: "lokation",       label: "Lokation",       field: (r) => r.lokation },
  { key: "authz_vlan",     label: "AuthzVlan",      field: (r) => r.authz_vlan },
];

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
        <button id="bulk-edit-btn" class="secondary small" disabled>Rediger valgte</button>
        <button id="bulk-save-btn" class="small" disabled>Gem valgte</button>
        <button id="bulk-del-btn" class="danger small" disabled>Slet valgte</button>
        <span id="selection-count" class="hint"></span>
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

  async function runCoaForIds(ids) {
    if (!coaOnSave || !ids.length) return { ok: 0, fail: 0, failures: [] };
    let ok = 0;
    let fail = 0;
    const failures = [];
    for (const id of ids) {
      try {
        const res = await api.coaReauth(id);
        if (res?.ok) ok++;
        else {
          fail++;
          failures.push({ mac: res?.mac || id, msg: res?.message || "CoA fejlede" });
        }
      } catch (err) {
        fail++;
        failures.push({ mac: id, msg: err.message });
      }
    }
    return { ok, fail, failures };
  }
  let allRows = [];           // rows on current page (paged mode) or ALL rows (filtered mode)
  let allRowsCache = null;    // cached full dataset when filters have been used
  let groups = [];
  let caValues = { Type: [], Owner: [], Lokation: [], AuthzVlan: [] };
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
      applyFilter();
    } else {
      // No filters active — go back to server-side pagination
      exitFilterMode();
    }
  }

  // Wire up filter checkboxes: enable/disable the corresponding input
  filterRow.querySelectorAll(".col-filter-cb").forEach((cb) => {
    const input = filterRow.querySelector(`.col-filter-input[data-col="${cb.dataset.col}"]`);
    cb.addEventListener("change", async () => {
      input.disabled = !cb.checked;
      if (!cb.checked) input.value = "";
      await onFilterChange();
      if (cb.checked) input.focus();
    });
  });
  filterRow.querySelectorAll(".col-filter-input").forEach((input) => {
    input.addEventListener("input", () => {
      if (filterMode) applyFilter();
    });
  });

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
    updateDirtyUI();
  }

  function updateSelectionUI() {
    const selected = getSelectedIds();
    const hasSelection = selected.length > 0;
    bulkSaveBtn.disabled = !hasSelection;
    bulkDelBtn.disabled = !hasSelection;
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
        <td><select class="grp-select">${groupOptionsHtml(r.group_id)}</select></td>
        <td class="assign-cell">${r.static_group ? "Statisk" : "Dynamisk"}</td>
        <td><input type="text" class="desc-input" value="${esc(r.description || "")}" /></td>
        <td><select class="ca-type">${optionsHtml(caValues.Type, r.endpoint_type)}</select></td>
        <td><select class="ca-owner">${optionsHtml(caValues.Owner, r.owner)}</select></td>
        <td><select class="ca-lokation">${optionsHtml(caValues.Lokation, r.lokation)}</select></td>
        <td><select class="ca-authzvlan">${optionsHtml(caValues.AuthzVlan, r.authz_vlan)}</select></td>
      </tr>
    `).join("");
    updateSelectionUI();
    updateDirtyUI();
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
      const [caData, grps, result] = await Promise.all([
        api.listCustomAttributes(),
        api.listGroups(),
        api.listEndpointDetails(currentPage, currentSize, "", currentFilters),
      ]);
      groups = grps;
      for (const a of caData.attributes) {
        if (a.name in caValues) caValues[a.name] = a.values;
      }
      allRows = result.items;
      totalEndpoints = result.total;

      // If filters are active, immediately switch to filter mode
      if (needsFilterMode()) {
        await enterFilterMode();
      }

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

    const row = allRows.find((r) => r.id === id);
    const originalGroupId = row ? (row.group_id || "") : "";
    const groupChanged = selectedGroupId !== originalGroupId;

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
        },
      },
      localUpdate: { description, group_id, static_group_assignment, groupChanged, endpointType, owner, lokation, authzVlan },
    };
  }

  // Save all dirty rows
  saveAllBtn.addEventListener("click", async () => {
    if (!dirtyIds.size) return;
    saveAllBtn.disabled = true;
    const ids = [...dirtyIds];
    msg.innerHTML = `<div class="alert info">Gemmer ${ids.length} ændrede endpoints...</div>`;
    let ok = 0;
    let fail = 0;
    const savedIds = [];
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { payload } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        dirtyIds.delete(id);
        savedIds.push(id);
        ok++;
      } catch {
        fail++;
      }
    }
    let coaSummary = "";
    if (coaOnSave && savedIds.length) {
      msg.innerHTML = `<div class="alert info">Udløser CoA reauth for ${savedIds.length} endpoints...</div>`;
      const coa = await runCoaForIds(savedIds);
      coaSummary = `, CoA: ${coa.ok} ok${coa.fail ? `, ${coa.fail} fejl` : ""}`;
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
    const savedIds = [];
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { payload } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        dirtyIds.delete(id);
        savedIds.push(id);
        ok++;
      } catch {
        fail++;
      }
    }
    let coaSummary = "";
    if (coaOnSave && savedIds.length) {
      msg.innerHTML = `<div class="alert info">Udløser CoA reauth for ${savedIds.length} endpoints...</div>`;
      const coa = await runCoaForIds(savedIds);
      coaSummary = `, CoA: ${coa.ok} ok${coa.fail ? `, ${coa.fail} fejl` : ""}`;
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
    container.querySelector("#be-description").value = "";
    // Reset checkboxes
    bulkEditOverlay.querySelectorAll(".be-cb").forEach((cb) => {
      cb.checked = false;
      const field = cb.dataset.field;
      const ctrl = bulkEditOverlay.querySelector(`#be-${field}`);
      if (ctrl) ctrl.disabled = true;
    });
    bulkEditOverlay.classList.remove("hidden");
  });

  // Toggle enable/disable per field in bulk edit
  bulkEditOverlay.querySelectorAll(".be-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const ctrl = bulkEditOverlay.querySelector(`#be-${cb.dataset.field}`);
      if (ctrl) ctrl.disabled = !cb.checked;
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
  filterValueInput.addEventListener("input", () => triggerFilterChange(false));
  filterFieldSelect.addEventListener("change", () => triggerFilterChange(true));
  filterOpSelect.addEventListener("change", () => triggerFilterChange(true));

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
      container.querySelector("#d-name").textContent = d.name || "";
      container.querySelector("#d-id").textContent = d.id || "";
      container.querySelector("#d-group").innerHTML = groupOptionsHtml(d.group_id);
      container.querySelector("#d-static-group").checked = !!d.static_group;
      container.querySelector("#d-description").value = d.description || "";
      container.querySelector("#d-type").innerHTML = optionsHtml(caValues.Type, d.endpoint_type);
      container.querySelector("#d-owner").innerHTML = optionsHtml(caValues.Owner, d.owner);
      container.querySelector("#d-lokation").innerHTML = optionsHtml(caValues.Lokation, d.lokation);
      container.querySelector("#d-authzvlan").innerHTML = optionsHtml(caValues.AuthzVlan, d.authz_vlan);
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
    const payload = {
      description: container.querySelector("#d-description").value,
      group_id,
      static_group_assignment,
      custom_attributes: {
        Type: container.querySelector("#d-type").value,
        Owner: container.querySelector("#d-owner").value,
        Lokation: container.querySelector("#d-lokation").value,
        AuthzVlan: container.querySelector("#d-authzvlan").value,
      },
    };
    try {
      await api.updateEndpoint(detailCurrentId, payload);
      const savedId = detailCurrentId;
      let coaSummary = "";
      if (coaOnSave) {
        detailMsg.innerHTML = `<div class="alert info">Gemt — udløser CoA reauth...</div>`;
        const coa = await runCoaForIds([savedId]);
        if (coa.ok) {
          coaSummary = " CoA reauth sendt.";
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

  await load();
}
