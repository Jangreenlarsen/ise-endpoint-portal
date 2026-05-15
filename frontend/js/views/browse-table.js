// Table rendering, inline-edit, pagination, col-vis, save, export.
// initTable wires all table DOM events and returns its public API.
// Cross-module calls go via `cb` (populated in browse.js after all inits).

import { t } from "../i18n.js";
import {
  getColumns, getOrderedColumns, esc,
  endpointCreateTime, fmtRelativeAge, fmtDateTime,
  normalizeMac, coaSummaryText, optionsHtml,
  loadColVis, saveColVis, savePageSize, saveColOrder,
} from "./browse-utils.js";
import { toIseCsv, downloadCsv } from "../csv.js";

export function initTable(container, state, api, cb) {
  const tbody          = container.querySelector("#tbody");
  const msg            = container.querySelector("#msg");
  const countEl        = container.querySelector("#count");
  const saveAllBtn     = container.querySelector("#save-all-btn");
  const undoBtn        = container.querySelector("#undo-btn");
  const selectAllCb    = container.querySelector("#select-all");
  const bulkSaveBtn    = container.querySelector("#bulk-save-btn");
  const bulkDelBtn     = container.querySelector("#bulk-del-btn");
  const bulkDisconnBtn = container.querySelector("#bulk-disconnect-btn");
  const bulkEditBtn    = container.querySelector("#bulk-edit-btn");
  const selectionCount = container.querySelector("#selection-count");
  const pagePrev       = container.querySelector("#page-prev");
  const pageNext       = container.querySelector("#page-next");
  const pageInfo       = container.querySelector("#page-info");
  const pageSizeSelect = container.querySelector("#page-size-select");
  const colVisBtn      = container.querySelector("#col-vis-btn");
  const colVisMenu     = container.querySelector("#col-vis-menu");
  const exportBtn      = container.querySelector("#export-btn");
  const refreshBtn     = container.querySelector("#refresh-btn");

  // ── Render helpers (need state.groups / state.roleCatalog) ───────────────
  function groupOptionsHtml(selectedId) {
    const opts = [`<option value="">${t("cell.no_group")}</option>`];
    for (const g of state.groups) {
      opts.push(`<option value="${esc(g.id)}"${g.id === selectedId ? " selected" : ""}>${esc(g.name)}</option>`);
    }
    return opts.join("");
  }

  function rolesChipsHtml(selected, opts = {}) {
    const editable   = opts.editable !== false && state.canEditRoles;
    const sel        = (selected || []).filter((r) => r.toLowerCase() !== "admin");
    const selLower   = new Set(sel.map((s) => (s || "").toLowerCase()));
    const catalogLow = new Set(state.roleCatalog.map((r) => r.name.toLowerCase()));
    const items      = [];
    for (const r of state.roleCatalog) {
      const checked = selLower.has(r.name.toLowerCase()) ? "checked" : "";
      const dis     = editable ? "" : "disabled";
      items.push(
        `<label class="role-chip" title="${esc(r.description || r.name)}">` +
        `<input type="checkbox" class="row-role-chip" data-role="${esc(r.name)}" ${checked} ${dis} />` +
        `<span>${esc(r.name)}</span></label>`,
      );
    }
    for (const r of sel) {
      if (!catalogLow.has(r.toLowerCase())) {
        items.push(
          `<span class="role-chip role-chip-extern" title="${t("browse.extern_role_title")}">` +
          `${esc(r)}</span>`,
        );
      }
    }
    return items.length ? `<div class="role-chips">${items.join("")}</div>` : `<span class="hint">—</span>`;
  }

  // ── Column visibility ────────────────────────────────────────────────────
  function applyColVis() {
    const table = container.querySelector(".browse-table-wrap table");
    if (!table) return;
    getColumns().forEach((c) => {
      const visible = state.colVis[c.key] !== false;
      table.querySelectorAll(`[data-col="${c.key}"]`).forEach((el) =>
        el.classList.toggle("col-hidden", !visible));
    });
  }

  function renderColVisMenu() {
    colVisMenu.innerHTML = getColumns().map((c) => `
      <label class="col-vis-item">
        <input type="checkbox" class="col-vis-cb" data-col="${c.key}"
               ${state.colVis[c.key] !== false ? "checked" : ""} />
        ${esc(c.label)}
      </label>`).join("");
    colVisMenu.querySelectorAll(".col-vis-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        state.colVis[cb.dataset.col] = cb.checked;
        saveColVis(state.colVis);
        applyColVis();
      });
    });
  }

  colVisBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    renderColVisMenu();
    colVisMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!colVisMenu.contains(e.target) && e.target !== colVisBtn) colVisMenu.classList.add("hidden");
  });

  // ── NAS → PlatformType auto-derive ──────────────────────────────────────
  function getNasPlatformType(mac) {
    if (!state.pxgridSessionData) return "";
    const sess = state.pxgridSessionData.get(normalizeMac(mac));
    return sess?.nas_device_type || "";
  }

  // ── ISE session combo cell (authz only — NAS info moved to nas column) ──
  function iseSessionCellHtml(mac) {
    if (!state.pxgridSessionData) return '<span class="hint">—</span>';
    const sess = state.pxgridSessionData.get(normalizeMac(mac));
    if (!sess) return '<span class="hint">—</span>';
    const profs = (sess.authz_profiles || []).filter(Boolean);
    if (!profs.length) return '<span class="hint">—</span>';
    return (
      `<div class="ise-sess-combo">` +
      profs.map(p => `<span class="ise-sess-authz">${esc(p)}</span>`).join("") +
      `</div>`
    );
  }

  // ── NAS info cell ────────────────────────────────────────────────────────
  function nasInfoCellHtml(mac) {
    if (!state.pxgridSessionData) return '<span class="hint">—</span>';
    const sess = state.pxgridSessionData.get(normalizeMac(mac));
    if (!sess) return '<span class="hint">—</span>';
    const name = sess.nas_name || "";
    if (!name) return '<span class="hint">—</span>';
    return `<span class="nas-info-name">${esc(name)}</span>`;
  }

  // ── Auth-status colors ───────────────────────────────────────────────────
  function applyAuthStatusColors() {
    const macs = state.activeSessionMacs || (state.pxgridLive && state.pxgridSessionMacs) || null;
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      const macCell = tr.querySelector(".mac-cell");
      if (!macCell) return;
      macCell.classList.remove("auth-active", "auth-failed");
      if (!macs) return;
      const mac = normalizeMac(macCell.textContent);
      if (mac) macCell.classList.add(macs.has(mac) ? "auth-active" : "auth-failed");
    });
  }

  // ── Row rendering ────────────────────────────────────────────────────────
  function renderRows(rows) {
    const cols = getColumns().length + 2;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">${t("browse.no_results")}</td></tr>`;
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const mac   = r.mac || r.name;
      const nasPt = getNasPlatformType(mac);
      const cells = {
        mac:           `<td data-col="mac" class="mac-cell${r.cache_stale ? " cache-stale" : ""}"><a href="#" class="mac-link" title="${t("browse.mac_link_title")}">${esc(mac)}</a>${r.cache_stale ? `<span class="stale-badge" title="${t("browse.stale_badge_title")}">⏱</span>` : ""}</td>`,
        vendor:        `<td data-col="vendor" class="vendor-cell-td">${esc(r.vendor || "")}</td>`,
        group_name:    `<td data-col="group_name"><select class="grp-select">${groupOptionsHtml(r.group_id)}</select></td>`,
        static_group:  `<td data-col="static_group" class="assign-cell">${r.static_group ? t("cell.static") : t("cell.dynamic")}</td>`,
        description:   `<td data-col="description"><input type="text" class="desc-input" value="${esc(r.description || "")}" /></td>`,
        endpoint_type: `<td data-col="endpoint_type"><select class="ca-type">${optionsHtml(state.caValues.Type, r.endpoint_type)}</select></td>`,
        owner:         `<td data-col="owner"><select class="ca-owner">${optionsHtml(state.caValues.Owner, r.owner)}</select></td>`,
        lokation:      `<td data-col="lokation"><select class="ca-lokation">${optionsHtml(state.caValues.Lokation, r.lokation)}</select></td>`,
        platform_type: nasPt
          ? `<td data-col="platform_type" class="platform-auto-td"><select class="ca-platformtype" disabled>${optionsHtml(state.caValues.PlatformType, nasPt)}</select><span class="platform-auto-badge" title="${t("browse.platform_auto_title")}">&#9889;</span></td>`
          : `<td data-col="platform_type"><select class="ca-platformtype">${optionsHtml(state.caValues.PlatformType, r.platform_type)}</select></td>`,
        psk_mode:      `<td data-col="psk_mode" class="psk-mode-cell"><input type="checkbox" class="psk-mode-cb"${r.psk_mode ? " checked" : ""}${state.isPskEditor ? "" : " disabled"} title="MPSK/IPSK" /></td>`,
        psk_key:       `<td data-col="psk_key" class="authz-col psk-key-cell mono">${state.pskShowKey ? esc(r.psk_key || "") : (r.psk_key ? "••••••" : "")}</td>`,
        authz_vlan:    `<td data-col="authz_vlan" class="authz-col"><select class="ca-authzvlan">${optionsHtml(state.caValues.AuthzVlan, r.authz_vlan)}</select></td>`,
        authz_acl:     `<td data-col="authz_acl" class="authz-col"><select class="ca-authzacl">${optionsHtml(state.caValues.AuthzACL, r.authz_acl)}</select></td>`,
        roles:         `<td data-col="roles" class="roles-cell">${rolesChipsHtml(r.roles)}</td>`,
        create_time:   `<td data-col="create_time" class="age-cell" title="${esc(fmtDateTime(endpointCreateTime(r)))}">${esc(fmtRelativeAge(endpointCreateTime(r)))}</td>`,
        nas:           `<td data-col="nas" class="nas-info-col">${nasInfoCellHtml(mac)}</td>`,
        ise_session:   `<td data-col="ise_session" class="ise-session-col">${iseSessionCellHtml(mac)}</td>`,
      };
      return `
      <tr data-id="${esc(r.id)}"${state.dirtyIds.has(r.id) ? ' class="dirty"' : ''}>
        <td class="select-cell"><input type="checkbox" class="row-select" /></td>
        ${getOrderedColumns().map(c => cells[c.key] || "").join("")}
      </tr>`;
    }).join("");
    updateSelectionUI();
    updateDirtyUI();
    applyColVis();
    applyAuthStatusColors();
  }

  async function refreshRows(ids) {
    if (!ids || !ids.length) return;
    const fresh = await Promise.all(ids.map((id) => api.getEndpoint(id).catch(() => null)));
    const byId  = new Map();
    for (const r of fresh) if (r && r.id) byId.set(r.id, r);
    if (!byId.size) return;
    for (let i = 0; i < state.allRows.length; i++) {
      const upd = byId.get(state.allRows[i].id);
      if (upd) state.allRows[i] = upd;
    }
    if (state.allRowsCache) {
      for (let i = 0; i < state.allRowsCache.length; i++) {
        const upd = byId.get(state.allRowsCache[i].id);
        if (upd) state.allRowsCache[i] = upd;
      }
    }
    for (const [id, r] of byId) {
      const tr = tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (!tr) continue;
      const macLink = tr.querySelector(".mac-cell .mac-link");
      if (macLink) macLink.textContent = r.mac || r.name;
      const vendorCell = tr.querySelector(".vendor-cell-td");
      if (vendorCell) vendorCell.textContent = r.vendor || "";
      const grpSel = tr.querySelector(".grp-select");
      if (grpSel) grpSel.innerHTML = groupOptionsHtml(r.group_id);
      const assignCell = tr.querySelector(".assign-cell");
      if (assignCell) assignCell.textContent = r.static_group ? t("cell.static") : t("cell.dynamic");
      const descInput = tr.querySelector(".desc-input");
      if (descInput) descInput.value = r.description || "";
      const setSel = (cls, val, vals) => {
        const el = tr.querySelector(`.${cls}`);
        if (el) el.innerHTML = optionsHtml(vals, val);
      };
      setSel("ca-type",       r.endpoint_type, state.caValues.Type);
      setSel("ca-owner",      r.owner,          state.caValues.Owner);
      setSel("ca-lokation",   r.lokation,       state.caValues.Lokation);
      setSel("ca-authzvlan",  r.authz_vlan,     state.caValues.AuthzVlan);
      setSel("ca-authzacl",   r.authz_acl,      state.caValues.AuthzACL);
      setSel("ca-platformtype", r.platform_type, state.caValues.PlatformType);
      // Re-apply auto-platform indicator after refresh
      const ptTd   = tr.querySelector(".ca-platformtype")?.closest("td");
      const nasPt2 = getNasPlatformType(r.mac || r.name);
      if (ptTd) {
        ptTd.classList.toggle("platform-auto-td", !!nasPt2);
        const ptSel = ptTd.querySelector(".ca-platformtype");
        if (ptSel) ptSel.disabled = !!nasPt2;
        if (ptSel && nasPt2) ptSel.value = nasPt2;
        const oldBadge = ptTd.querySelector(".platform-auto-badge");
        if (nasPt2 && !oldBadge) {
          const badge = document.createElement("span");
          badge.className = "platform-auto-badge";
          badge.title = t("browse.platform_auto_title");
          badge.innerHTML = "&#9889;";
          ptSel && ptSel.after(badge);
        } else if (!nasPt2 && oldBadge) {
          oldBadge.remove();
        }
      }
      const rolesCell = tr.querySelector(".roles-cell");
      if (rolesCell) rolesCell.innerHTML = rolesChipsHtml(r.roles);
      const pskModeCb = tr.querySelector(".psk-mode-cb");
      if (pskModeCb) pskModeCb.checked = !!r.psk_mode;
      const pskKeyCell = tr.querySelector(".psk-key-cell");
      if (pskKeyCell) pskKeyCell.textContent = state.pskShowKey ? (r.psk_key || "") : (r.psk_key ? "••••••" : "");
      delete tr.dataset.beStaticGroup;
      delete tr.dataset.bePskKey;
      tr.classList.remove("dirty");
      state.dirtyIds.delete(id);
    }
    applyColVis();
    applyAuthStatusColors();
    updateDirtyUI();
    updateSelectionUI();
  }

  // ── Dirty tracking ───────────────────────────────────────────────────────
  function updateDirtyUI() {
    const n = state.dirtyIds.size;
    saveAllBtn.disabled = n === 0;
    undoBtn.disabled    = n === 0;
    saveAllBtn.textContent = n
      ? t("browse.save_all_n").replace("{n}", n)
      : t("browse.btn_save_all");
  }

  function revertDirtyRows() {
    if (!state.dirtyIds.size) return;
    for (const id of [...state.dirtyIds]) {
      const r  = (state.allRows || []).find((x) => x.id === id);
      if (!r) continue;
      const tr = tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (!tr) continue;

      const mac  = r.mac || r.name;
      const nasPt = getNasPlatformType(mac);

      const descInput = tr.querySelector(".desc-input");
      if (descInput) descInput.value = r.description || "";

      const grpSel = tr.querySelector(".grp-select");
      if (grpSel) grpSel.innerHTML = groupOptionsHtml(r.group_id);

      const assignCell = tr.querySelector(".assign-cell");
      if (assignCell) assignCell.textContent = r.static_group ? t("cell.static") : t("cell.dynamic");
      delete tr.dataset.beStaticGroup;

      const setSel = (cls, val, vals) => {
        const el = tr.querySelector(`.${cls}`);
        if (el) el.innerHTML = optionsHtml(vals, val);
      };
      setSel("ca-type",        r.endpoint_type, state.caValues.Type);
      setSel("ca-owner",       r.owner,          state.caValues.Owner);
      setSel("ca-lokation",    r.lokation,       state.caValues.Lokation);
      setSel("ca-authzvlan",   r.authz_vlan,     state.caValues.AuthzVlan);
      setSel("ca-authzacl",    r.authz_acl,      state.caValues.AuthzACL);
      setSel("ca-platformtype",r.platform_type,  state.caValues.PlatformType);

      const ptTd  = tr.querySelector(".ca-platformtype")?.closest("td");
      if (ptTd) {
        ptTd.classList.toggle("platform-auto-td", !!nasPt);
        const ptSel = ptTd.querySelector(".ca-platformtype");
        if (ptSel) { ptSel.disabled = !!nasPt; if (nasPt) ptSel.value = nasPt; }
        const oldBadge = ptTd.querySelector(".platform-auto-badge");
        if (nasPt && !oldBadge) {
          const badge = document.createElement("span");
          badge.className = "platform-auto-badge";
          badge.title = t("browse.platform_auto_title");
          badge.innerHTML = "&#9889;";
          ptSel && ptSel.after(badge);
        } else if (!nasPt && oldBadge) { oldBadge.remove(); }
      }

      const pskCb = tr.querySelector(".psk-mode-cb");
      if (pskCb) pskCb.checked = !!r.psk_mode;
      delete tr.dataset.bePskKey;

      const rolesCell = tr.querySelector(".roles-cell");
      if (rolesCell) rolesCell.innerHTML = rolesChipsHtml(r.roles);

      const rowSel = tr.querySelector(".row-select");
      if (rowSel) rowSel.checked = false;

      tr.classList.remove("dirty");
    }
    state.dirtyIds.clear();
    updateSelectionUI();
    updateDirtyUI();
  }

  function markDirty(tr) {
    const id = tr.dataset.id;
    if (!id) return;
    state.dirtyIds.add(id);
    tr.classList.add("dirty");
    const cbEl = tr.querySelector(".row-select");
    if (cbEl && !cbEl.checked) { cbEl.checked = true; updateSelectionUI(); }
    updateDirtyUI();
  }

  // ── Selection ────────────────────────────────────────────────────────────
  function getSelectedIds() {
    return Array.from(tbody.querySelectorAll(".row-select:checked")).map(
      (cbEl) => cbEl.closest("tr").dataset.id,
    );
  }

  function updateSelectionUI() {
    const selected     = getSelectedIds();
    const hasSelection = selected.length > 0;
    bulkSaveBtn.disabled    = !hasSelection;
    bulkDelBtn.disabled     = !hasSelection;
    bulkDisconnBtn.disabled = !hasSelection;
    bulkEditBtn.disabled    = !hasSelection;
    selectionCount.textContent = hasSelection ? t("browse.selection_n").replace("{n}", selected.length) : "";
    selectAllCb.indeterminate  = selected.length > 0 && selected.length < tbody.querySelectorAll(".row-select").length;
  }

  // ── Save payload builder ─────────────────────────────────────────────────
  function buildSavePayload(tr) {
    const id              = tr.dataset.id;
    const description     = tr.querySelector(".desc-input").value;
    const selectedGroupId = tr.querySelector(".grp-select").value;
    const endpointType    = tr.querySelector(".ca-type").value;
    const owner           = tr.querySelector(".ca-owner").value;
    const lokation        = tr.querySelector(".ca-lokation").value;
    const authzVlan       = tr.querySelector(".ca-authzvlan").value;
    const authzAcl        = tr.querySelector(".ca-authzacl").value;
    const platformType    = tr.querySelector(".ca-platformtype").value;
    const pskModeCb       = tr.querySelector(".psk-mode-cb");
    const pskMode         = pskModeCb ? pskModeCb.checked : null;
    const row             = state.allRows.find((r) => r.id === id);
    const originalGroupId = row ? (row.group_id || "") : "";
    const groupChanged    = selectedGroupId !== originalGroupId;

    const checkedChips        = tr.querySelectorAll(".row-role-chip:checked");
    const selectedCatalogRoles = Array.from(checkedChips).map((cb) => cb.dataset.role);
    const catalogLower         = new Set(state.roleCatalog.map((c) => c.name.toLowerCase()));
    const externalRoles        = ((row && row.roles) || []).filter(
      (r) => !catalogLower.has((r || "").toLowerCase()),
    );
    const hypervisionRoles = [...externalRoles, ...selectedCatalogRoles].join(",");

    let group_id = null, static_group_assignment = null;
    if (groupChanged) {
      if (!selectedGroupId) {
        const unknownGroup = state.groups.find((g) => g.name.toLowerCase() === "unknown");
        if (unknownGroup) { group_id = unknownGroup.id; static_group_assignment = false; }
      } else { group_id = selectedGroupId; }
    }
    if (tr.dataset.beStaticGroup !== undefined) {
      static_group_assignment = tr.dataset.beStaticGroup === "1";
    }
    const bePskKey = state.isPskEditor && tr.dataset.bePskKey !== undefined ? tr.dataset.bePskKey : undefined;

    return {
      id,
      mac: tr.querySelector(".mac-cell").textContent,
      payload: {
        description, group_id, static_group_assignment,
        custom_attributes: {
          Type: endpointType, Owner: owner, Lokation: lokation,
          AuthzVlan: authzVlan, AuthzACL: authzAcl, PlatformType: platformType,
          HypervisionRoles: hypervisionRoles,
          ...(state.isPskEditor && pskMode !== null ? { PSK_Mode: pskMode ? "true" : "false" } : {}),
          ...(bePskKey !== undefined && bePskKey !== "****" ? { PSK_Key: bePskKey } : {}),
        },
      },
      localUpdate: { description, group_id, static_group_assignment, groupChanged, endpointType, owner, lokation, authzVlan, authzAcl, platformType, pskMode },
      platformType,
    };
  }

  // ── Pagination ───────────────────────────────────────────────────────────
  function totalPages() {
    return Math.max(1, Math.ceil(state.totalEndpoints / state.currentSize));
  }

  function updatePaginationUI() {
    const tp = totalPages();
    pagePrev.disabled     = state.currentPage <= 1;
    pageNext.disabled     = state.currentPage >= tp;
    pageInfo.textContent  = t("browse.page_info")
      .replace("{page}", state.currentPage)
      .replace("{total}", tp)
      .replace("{count}", state.totalEndpoints);
  }

  // ── applyFilter (client-side pagination over full dataset) ───────────────
  function applyFilter() {
    if (state.filterMode) {
      const filtered = cb.applyFiltersToRows(state.allRows);
      state.totalEndpoints = filtered.length;
      const tp = totalPages();
      if (state.currentPage > tp) state.currentPage = tp;
      const start    = (state.currentPage - 1) * state.currentSize;
      const pageRows = filtered.slice(start, start + state.currentSize);
      renderRows(pageRows);
      updatePaginationUI();
      if (cb.hasActiveFilterText() || state.portalOnly) {
        countEl.textContent = t("browse.filtered_info")
          .replace("{filtered}", filtered.length)
          .replace("{all}", state.allRows.length);
      } else {
        countEl.textContent = t("browse.all_info").replace("{n}", state.allRows.length);
      }
    } else {
      renderRows(state.allRows);
      updatePaginationUI();
      countEl.textContent = t("browse.server_info")
        .replace("{n}", state.allRows.length)
        .replace("{total}", state.totalEndpoints);
    }
  }

  // ── Load (full page refresh) ─────────────────────────────────────────────
  async function load(force = false) {
    const cols = getColumns().length + 2;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">${t("browse.fetching_ise")}</td></tr>`;
    msg.innerHTML = "";
    state.dirtyIds.clear();
    updateDirtyUI();
    state.filterMode  = false;
    state.allRowsCache = null;
    try {
      const [caData, grps, result, dacls, mapping, roles, me, pskPolicy] = await Promise.all([
        api.listCustomAttributes(),
        api.listGroups(),
        api.listEndpointDetails(state.currentPage, state.currentSize, "", state.currentFilters),
        api.listDacls().catch(() => []),
        api.getPlatformMapping().catch(() => ({ mappings: [] })),
        api.listEndpointRoles().catch(() => ({ roles: [] })),
        api.authMe().catch(() => null),
        api.getPskPolicy().catch(() => null),
      ]);
      state.pskShowKey   = !!(pskPolicy && pskPolicy.show_key_in_table);
      state.groups       = grps;
      const allRoles     = (roles && Array.isArray(roles.roles)) ? roles.roles : [];
      state.canEditRoles = !!me && (me.role === "admin" || me.role === "editor" || me.role === "editor-psk");
      state.isPskEditor  = !!me && (me.role === "admin" || me.role === "editor-psk");
      const nonAdminRoles = allRoles.filter((r) => r.name.toLowerCase() !== "admin");
      if (!me || me.role === "admin") {
        state.roleCatalog = nonAdminRoles;
      } else {
        const assigned = new Set((me.assigned_endpoint_roles || []).map((r) => r.toLowerCase()));
        state.roleCatalog = nonAdminRoles.filter((r) => assigned.has(r.name.toLowerCase()));
      }
      for (const a of caData.attributes) {
        if (a.name in state.caValues) state.caValues[a.name] = a.values;
      }
      state.caValues.AuthzACL = (dacls || []).map((d) => d.name).filter(Boolean).sort();
      state.coaByLocal = new Map(
        (mapping.mappings || []).filter((m) => m.local).map((m) => [m.local, m.coa || "reauth"]),
      );
      state.allRows       = result.items;
      state.totalEndpoints = result.total;
      if (cb.needsFilterMode()) await cb.enterFilterMode();
      await cb.refreshActiveSessionMacs(force);
      applyFilter();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      tbody.innerHTML = "";
    }
  }

  // ── Event handlers ───────────────────────────────────────────────────────
  selectAllCb.addEventListener("change", () => {
    tbody.querySelectorAll(".row-select").forEach((cbEl) => { cbEl.checked = selectAllCb.checked; });
    updateSelectionUI();
  });

  tbody.addEventListener("change", (e) => {
    if (e.target.classList.contains("row-select")) { updateSelectionUI(); return; }
    const tr = e.target.closest("tr");
    if (tr && (e.target.matches("select") || e.target.matches("input:not(.row-select)"))) markDirty(tr);
  });

  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr");
    if (tr && e.target.matches("input:not(.row-select)")) markDirty(tr);
  });

  tbody.addEventListener("click", (e) => {
    const link = e.target.closest(".mac-link");
    if (!link) return;
    e.preventDefault();
    const tr = link.closest("tr");
    if (tr && tr.dataset.id) cb.openDetail(tr.dataset.id);
  });

  undoBtn.addEventListener("click", () => {
    if (!state.dirtyIds.size) return;
    if (!confirm(`Fortryd ${state.dirtyIds.size} ikke-gemte ændring(er)?`)) return;
    revertDirtyRows();
    msg.innerHTML = `<div class="alert info">Ændringer fortrudt.</div>`;
  });

  // Save all dirty rows
  saveAllBtn.addEventListener("click", async () => {
    if (!state.dirtyIds.size) return;
    saveAllBtn.disabled = true;
    const ids = [...state.dirtyIds];
    msg.innerHTML = `<div class="alert info">${t("browse.saving_n").replace("{n}", ids.length)}</div>`;
    let ok = 0, fail = 0;
    const savedEntries = [];
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { payload, platformType } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        state.dirtyIds.delete(id);
        savedEntries.push({ id, platformType });
        ok++;
      } catch { fail++; }
    }
    let coaSummary = "";
    if (state.coaOnSave && savedEntries.length) {
      msg.innerHTML = `<div class="alert info">${t("browse.coa_n").replace("{n}", savedEntries.length)}</div>`;
      const coa = await cb.runCoaForIds(savedEntries);
      coaSummary = coaSummaryText(coa);
    }
    await refreshRows(savedEntries.map((s) => s.id));
    const parts = [];
    if (ok)   parts.push(t("browse.saved_n").replace("{n}", ok));
    if (fail) parts.push(t("browse.failed_n").replace("{n}", fail));
    msg.innerHTML = `<div class="alert ${fail ? "error" : "success"}">${parts.join(", ")}${coaSummary}</div>`;
  });

  // Bulk save selected rows
  bulkSaveBtn.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    bulkSaveBtn.disabled = true;
    msg.innerHTML = `<div class="alert info">${t("browse.saving_selected_n").replace("{n}", ids.length)}</div>`;
    let ok = 0, fail = 0;
    const savedEntries = [];
    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const { payload, platformType } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        state.dirtyIds.delete(id);
        savedEntries.push({ id, platformType });
        ok++;
      } catch { fail++; }
    }
    let coaSummary = "";
    if (state.coaOnSave && savedEntries.length) {
      msg.innerHTML = `<div class="alert info">${t("browse.coa_n").replace("{n}", savedEntries.length)}</div>`;
      const coa = await cb.runCoaForIds(savedEntries);
      coaSummary = coaSummaryText(coa);
    }
    await refreshRows(savedEntries.map((s) => s.id));
    const parts = [];
    if (ok)   parts.push(t("browse.saved_n").replace("{n}", ok));
    if (fail) parts.push(t("browse.failed_n").replace("{n}", fail));
    msg.innerHTML = `<div class="alert ${fail ? "error" : "success"}">${parts.join(", ")}${coaSummary}</div>`;
    bulkSaveBtn.disabled = false;
  });

  // Refresh button
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled    = true;
    refreshBtn.textContent = t("browse.refreshing");
    try {
      await api.invalidateCache().catch(() => {});
      await load(true);
    } finally {
      refreshBtn.disabled    = false;
      refreshBtn.textContent = t("browse.btn_refresh");
    }
  });

  // Export CSV
  exportBtn.addEventListener("click", async () => {
    const selectedIds = getSelectedIds();
    let exportRows;
    let allLabel = "";
    if (selectedIds.length) {
      const selSet = new Set(selectedIds);
      exportRows   = state.allRows.filter((r) => selSet.has(r.id));
    } else if (state.filterMode) {
      exportRows = cb.applyFiltersToRows(state.allRows);
    } else {
      exportBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("browse.export_fetching")}</div>`;
      try {
        exportRows = state.allRowsCache || (state.allRowsCache = await api.listAllEndpointDetails("", state.currentFilters));
        allLabel   = true;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("browse.export_error").replace("{msg}", err.message)}</div>`;
        exportBtn.disabled = false;
        return;
      }
      exportBtn.disabled = false;
    }
    if (!exportRows.length) {
      msg.innerHTML = `<div class="alert info">${t("browse.export_none")}</div>`;
      return;
    }
    const csv  = toIseCsv(exportRows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `ise-endpoints-${date}.csv`);
    let doneMsg;
    if (selectedIds.length) {
      doneMsg = t("browse.export_done_selected").replace("{n}", exportRows.length);
    } else if (allLabel) {
      doneMsg = t("browse.export_done_all").replace("{n}", exportRows.length);
    } else {
      doneMsg = t("browse.export_done_filtered").replace("{n}", exportRows.length);
    }
    msg.innerHTML = `<div class="alert success">${doneMsg}</div>`;
  });

  // Pagination
  pagePrev.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      if (state.filterMode) applyFilter(); else load();
    }
  });
  pageNext.addEventListener("click", () => {
    if (state.currentPage < totalPages()) {
      state.currentPage++;
      if (state.filterMode) applyFilter(); else load();
    }
  });
  pageSizeSelect.addEventListener("change", () => {
    state.currentSize = parseInt(pageSizeSelect.value, 10);
    savePageSize(state.currentSize);
    state.currentPage = 1;
    cb.clearActiveView?.();
    if (state.filterMode) applyFilter(); else load();
  });

  // ── Column drag-and-drop ─────────────────────────────────────────────────
  function initColDrag() {
    const table = container.querySelector(".browse-table-wrap table");
    if (!table) return;
    const thead = table.querySelector("thead");
    let dragSrcKey = null;

    thead.addEventListener("dragstart", (e) => {
      const th = e.target.closest("th[data-col][draggable]");
      if (!th) return;
      dragSrcKey = th.dataset.col;
      e.dataTransfer.effectAllowed = "move";
      th.classList.add("col-dragging");
    });

    thead.addEventListener("dragend", () => {
      thead.querySelectorAll("th").forEach((h) => h.classList.remove("col-dragging", "col-drag-over"));
      dragSrcKey = null;
    });

    thead.addEventListener("dragover", (e) => {
      const th = e.target.closest("th[data-col]");
      if (!th || !dragSrcKey || th.dataset.col === dragSrcKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      thead.querySelectorAll("th").forEach((h) => h.classList.remove("col-drag-over"));
      th.classList.add("col-drag-over");
    });

    thead.addEventListener("dragleave", (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        thead.querySelectorAll("th").forEach((h) => h.classList.remove("col-drag-over"));
      }
    });

    thead.addEventListener("drop", (e) => {
      const th = e.target.closest("th[data-col]");
      if (!th || !dragSrcKey || th.dataset.col === dragSrcKey) return;
      e.preventDefault();
      const toKey = th.dataset.col;
      table.querySelectorAll("tr").forEach((row) => {
        const fromCell = row.querySelector(`[data-col="${dragSrcKey}"]`);
        const toCell   = row.querySelector(`[data-col="${toKey}"]`);
        if (!fromCell || !toCell) return;
        const siblings = Array.from(row.children);
        if (siblings.indexOf(fromCell) < siblings.indexOf(toCell)) {
          row.insertBefore(fromCell, toCell.nextSibling);
        } else {
          row.insertBefore(fromCell, toCell);
        }
      });
      const newOrder = Array.from(thead.querySelectorAll("tr:first-child th[data-col]"))
        .map((h) => h.dataset.col);
      saveColOrder(newOrder);
      dragSrcKey = null;
    });
  }

  initColDrag();

  return {
    renderRows, refreshRows, buildSavePayload,
    getSelectedIds, updateDirtyUI, markDirty, updateSelectionUI,
    applyColVis, renderColVisMenu, applyFilter, load,
    applyAuthStatusColors, rolesChipsHtml, groupOptionsHtml,
  };
}
