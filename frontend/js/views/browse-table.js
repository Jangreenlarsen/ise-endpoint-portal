// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Table rendering, inline-edit, pagination, col-vis, save, export.
// initTable wires all table DOM events and returns its public API.
// Cross-module calls go via `cb` (populated in browse.js after all inits).

import { t } from "../i18n.js";
import {
  getColumns, getOrderedColumns, esc,
  endpointCreateTime, fmtRelativeAge, fmtDateTime,
  normalizeMac, coaSummaryText, optionsHtml,
  loadColVis, saveColVis, savePageSize, saveColOrder,
  loadColWidths, saveColWidths,
  groupHierarchyOptionsHtml,
  loadMarkedMacs, saveMarkedMacs,
} from "./browse-utils.js";
import { toIseCsv, downloadCsv } from "../csv.js";

export function initTable(container, state, api, cb) {
  let _markedMacs = loadMarkedMacs();

  const tbody          = container.querySelector("#tbody");
  const msg            = container.querySelector("#msg");
  const countEl        = container.querySelector("#count");
  const saveAllBtn     = container.querySelector("#save-all-btn");
  const undoBtn        = container.querySelector("#undo-btn");
  const selectAllCb    = container.querySelector("#select-all");
  const bulkSaveBtn    = container.querySelector("#bulk-save-btn");
  const bulkDisconnBtn = container.querySelector("#bulk-disconnect-btn");
  const bulkCoaBtn     = container.querySelector("#bulk-coa-btn");
  const bulkEditBtn    = container.querySelector("#bulk-edit-btn");
  const bulkSimBtn     = container.querySelector("#bulk-sim-btn");
  const selectionCount = container.querySelector("#selection-count");
  const pagePrev       = container.querySelector("#page-prev");
  const pageNext       = container.querySelector("#page-next");
  const pageInfo       = container.querySelector("#page-info");
  const pageSizeSelect = container.querySelector("#page-size-select");
  const colVisBtn      = container.querySelector("#col-vis-btn");
  const colVisMenu     = container.querySelector("#col-vis-menu");
  const exportBtn      = container.querySelector("#export-btn");
  const exportJsonBtn  = container.querySelector("#export-json-btn");
  const refreshBtn     = container.querySelector("#refresh-btn");

  // ── Render helpers (need state.groups / state.roleCatalog) ───────────────
  function groupOptionsHtml(selectedId) {
    return groupHierarchyOptionsHtml(state.groups, selectedId);
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
  let _colVisSavedTimer = null;
  function _flashColVisSaved() {
    if (_colVisSavedTimer) clearTimeout(_colVisSavedTimer);
    colVisBtn.dataset.saved = "1";
    _colVisSavedTimer = setTimeout(() => {
      delete colVisBtn.dataset.saved;
      _colVisSavedTimer = null;
    }, 1800);
  }

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
        _flashColVisSaved();
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

  // ── Locally Administered Address (private/randomised MAC) detection ────────
  function isLocallyAdministered(mac) {
    if (!mac) return false;
    const firstOctet = parseInt((mac.split(/[:\-]/)[0] || ""), 16);
    return !isNaN(firstOctet) && (firstOctet & 0x02) !== 0;
  }

  function laaTag() {
    const n = state.laaTotal ?? 0;
    if (!n) return "";
    return ` <span class="laa-count" title="${t("browse.laa_total_title")}">${t("browse.laa_n_private").replace("{n}", n)}</span>`;
  }

  function macDisplayHtml(mac) {
    if (!mac) return "";
    if (!isLocallyAdministered(mac)) return esc(mac);
    const sep   = mac.includes(":") ? ":" : "-";
    const parts = mac.split(sep);
    return `<span class="mac-laa" title="${t("browse.laa_title")}">${esc(parts[0])}</span>${esc(sep + parts.slice(1).join(sep))}`;
  }

  // ── NAS → PlatformType auto-derive ──────────────────────────────────────
  function getNasPlatformType(mac) {
    if (!state.pxgridSessionData) return "";
    const sess = state.pxgridSessionData.get(normalizeMac(mac));
    return sess?.nas_device_type || "";
  }

  // ── ISE session combo cell ───────────────────────────────────────────────
  function iseSessionCellHtml(mac) {
    if (!state.pxgridSessionData) return '<span class="hint">—</span>';
    const sess = state.pxgridSessionData.get(normalizeMac(mac));
    if (!sess) return '<span class="hint">—</span>';
    const auth       = sess.policy_set_name    || "";
    const authMethod = sess.auth_method        || "";
    const authz      = sess.authz_rule_name    || "";
    const profs      = (sess.authz_profiles || []).filter(Boolean);
    const dacl       = sess.dacl               || "";
    const vlan       = sess.vlan               || "";
    const sgt        = sess.cts_security_group || "";
    if (!auth && !authMethod && !authz && !profs.length && !dacl && !vlan && !sgt) return '<span class="hint">—</span>';
    // Extract numeric VLAN from e.g. "(tag=0) 32" → "32"
    const vlanMatch = vlan.match(/(\d+)\s*$/);
    const vlanNum   = vlanMatch ? vlanMatch[1] : "";
    // Endpoint row for authz_acl (WLC ACL) and psk_key
    const row      = (state.allRows || []).find(r => normalizeMac(r.mac || r.name) === normalizeMac(mac));
    const authzAcl = row?.authz_acl || "";
    const pskKey   = row?.psk_key   || "";
    const lines = [];
    // Auth: policy set name or auth method badge
    if (auth) {
      lines.push(`<span class="ise-sess-row"><span class="ise-sess-lbl">${t("browse.sess_auth_label")}:</span> <span class="ise-sess-val">${esc(auth)}</span></span>`);
    } else if (authMethod) {
      lines.push(`<span class="ise-sess-row"><span class="ise-sess-lbl">${t("browse.sess_auth_label")}:</span> <span class="ise-sess-val ise-sess-badge ise-sess-method">${esc(authMethod.toUpperCase())}</span></span>`);
    }
    // Profiles: one per line, no label. Contextual value appended based on profile name pattern.
    let daclInProfile = false;
    if (profs.length) {
      for (const p of profs) {
        let suffix = "";
        if (/vlan/i.test(p) && vlanNum)           { suffix = vlanNum; }
        else if (/dacl/i.test(p) && dacl)         { suffix = dacl; daclInProfile = true; }
        else if (/airspace/i.test(p) && authzAcl) { suffix = authzAcl; }
        else if (/psk.*key/i.test(p) && pskKey)   { suffix = state.pskShowKey ? pskKey : "***"; }
        const label = suffix ? `${esc(p)}:${esc(suffix)}` : esc(p);
        lines.push(`<span class="ise-sess-row ise-sess-prof">${label}</span>`);
      }
    } else if (authz) {
      lines.push(`<span class="ise-sess-row ise-sess-prof">${esc(authz)}</span>`);
    }
    // DACL badge only if not already shown inline via Endpoint_DACL profile
    if (dacl && !daclInProfile) lines.push(`<span class="ise-sess-row"><span class="ise-sess-lbl">${t("browse.sess_dacl_label")}:</span> <span class="ise-sess-val ise-sess-badge ise-sess-dacl">${esc(dacl)}</span></span>`);
    if (sgt) lines.push(`<span class="ise-sess-row"><span class="ise-sess-lbl">${t("browse.sess_sgt_label")}:</span> <span class="ise-sess-val ise-sess-badge ise-sess-sgt">${esc(sgt)}</span></span>`);
    return `<div class="ise-sess-combo">${lines.join("")}</div>`;
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
      const macCell        = tr.querySelector(".mac-cell");
      const authStatusCell = tr.querySelector(".auth-status-col");
      if (!macCell) return;
      macCell.classList.remove("auth-active", "auth-failed");
      if (authStatusCell) { authStatusCell.className = "auth-status-col"; authStatusCell.textContent = ""; }
      if (!macs) return;
      const mac    = tr.dataset.mac;
      const isAuth = mac ? macs.has(mac) : false;
      if (mac) macCell.classList.add(isAuth ? "auth-active" : "auth-failed");
      if (authStatusCell && mac) {
        authStatusCell.classList.add(isAuth ? "auth-active" : "auth-failed");
        authStatusCell.textContent = isAuth ? "●" : "○";
      }
    });
  }

  // ── Row rendering ────────────────────────────────────────────────────────
  function renderRows(rows) {
    _markedMacs = loadMarkedMacs();
    // Bevar selektion på tværs af genrender (pxGrid auto-refresh, manuel refresh, osv.)
    const prevSelected = new Set(
      Array.from(tbody.querySelectorAll(".row-select:checked"))
        .map((cb) => cb.closest("tr")?.dataset.id)
        .filter(Boolean)
    );

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
        mac:           `<td data-col="mac" class="mac-cell${r.cache_stale ? " cache-stale" : ""}"><a href="#" class="mac-link" title="${t("browse.mac_link_title")}">${macDisplayHtml(mac)}</a>${r.cache_stale ? `<span class="stale-badge" title="${t("browse.stale_badge_title")}">⏱</span>` : ""}${_markedMacs.has(normalizeMac(mac)) ? `<span class="marked-pin" title="${t("browse.marked_pin_title")}">📌</span>` : ""}${r.status === "Decommissioned" ? `<span class="decomm-row-badge" title="${t("browse.decomm_badge_title")}">⚰</span>` : ""}${r.active_status === "Inaktiv" ? `<span class="active-status-row-badge inaktiv" title="${t("detail.active_status_inaktiv")}">⊘</span>` : r.active_status === "Aktiv" ? `<span class="active-status-row-badge aktiv" title="${t("detail.active_status_aktiv")}">✓</span>` : ""}</td>`,
        auth_status:   `<td data-col="auth_status" class="auth-status-col"></td>`,
        vendor:        `<td data-col="vendor" class="vendor-cell-td">${esc(r.vendor || "")}</td>`,
        group_name:    `<td data-col="group_name"><select class="grp-select">${groupOptionsHtml(r.group_id)}</select></td>`,
        static_group:  `<td data-col="static_group" class="assign-cell">${r.static_group ? t("cell.static") : t("cell.dynamic")}</td>`,
        description:   `<td data-col="description"><input type="text" class="desc-input" value="${esc(r.description || "")}" /></td>`,
        endpoint_type: `<td data-col="endpoint_type"><select class="ca-type">${optionsHtml(state.caValues.Type, r.endpoint_type)}</select></td>`,
        owner:         `<td data-col="owner"><select class="ca-owner">${optionsHtml(state.caValues.Owner, r.owner)}</select></td>`,
        lokation:      `<td data-col="lokation"><select class="ca-lokation">${optionsHtml(state.caValues.Lokation, r.lokation)}</select></td>`,
        registret_by:       `<td data-col="registret_by"><input type="text" class="ca-registretby desc-input" value="${esc(r.registret_by || "")}" /></td>`,
        guest_registration: `<td data-col="guest_registration"><select class="ca-guestreg">${optionsHtml(["true","false"], r.guest_registration)}</select></td>`,
        platform_type: nasPt
          ? `<td data-col="platform_type" class="platform-auto-td"><div class="platform-auto-wrap"><select class="ca-platformtype" disabled>${optionsHtml(state.caValues.PlatformType, nasPt)}</select><span class="platform-auto-badge" title="${t("browse.platform_auto_title")}">&#9889;</span></div></td>`
          : `<td data-col="platform_type"><select class="ca-platformtype">${optionsHtml(state.caValues.PlatformType, r.platform_type)}</select></td>`,
        psk_mode:      `<td data-col="psk_mode" class="psk-mode-cell"><input type="checkbox" class="psk-mode-cb"${r.psk_mode ? " checked" : ""}${state.isPskEditor ? "" : " disabled"} title="MPSK/IPSK" /></td>`,
        psk_key:       `<td data-col="psk_key" class="authz-col psk-key-cell mono">${state.pskShowKey ? esc(r.psk_key || "") : (r.psk_key ? "••••••" : "")}</td>`,
        authz_vlan:    `<td data-col="authz_vlan" class="authz-col"><select class="ca-authzvlan">${optionsHtml(state.caValues.AuthzVlan, r.authz_vlan)}</select></td>`,
        authz_acl:     `<td data-col="authz_acl" class="authz-col"><select class="ca-authzacl">${optionsHtml(state.caValues.AuthzACL, r.authz_acl)}</select></td>`,
        roles:         `<td data-col="roles" class="roles-cell">${rolesChipsHtml(r.roles)}</td>`,
        create_time:   `<td data-col="create_time" class="age-cell" title="${esc(fmtDateTime(endpointCreateTime(r)))}">${esc(fmtRelativeAge(endpointCreateTime(r)))}</td>`,
        first_seen:    `<td data-col="first_seen" class="age-cell">${esc(r.first_seen_at ? fmtDateTime(new Date(r.first_seen_at * 1000).toISOString()) : "—")}</td>`,
        nas:           `<td data-col="nas" class="nas-info-col">${nasInfoCellHtml(mac)}</td>`,
        ise_session:   `<td data-col="ise_session" class="ise-session-col">${iseSessionCellHtml(mac)}</td>`,
      };
      return `
      <tr data-id="${esc(r.id)}" data-mac="${esc(normalizeMac(mac))}"${(() => { const c = [state.dirtyIds.has(r.id) && "dirty", r.status === "Decommissioned" && "row-decomm"].filter(Boolean).join(" "); return c ? ` class="${c}"` : ""; })()}>
        <td class="select-cell"><input type="checkbox" class="row-select"${prevSelected.has(r.id) ? " checked" : ""} /></td>
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
      if (macLink) macLink.innerHTML = macDisplayHtml(r.mac || r.name);
      const macCellTd = tr.querySelector(".mac-cell");
      if (macCellTd) {
        const freshMarked = loadMarkedMacs();
        const pin = macCellTd.querySelector(".marked-pin");
        const nowMarked = freshMarked.has(normalizeMac(r.mac || r.name || ""));
        if (pin && !nowMarked) pin.remove();
        else if (!pin && nowMarked) macCellTd.insertAdjacentHTML("beforeend", `<span class="marked-pin" title="Markeret fra Livscyklus">📌</span>`);
      }
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
          let wrap = ptTd.querySelector(".platform-auto-wrap");
          if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "platform-auto-wrap";
            ptSel.replaceWith(wrap);
            wrap.appendChild(ptSel);
          }
          wrap.appendChild(badge);
        } else if (!nasPt2 && oldBadge) {
          oldBadge.remove();
          const wrap = ptTd.querySelector(".platform-auto-wrap");
          if (wrap) { wrap.replaceWith(ptSel || wrap.querySelector(".ca-platformtype")); }
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
      delete tr.dataset.beActiveStatus;
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
      const regByInp = tr.querySelector(".ca-registretby");
      if (regByInp) regByInp.value = r.registret_by || "";
      const guestRegSel = tr.querySelector(".ca-guestreg");
      if (guestRegSel) guestRegSel.innerHTML = optionsHtml(["true","false"], r.guest_registration || "");
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
          let wrap = ptTd.querySelector(".platform-auto-wrap");
          if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "platform-auto-wrap";
            ptSel.replaceWith(wrap);
            wrap.appendChild(ptSel);
          }
          wrap.appendChild(badge);
        } else if (!nasPt && oldBadge) {
          oldBadge.remove();
          const wrap = ptTd.querySelector(".platform-auto-wrap");
          if (wrap) { wrap.replaceWith(wrap.querySelector(".ca-platformtype")); }
        }
      }

      const pskCb = tr.querySelector(".psk-mode-cb");
      if (pskCb) pskCb.checked = !!r.psk_mode;
      delete tr.dataset.bePskKey;
      delete tr.dataset.beActiveStatus;

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
    bulkDisconnBtn.disabled = !hasSelection;
    bulkEditBtn.disabled    = !hasSelection;
    if (bulkCoaBtn)  bulkCoaBtn.disabled  = !hasSelection;
    if (bulkSimBtn)  bulkSimBtn.disabled  = !hasSelection;
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
    const registretBy     = tr.querySelector(".ca-registretby")?.value || "";
    const guestReg        = tr.querySelector(".ca-guestreg")?.value || "";
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
    const bePskKey      = state.isPskEditor && tr.dataset.bePskKey !== undefined ? tr.dataset.bePskKey : undefined;
    const beActiveStatus = tr.dataset.beActiveStatus;

    return {
      id,
      mac: tr.querySelector(".mac-cell").textContent,
      payload: {
        description, group_id, static_group_assignment,
        custom_attributes: {
          Type: endpointType, Owner: owner, Lokation: lokation,
          AuthzVlan: authzVlan, AuthzACL: authzAcl, PlatformType: platformType,
          RegistretBy: registretBy,
          GuestRegistration: guestReg,
          HypervisionRoles: hypervisionRoles,
          ...(state.isPskEditor && pskMode !== null ? { PSK_Mode: pskMode ? "true" : "false" } : {}),
          ...(bePskKey !== undefined && bePskKey !== "****" ? { PSK_Key: bePskKey } : {}),
          ...(beActiveStatus !== undefined ? { HypervisionActive: beActiveStatus } : {}),
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
        countEl.innerHTML = t("browse.filtered_info")
          .replace("{filtered}", filtered.length)
          .replace("{all}", state.allRows.length)
          + laaTag();
      } else {
        countEl.innerHTML = t("browse.all_info").replace("{n}", state.allRows.length)
          + laaTag();
      }
    } else {
      const rows = state.hideDecommissioned
        ? state.allRows.filter((r) => r.status !== "Decommissioned")
        : state.allRows;
      renderRows(rows);
      updatePaginationUI();
      countEl.innerHTML = t("browse.server_info")
        .replace("{n}", rows.length)
        .replace("{total}", state.totalEndpoints)
        + laaTag();
    }
  }

  // ── Load (full page refresh) ─────────────────────────────────────────────
  // silent=true: baggrunds-reload (pxGrid endpoint_changed) — vis ikke loading-spinner
  // og lad eksisterende rækker stå mens data hentes, så selektion bevares og
  // kolonner ikke flipper.
  async function load(force = false, { silent = false } = {}) {
    const cols = getColumns().length + 2;
    if (!silent) {
      tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">${t("browse.fetching_ise")}</td></tr>`;
    }
    msg.innerHTML = "";
    state.dirtyIds.clear();
    updateDirtyUI();
    state.filterMode  = false;
    state.allRowsCache = null;
    try {
      const [caData, grps, result, dacls, mapping, roles, me, pskPolicy, epStats] = await Promise.all([
        api.listCustomAttributes(),
        api.listGroups(),
        api.listEndpointDetails(state.currentPage, state.currentSize, "", state.currentFilters),
        api.listDacls().catch(() => []),
        api.getPlatformMapping().catch(() => ({ mappings: [] })),
        api.listEndpointRoles().catch(() => ({ roles: [] })),
        api.authMe().catch(() => null),
        api.getPskPolicy().catch(() => null),
        api.getEndpointStats().catch(() => null),
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
      state.allRows        = result.items;
      state.totalEndpoints = result.total;
      state.laaTotal       = epStats ? epStats.laa_count : null;
      if (cb.needsFilterMode()) await cb.enterFilterMode();
      await cb.refreshActiveSessionMacs(force);
      applyFilter();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
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
    if (!confirm(t("browse.undo_confirm").replace("{n}", state.dirtyIds.size))) return;
    revertDirtyRows();
    msg.innerHTML = `<div class="alert info">${t("browse.undo_ok")}</div>`;
  });

  // ── Fælles save-loop med progress-indikator ──────────────────────────────
  function showSaveProgress(done, total, mac) {
    const pct = total > 1 ? Math.round((done / total) * 100) : 100;
    const macHint = mac ? ` <span class="save-progress-mac">${esc(mac)}</span>` : "";
    msg.innerHTML = `
      <div class="alert info save-progress-wrap">
        <span class="save-progress-label">${t("browse.save_progress").replace("{done}", done).replace("{total}", total)}${macHint}</span>
        <div class="save-progress-bar"><div class="save-progress-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  // ── Fjern markering fra localStorage + DOM efter vellykket gem ──────────────
  function unmarkSaved(id) {
    const tr  = tbody.querySelector(`tr[data-id="${id}"]`);
    const mac = tr?.dataset.mac
             || normalizeMac(state.allRows?.find(r => r.id === id)?.mac || "");
    if (!mac) return;
    const marked = loadMarkedMacs();
    if (!marked.delete(mac)) return;
    saveMarkedMacs(marked);
    tr?.querySelector(".marked-pin")?.remove();
    if (marked.size === 0 && state.markedOnly) {
      state.markedOnly = false;
      container.querySelector('.mac-chip[data-chip="marked"]')?.classList.remove("active");
    }
  }

  async function runSaveLoop(ids) {
    let ok = 0, fail = 0;
    const savedEntries = [];
    const total = ids.length;
    showSaveProgress(0, total, null);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      const mac = tr.querySelector(".mac-cell")?.textContent?.trim() || id;
      showSaveProgress(i + 1, total, total > 1 ? mac : null);
      const { payload, platformType } = buildSavePayload(tr);
      try {
        await api.updateEndpoint(id, payload);
        state.dirtyIds.delete(id);
        savedEntries.push({ id, platformType });
        ok++;
      } catch { fail++; }
    }
    return { ok, fail, savedEntries };
  }

  // Save all dirty rows
  saveAllBtn.addEventListener("click", async () => {
    if (!state.dirtyIds.size) return;
    saveAllBtn.disabled = true;
    const ids = [...state.dirtyIds];
    const { ok, fail, savedEntries } = await runSaveLoop(ids);
    let coaSummary = "";
    if (state.coaOnSave && savedEntries.length) {
      msg.innerHTML = `<div class="alert info">${t("browse.coa_n").replace("{n}", savedEntries.length)}</div>`;
      const coa = await cb.runCoaForIds(savedEntries);
      coaSummary = coaSummaryText(coa);
    }
    savedEntries.forEach(e => unmarkSaved(e.id));
    await refreshRows(savedEntries.map((s) => s.id));
    const parts = [];
    if (ok)   parts.push(t("browse.saved_n").replace("{n}", ok));
    if (fail) parts.push(t("browse.failed_n").replace("{n}", fail));
    msg.innerHTML = `<div class="alert ${fail ? "error" : "success"}">${parts.join(", ")}${coaSummary}</div>`;
    saveAllBtn.disabled = false;
  });

  // Bulk save selected rows
  bulkSaveBtn.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    bulkSaveBtn.disabled = true;
    const { ok, fail, savedEntries } = await runSaveLoop(ids);
    let coaSummary = "";
    if (state.coaOnSave && savedEntries.length) {
      msg.innerHTML = `<div class="alert info">${t("browse.coa_n").replace("{n}", savedEntries.length)}</div>`;
      const coa = await cb.runCoaForIds(savedEntries);
      coaSummary = coaSummaryText(coa);
    }
    savedEntries.forEach(e => unmarkSaved(e.id));
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
        msg.innerHTML = `<div class="alert error">${t("browse.export_error").replace("{msg}", esc(err.message))}</div>`;
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

  // Export JSON
  exportJsonBtn.addEventListener("click", async () => {
    const selectedIds = getSelectedIds();
    let exportRows;
    let allLabel = false;
    if (selectedIds.length) {
      const selSet = new Set(selectedIds);
      exportRows   = state.allRows.filter((r) => selSet.has(r.id));
    } else if (state.filterMode) {
      exportRows = cb.applyFiltersToRows(state.allRows);
    } else {
      exportJsonBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("browse.export_fetching")}</div>`;
      try {
        exportRows = state.allRowsCache || (state.allRowsCache = await api.listAllEndpointDetails("", state.currentFilters));
        allLabel   = true;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("browse.export_error").replace("{msg}", esc(err.message))}</div>`;
        exportJsonBtn.disabled = false;
        return;
      }
      exportJsonBtn.disabled = false;
    }
    if (!exportRows.length) {
      msg.innerHTML = `<div class="alert info">${t("browse.export_none")}</div>`;
      return;
    }
    const json = JSON.stringify(exportRows, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `ise-endpoints-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    let doneMsg;
    if (selectedIds.length) {
      doneMsg = t("browse.export_json_done_selected").replace("{n}", exportRows.length);
    } else if (allLabel) {
      doneMsg = t("browse.export_json_done_all").replace("{n}", exportRows.length);
    } else {
      doneMsg = t("browse.export_json_done_filtered").replace("{n}", exportRows.length);
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

  // ── Column resize ────────────────────────────────────────────────────────
  // Bruger th's højre border som visuel handle — aldrig klippet af table-layout.
  // pointerdown på th med proximity-check: kun indenfor 8px af højre kant.
  // setPointerCapture sikrer at alle events fanges under drag.
  function wireColResize() {
    const tbl = container.querySelector(".browse-table-wrap table");
    if (!tbl) return;
    const headerRow = tbl.querySelector("thead tr:first-child");
    if (!headerRow) return;
    const saved = loadColWidths() || {};
    for (const th of headerRow.querySelectorAll("th[data-col]")) {
      const key = th.dataset.col;
      if (saved[key]) {
        th.style.width    = saved[key] + "px";
        th.style.minWidth = saved[key] + "px";
      }

      th.addEventListener("pointerdown", (e) => {
        const rect = th.getBoundingClientRect();
        if (e.clientX < rect.right - 8) return; // ikke nær højre kant
        e.stopPropagation();
        e.preventDefault();
        th.setPointerCapture(e.pointerId);
        th.draggable = false;           // undgår column-drag under resize
        th.classList.add("col-resizing");
        document.body.style.userSelect = "none";
        const startX = e.clientX;
        const startW = rect.width;

        function onMove(ev) {
          const w = Math.max(48, startW + ev.clientX - startX);
          th.style.width    = w + "px";
          th.style.minWidth = w + "px";
        }
        function onUp() {
          th.removeEventListener("pointermove",   onMove);
          th.removeEventListener("pointerup",     onUp);
          th.removeEventListener("pointercancel", onUp);
          th.classList.remove("col-resizing");
          th.draggable = true;
          document.body.style.userSelect = "";
          const widths = {};
          for (const h of headerRow.querySelectorAll("th[data-col]")) {
            if (h.style.width) widths[h.dataset.col] = Math.round(h.getBoundingClientRect().width);
          }
          saveColWidths(widths);
        }
        th.addEventListener("pointermove",   onMove);
        th.addEventListener("pointerup",     onUp, { once: true });
        th.addEventListener("pointercancel", onUp, { once: true });
      });
    }
  }

  wireColResize();

  return {
    renderRows, refreshRows, buildSavePayload, unmarkSaved,
    getSelectedIds, updateDirtyUI, markDirty, updateSelectionUI,
    applyColVis, renderColVisMenu, applyFilter, load,
    applyAuthStatusColors, rolesChipsHtml, groupOptionsHtml,
  };
}
