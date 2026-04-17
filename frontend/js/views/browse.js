import { api } from "../api.js";
import { toIseCsv, downloadCsv } from "../csv.js";

const FRONTEND_PREFS_KEY = "ise_portal_prefs";
function getPageSize() {
  try {
    const prefs = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    return prefs.pageSize || 100;
  } catch { return 100; }
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
        <button id="save-all-btn" disabled title="Gem alle ændrede endpoints">Gem alle</button>
        <div class="spacer"></div>
        <button id="bulk-edit-btn" class="secondary small" disabled>Rediger valgte</button>
        <button id="bulk-save-btn" class="small" disabled>Gem valgte</button>
        <button id="bulk-del-btn" class="danger small" disabled>Slet valgte</button>
        <span id="selection-count" class="hint"></span>
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
  let allRows = [];
  let groups = [];
  let caValues = { Type: [], Owner: [], Lokation: [], AuthzVlan: [] };
  let portalOnly = false;
  const dirtyIds = new Set();

  // Wire up filter checkboxes: enable/disable the corresponding input
  filterRow.querySelectorAll(".col-filter-cb").forEach((cb) => {
    const input = filterRow.querySelector(`.col-filter-input[data-col="${cb.dataset.col}"]`);
    cb.addEventListener("change", () => {
      input.disabled = !cb.checked;
      if (!cb.checked) input.value = "";
      applyFilter();
      if (cb.checked) input.focus();
    });
  });
  filterRow.querySelectorAll(".col-filter-input").forEach((input) => {
    input.addEventListener("input", applyFilter);
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

  function getVisibleRows() {
    let rows = allRows;
    if (portalOnly) {
      rows = rows.filter((r) => r.hypervision === "true");
    }

    // Per-column filters (regex)
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
            // Invalid regex — fall back to literal substring
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            activeFilters.push({ field: colDef.field, re: new RegExp(escaped, "i") });
          }
        }
      }
    });

    if (activeFilters.length) {
      rows = rows.filter((r) =>
        activeFilters.every((f) => f.re.test(f.field(r) || "")),
      );
    }
    return rows;
  }

  function hasActiveFilters() {
    return filterRow.querySelector(".col-filter-cb:checked") !== null &&
      Array.from(filterRow.querySelectorAll(".col-filter-input")).some((i) => !i.disabled && i.value.trim());
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
        <td class="mac-cell">${esc(r.mac || r.name)}</td>
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
    const visible = getVisibleRows();
    renderRows(visible);
    const total = portalOnly
      ? allRows.filter((r) => r.hypervision === "true").length
      : allRows.length;
    if (hasActiveFilters()) {
      count.textContent = `${visible.length} / ${total} endpoints`;
    } else {
      count.textContent = `${visible.length} endpoints`;
    }
  }

  async function load() {
    const cols = COLUMNS.length + 2;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Henter detaljer fra ISE...</td></tr>`;
    msg.innerHTML = "";
    dirtyIds.clear();
    updateDirtyUI();
    try {
      const [caData, grps, details] = await Promise.all([
        api.listCustomAttributes(),
        api.listGroups(),
        api.listEndpointDetails(1, getPageSize()),
      ]);
      groups = grps;
      for (const a of caData.attributes) {
        if (a.name in caValues) caValues[a.name] = a.values;
      }
      allRows = details;
      applyFilter();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      tbody.innerHTML = "";
    }
  }

  // Portal-only toggle
  portalFilterBtn.addEventListener("click", () => {
    portalOnly = !portalOnly;
    portalFilterBtn.classList.toggle("active-toggle", portalOnly);
    applyFilter();
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
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { mac, payload, localUpdate } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        const row = allRows.find((r) => r.id === id);
        if (row) {
          row.description = localUpdate.description;
          if (localUpdate.groupChanged) {
            row.group_id = localUpdate.group_id;
            row.static_group = localUpdate.static_group_assignment !== false;
          }
          row.endpoint_type = localUpdate.endpointType;
          row.owner = localUpdate.owner;
          row.lokation = localUpdate.lokation;
          row.authz_vlan = localUpdate.authzVlan;
        }
        dirtyIds.delete(id);
        tr.classList.remove("dirty");
        ok++;
      } catch {
        fail++;
      }
    }
    updateDirtyUI();
    const parts = [];
    if (ok) parts.push(`${ok} gemt`);
    if (fail) parts.push(`${fail} fejlede`);
    const cls = fail ? "error" : "success";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}</div>`;
    saveAllBtn.disabled = false;
  });

  // Bulk save selected
  bulkSaveBtn.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    bulkSaveBtn.disabled = true;
    msg.innerHTML = `<div class="alert info">Gemmer ${ids.length} endpoints...</div>`;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { mac, payload, localUpdate } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        const row = allRows.find((r) => r.id === id);
        if (row) {
          row.description = localUpdate.description;
          if (localUpdate.groupChanged) {
            row.group_id = localUpdate.group_id;
            row.static_group = localUpdate.static_group_assignment !== false;
          }
          row.endpoint_type = localUpdate.endpointType;
          row.owner = localUpdate.owner;
          row.lokation = localUpdate.lokation;
          row.authz_vlan = localUpdate.authzVlan;
        }
        dirtyIds.delete(id);
        tr.classList.remove("dirty");
        ok++;
      } catch {
        fail++;
      }
    }
    updateDirtyUI();
    const parts = [];
    if (ok) parts.push(`${ok} gemt`);
    if (fail) parts.push(`${fail} fejlede`);
    const cls = fail ? "error" : "success";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}</div>`;
    bulkSaveBtn.disabled = false;
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

  container.querySelector("#refresh-btn").addEventListener("click", load);

  container.querySelector("#export-btn").addEventListener("click", () => {
    const visible = getVisibleRows();
    if (!visible.length) {
      msg.innerHTML = `<div class="alert info">Ingen endpoints at eksportere.</div>`;
      return;
    }
    const csv = toIseCsv(visible);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `ise-endpoints-${date}.csv`);
    msg.innerHTML = `<div class="alert success">Eksporteret ${visible.length} endpoints.</div>`;
  });

  await load();
}
