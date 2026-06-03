// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
import {
  getColumns, getOrderedColumns, esc,
  getPageSize, getCoaReauthOnSave, setCoaReauthOnSave,
  loadColVis, saveColVis,
  applyBackendColPrefs, setColPrefsSyncFn, syncColPrefsNow,
  normalizeMac, fmtAgo, coaSummaryText,
  groupHierarchyOptionsHtml,
  loadMarkedMacs, clearMarkedMacs,
} from "./browse-utils.js";
import { initFilter } from "./browse-filter.js";
import { initTable  } from "./browse-table.js";
import { initDetail } from "./browse-detail.js";
import { initBulk   } from "./browse-bulk.js";

export async function renderBrowse(container) {
  // Hent kolonnepræferencer fra backend inden HTML/state initialiseres,
  // så getOrderedColumns() og loadColVis() returnerer serverens værdier.
  try {
    const prefs = await api.getMyPrefs();
    applyBackendColPrefs(prefs.col_order, prefs.col_vis, prefs.col_widths);
  } catch { /* ignorér — falder tilbage til localStorage */ }

  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">${t("browse.title")}</h2>
      <span id="pxgrid-source-badge"
            title="${t("browse.pxgrid_badge_title")}"
            style="padding:3px 10px; border-radius:12px; font-size:0.8em; background:#e5e7eb; color:#374151; white-space:nowrap;">
        ${t("browse.pxgrid_badge")}
      </span>
    </div>
    <div id="anomaly-banner" style="display:none;"></div>
    <div class="card">
      <div class="toolbar">
        <div class="toolbar-group" title="${t("browse.tooltip_data")}">
          <button id="refresh-btn">${t("browse.btn_refresh")}</button>
          <button id="export-btn" class="secondary">${t("browse.btn_export")}</button>
          <button id="export-json-btn" class="secondary">${t("browse.btn_export_json")}</button>
          <button id="new-group-btn" class="secondary hidden" title="${t("browse.new_group_title")}">${t("browse.new_group_btn")}</button>
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
                    title="${t("browse.views_btn_title")}">${t("browse.btn_views")}</button>
            <div id="views-menu" class="views-menu hidden"></div>
          </div>
          <button id="portal-filter-btn" class="secondary"
                  title="${t("browse.portal_filter_title")}">${t("browse.btn_portal_filter")}</button>
          <button id="share-filter-btn" class="secondary small"
                  title="${t("browse.share_filter_title")}">${t("browse.btn_share_filter")}</button>
          <input id="global-q-input" type="search" placeholder="${t("browse.search_placeholder")}"
                 title="${t("browse.search_title")}"
                 style="width:160px;padding:3px 6px;font-size:.85em;" />
        </div>
        <div class="spacer"></div>
        <div class="toolbar-group" title="${t("browse.tooltip_save")}">
          <button id="coa-toggle-btn" class="secondary"
                  title="${t("browse.coa_title")}">${t("browse.btn_coa_off")}</button>
          <button id="undo-btn" class="secondary" disabled title="${t("browse.undo_title")}">↩</button>
          <button id="save-all-btn" disabled title="${t("browse.save_all_title")}">${t("browse.btn_save_all")}</button>
        </div>
        <span class="toolbar-divider"></span>
        <div class="toolbar-group" title="${t("browse.tooltip_selection")}">
          <span id="selection-count" class="hint"></span>
          <button id="bulk-edit-btn" class="secondary small" disabled>${t("browse.btn_bulk_edit")}</button>
          <button id="bulk-save-btn" class="small" disabled>${t("browse.btn_bulk_save")}</button>
          <button id="bulk-coa-btn" class="secondary small" disabled
                  title="${t("browse.coa_reauth_btn_title")}">CoA Reauth</button>
          <button id="bulk-disconnect-btn" class="danger small" disabled
                  title="${t("browse.disconnect_title")}">${t("browse.btn_bulk_disconnect")}</button>
          <button id="bulk-tpl-btn" class="secondary small" disabled
                  title="${t("browse.tpl_btn_title")}">${t("browse.btn_bulk_tpl")}</button>
          <button id="bulk-del-btn" class="danger small" disabled>${t("browse.btn_bulk_delete")}</button>
          <button id="bulk-decomm-btn" class="danger small" disabled
                  title="${t("browse.decomm_btn_title")}">${t("browse.btn_bulk_decomm")}</button>
          <button id="bulk-undecomm-btn" class="warning small" disabled
                  title="${t("browse.undecomm_btn_title")}">${t("browse.btn_bulk_undecomm")}</button>
          <button id="bulk-sim-btn" class="secondary small" disabled
                  title="${t("browse.sim_btn_title")}">${t("browse.sim_btn")}</button>
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
              <th><button type="button" id="filter-clear-all-btn" class="filter-clear-all-btn hidden" title="${t("browse.filter_clear_title")}">×</button></th>
              ${getOrderedColumns().map((c) => `
                <th data-col="${c.key}"${c.cls ? ` class="${c.cls}"` : ""}>
                  ${c.key === "auth_status"
                    ? `<select id="auth-status-filter" class="auth-status-select" title="${t("browse.auth_filter_label")}">
                        <option value="all">${t("browse.auth_filter_all")}</option>
                        <option value="auth">${t("browse.auth_filter_auth")}</option>
                        <option value="notauth">${t("browse.auth_filter_notauth")}</option>
                      </select>`
                    : c.key === "first_seen"
                      ? `<div class="first-seen-filter-wrap">
                          <div class="first-seen-dt-row">
                            <input type="date" id="first-seen-from-d" class="first-seen-date" title="${t("filter.first_seen_from")}" />
                            <input type="text" id="first-seen-from-t" class="first-seen-time" maxlength="5" placeholder="HH:MM" title="${t("filter.first_seen_from")}" />
                          </div>
                          <div class="first-seen-dt-row">
                            <input type="date" id="first-seen-to-d"   class="first-seen-date" title="${t("filter.first_seen_to")}" />
                            <input type="text" id="first-seen-to-t"   class="first-seen-time" maxlength="5" placeholder="HH:MM" title="${t("filter.first_seen_to")}" />
                          </div>
                        </div>`
                    : c.key === "mac"
                      ? `<input type="text" class="col-filter-input" data-col="mac" placeholder="…" />
                         <div class="mac-type-chips">
                           <button type="button" class="mac-chip" data-chip="private" title="${t("browse.mac_private_title")}">${t("browse.mac_private_btn")}</button>
                           <button type="button" class="mac-chip" data-chip="marked" title="${t("browse.mac_marked_title")}">${t("browse.mac_marked_btn")}</button>
                           <button type="button" class="mac-chip" data-chip="decomm" title="${t("browse.decomm_chip_title")}">${t("browse.decomm_chip_btn")}</button>
                           <button type="button" class="mac-chip chip-active-status" data-chip="active-status" title="${t("browse.active_status_chip_title")}">${t("browse.active_status_chip_default")}</button>
                         </div>`
                      : `<input type="text" class="col-filter-input" data-col="${c.key}" placeholder="…" />`}
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
        <div class="detail-tab-bar">
          <button class="detail-tab-btn active" data-tab="endpoint">${t("detail.tab_endpoint")}</button>
          <button class="detail-tab-btn" data-tab="radius">${t("detail.tab_radius")}</button>
          <button class="detail-tab-btn" data-tab="profil">${t("detail.tab_profil")}</button>
          <button class="detail-tab-btn" data-tab="historik">${t("browse.tab_historik")}</button>
          <button class="detail-tab-btn" data-tab="session">${t("browse.tab_session")}</button>
        </div>
        <div class="detail-tab-panels">
          <div id="detail-tab-endpoint" class="detail-tab-panel">
            <div class="detail-grid">
              <label>MAC</label><div class="detail-value" id="d-mac"></div>
              <label>Vendor</label><div class="detail-value" id="d-vendor"></div>
              <label>Name</label><div class="detail-value" id="d-name"></div>
              <label>ID</label><div class="detail-value mono" id="d-id"></div>
              <label>Identity Group</label>
              <div class="group-select-wrap">
                <select id="d-group"></select>
                <div id="d-group-path" class="group-path-hint"></div>
              </div>
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
              <label>${t("detail.status_lbl")}</label>
              <div class="detail-value" id="d-status"></div>
              <label>${t("detail.active_status_lbl")}</label>
              <div class="detail-value" id="d-active-status"></div>

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
          </div>
          <div id="detail-tab-radius" class="detail-tab-panel hidden">
            <div id="d-policy-match-area"></div>
            <div id="d-policy-wizard-area"></div>
          </div>
          <div id="detail-tab-profil" class="detail-tab-panel hidden">
            <div id="d-profiling-content"></div>
            <div id="d-iseids-content"></div>
          </div>
          <div id="detail-tab-historik" class="detail-tab-panel hidden">
            <div id="d-historik-content"><span class="hint">${t("browse.hist_hint")}</span></div>
          </div>
          <div id="detail-tab-session" class="detail-tab-panel hidden">
            <div id="d-session-debug-content"><span class="hint">${t("browse.session_hint")}</span></div>
          </div>
        </div>
        <div class="detail-tpl-bar">
          <select id="d-tpl-select" class="detail-tpl-select">
            <option value="">${t("detail.tpl_none")}</option>
          </select>
          <button type="button" id="d-tpl-apply" class="secondary small">${t("detail.btn_apply_tpl")}</button>
          <button type="button" id="d-save-as-tpl" class="secondary small">${t("detail.btn_save_as_tpl")}</button>
        </div>
        <div class="modal-actions">
          <button id="d-save">${t("detail.btn_save")}</button>
          <button id="d-disconnect" class="danger"
                  title="CoA Disconnect">${t("detail.btn_disconnect")}</button>
          <button id="d-decommission" class="danger" style="display:none"
                  title="${t("detail.decomm_title")}">${t("detail.btn_decommission")}</button>
          <button id="d-undecommission" class="warning" style="display:none"
                  title="${t("detail.undecomm_title")}">${t("detail.btn_undecommission")}</button>
          <button id="d-set-aktiv" class="success" style="display:none"
                  title="${t("detail.set_aktiv_title")}">${t("detail.btn_set_aktiv")}</button>
          <button id="d-set-inaktiv" class="warning" style="display:none"
                  title="${t("detail.set_inaktiv_title")}">${t("detail.btn_set_inaktiv")}</button>
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
          <hr style="margin:0.75rem 0;border:0;border-top:1px solid var(--border,#e2e8f0);">
          <label><input type="checkbox" class="be-cb" data-field="active-status" /> ${t("bulk.active_status_lbl")}</label>
          <select id="be-active-status" disabled>
            <option value="Aktiv">${t("detail.active_status_aktiv")}</option>
            <option value="Inaktiv">${t("detail.active_status_inaktiv")}</option>
          </select>
        </div>
        <div class="modal-actions">
          <button id="be-apply">${t("bulk.btn_apply")}</button>
          <button id="be-cancel" class="secondary">${t("bulk.btn_cancel")}</button>
        </div>
      </div>
    </div>
    <div id="bulk-sim-overlay" class="modal-overlay hidden">
      <div class="modal detail-modal">
        <h3>${t("browse.sim_title_h3")}</h3>
        <p class="hint" id="bulk-sim-count"></p>
        <div class="modal-body">
          <label>${t("browse.sim_policy_label")}
            <select id="bsim-policy-set">
              <option value="">${t("browse.sim_policy_loading")}</option>
            </select>
          </label>
          <datalist id="bsim-radius-attrs-list">
            <option value="Called-Station-ID">
            <option value="NAS-Port-Type">
            <option value="NAS-Identifier">
            <option value="NAS-IP-Address">
            <option value="User-Name">
            <option value="Framed-IP-Address">
            <option value="Service-Type">
            <option value="Calling-Station-Id">
            <option value="EAP-Type">
            <option value="AuthenticationMethod">
          </datalist>
          <div class="radius-section">
            <div class="radius-section-header">
              <span class="radius-prompt-title">${t("browse.sim_radius_title")}</span>
              <button type="button" id="bsim-radius-add" class="secondary small">${t("browse.sim_radius_add")}</button>
            </div>
            <div class="radius-section-hint">${t("browse.sim_radius_hint")}</div>
            <div class="radius-tpl-bar">
              <select id="bsim-radius-tpl-sel" class="radius-tpl-sel"><option value="">${t("browse.sim_tpl_none")}</option></select>
              <button type="button" id="bsim-radius-tpl-load" class="secondary small" title="${t("browse.sim_tpl_load")}">${t("browse.sim_tpl_load")}</button>
              <button type="button" id="bsim-radius-tpl-save" class="secondary small">${t("browse.sim_tpl_save")}</button>
              <button type="button" id="bsim-radius-tpl-del" class="secondary small radius-tpl-del" title="${t("browse.sim_tpl_del_title")}">${t("browse.sim_tpl_del_btn")}</button>
            </div>
            <div id="bsim-radius-rows"></div>
          </div>
        </div>
        <div id="bsim-results" style="display:none;">
          <p id="bsim-summary" class="hint" style="margin:8px 0;"></p>
          <div class="table-scroll" style="max-height:340px;overflow-y:auto;">
            <table class="lc-table">
              <thead><tr>
                <th>MAC</th><th>${t("browse.sim_col_rule")}</th><th>${t("browse.sim_col_profile")}</th><th>Status</th>
              </tr></thead>
              <tbody id="bsim-tbody"></tbody>
            </table>
          </div>
        </div>
        <div class="modal-actions">
          <button id="bsim-run">${t("browse.sim_run_btn")}</button>
          <button id="bsim-cancel" class="secondary">${t("browse.sim_close_btn")}</button>
        </div>
      </div>
    </div>
    <div id="tpl-pick-overlay" class="modal-overlay hidden">
      <div class="modal detail-modal" style="max-width:480px;">
        <h3>${t("bulk.tpl_title")}</h3>
        <p class="hint" id="tpl-pick-count"></p>
        <div class="modal-body">
          <label style="display:block;">${t("bulk.tpl_select_lbl")}
            <select id="tpl-pick-select" style="display:block;width:100%;margin-top:4px;">
              <option value="">${t("bulk.tpl_none")}</option>
            </select>
          </label>
        </div>
        <div class="modal-actions">
          <button id="tpl-pick-apply">${t("bulk.tpl_apply_btn")}</button>
          <button id="tpl-pick-cancel" class="secondary">${t("bulk.btn_cancel")}</button>
        </div>
      </div>
    </div>
    <div id="new-group-overlay" class="modal-overlay hidden">
      <div class="modal" style="max-width:420px;">
        <h3>${t("browse.ng_title")}</h3>
        <div id="new-group-msg"></div>
        <div class="modal-body">
          <label style="display:block;">${t("browse.ng_name_label")}
            <input type="text" id="new-group-name" maxlength="100" placeholder="${t("browse.ng_name_placeholder")}"
                   style="display:block;width:100%;margin-top:4px;box-sizing:border-box;" />
          </label>
          <label style="display:block;margin-top:12px;">${t("browse.ng_parent_label")}
            <select id="new-group-parent"
                    style="display:block;width:100%;margin-top:4px;box-sizing:border-box;">
              <option value="">${t("browse.ng_parent_none")}</option>
            </select>
          </label>
          <label style="display:block;margin-top:12px;">${t("browse.ng_desc_label")}
            <input type="text" id="new-group-desc" maxlength="500" placeholder="${t("browse.ng_desc_placeholder")}"
                   style="display:block;width:100%;margin-top:4px;box-sizing:border-box;" />
          </label>
        </div>
        <div class="modal-actions">
          <button id="new-group-save">${t("browse.ng_save_btn")}</button>
          <button id="new-group-cancel" class="secondary">${t("browse.ng_cancel_btn")}</button>
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
    macPrivate: false, markedOnly: false, decommOnly: false, activeStatusFilter: "",
    pxgridLive: false, pxgridSessionMacs: null, pxgridSessionData: null,
    pxgridLastEventTs: 0, pxgridEndpointEventCount: 0, pxgridLastEndpointEventTs: 0,
  };

  // ── Cross-module callback object (populated after all inits) ──────────────
  const cb = {};

  // ── Kolonnepræferencer: sync til backend ved drag/visibility-ændring ───────
  setColPrefsSyncFn((payload) => {
    api.updateMyPrefs(payload).catch((e) => {
      if (!e?.message?.includes("403")) console.warn("[prefs sync]", e?.message);
    });
  });
  // Sync altid localStorage-tilstand til backend ved init — sikrer korrekt tilstand
  // selv hvis forrige session ikke nåede at gemme, eller brugeren er logget ind på ny.
  syncColPrefsNow();

  // ── Module initialisation ─────────────────────────────────────────────────
  const filterAPI = initFilter(container, state, api, cb);
  const tableAPI  = initTable(container, state, api, cb);
  const detailAPI = initDetail(container, state, api, cb);
  initBulk(container, state, api, cb);

  // ── MAC-type filter chips (Privat / Markeret / DeComm / Aktiv|Inaktiv) ────
  container.querySelectorAll(".mac-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.chip === "active-status") {
        state.activeStatusFilter =
          state.activeStatusFilter === ""       ? "Aktiv"   :
          state.activeStatusFilter === "Aktiv"  ? "Inaktiv" : "";
        chip.classList.toggle("active",      state.activeStatusFilter !== "");
        chip.classList.toggle("chip-aktiv",  state.activeStatusFilter === "Aktiv");
        chip.classList.toggle("chip-inaktiv", state.activeStatusFilter === "Inaktiv");
        chip.textContent =
          state.activeStatusFilter === "Aktiv"   ? t("browse.aktiv_chip_btn")   :
          state.activeStatusFilter === "Inaktiv" ? t("browse.inaktiv_chip_btn") :
          t("browse.active_status_chip_default");
      } else {
        const key = chip.dataset.chip === "private" ? "macPrivate"
                  : chip.dataset.chip === "marked"  ? "markedOnly"
                  : "decommOnly";
        state[key] = !state[key];
        chip.classList.toggle("active", state[key]);
      }
      state.currentPage = 1;
      filterAPI.persistFilters?.();
      cb.onFilterChange?.();
    });
  });

  // Aktivér markeret-chip automatisk hvis vi kom fra Livscyklus
  if (sessionStorage.getItem("browse_marked_filter")) {
    sessionStorage.removeItem("browse_marked_filter");
    if (loadMarkedMacs().size > 0) {
      state.markedOnly = true;
      container.querySelector('.mac-chip[data-chip="marked"]')?.classList.add("active");
    }
  }

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
      try { cb.load?.(false, { silent: true }); } catch {}
    }, 500);
  }

  let pxgridEventSource = null;
  let pxgridErrorTimer  = null;
  let viewActive        = true;

  function startPxGridStream() {
    if (pxgridEventSource) return;
    const base = window.location.origin.startsWith("file://") ? "http://localhost:8000" : "";
    try {
      // withCredentials sender httpOnly cookie automatisk (same-origin + cross-origin)
      pxgridEventSource = new EventSource(
        `${base}/api/pxgrid/sessions/stream`,
        { withCredentials: true },
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
        if (!mac) return;
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
        setTimeout(() => { if (viewActive) startPxGridStream(); }, 5000);
      }
    });
    pxgridEventSource.addEventListener("clear", () => {
      state.pxgridLive         = false;
      state.pxgridSessionMacs  = null;
      state.pxgridSessionData  = null;
      state.activeSessionMacs  = null;
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

  // ── Ny gruppe (admin only) ────────────────────────────────────────────────
  const newGroupBtn     = container.querySelector("#new-group-btn");
  const newGroupOverlay = container.querySelector("#new-group-overlay");
  const newGroupName    = container.querySelector("#new-group-name");
  const newGroupParent  = container.querySelector("#new-group-parent");
  const newGroupDesc    = container.querySelector("#new-group-desc");
  const newGroupMsg     = container.querySelector("#new-group-msg");

  if (auth.isAdmin()) {
    newGroupBtn.classList.remove("hidden");
  }

  newGroupBtn.addEventListener("click", () => {
    newGroupName.value = "";
    newGroupDesc.value = "";
    newGroupMsg.innerHTML = "";
    newGroupParent.innerHTML = groupHierarchyOptionsHtml(state.groups || [], "", t("browse.ng_parent_none"));
    newGroupOverlay.classList.remove("hidden");
    newGroupName.focus();
  });

  container.querySelector("#new-group-cancel").addEventListener("click", () => {
    newGroupOverlay.classList.add("hidden");
  });

  container.querySelector("#new-group-save").addEventListener("click", async () => {
    const name = newGroupName.value.trim();
    if (!name) { newGroupMsg.innerHTML = `<p class="alert error">${t("browse.ng_name_required")}</p>`; return; }
    const saveBtn = container.querySelector("#new-group-save");
    saveBtn.disabled = true;
    newGroupMsg.innerHTML = `<p class="hint">${t("browse.ng_creating")}</p>`;
    try {
      const parentId = newGroupParent.value || undefined;
      await api.createGroup({ name, description: newGroupDesc.value.trim(), parent_id: parentId });
      newGroupOverlay.classList.add("hidden");
      // Genindlæs grupper i state og opdater dropdowns
      try {
        state.groups = await api.listGroups();
        cb.refreshGroupDropdowns?.();
      } catch { /* non-critical */ }
    } catch (err) {
      newGroupMsg.innerHTML = `<p class="alert error">${esc(err.message)}</p>`;
    } finally {
      saveBtn.disabled = false;
    }
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

  // Pre-fill søgning hvis vi er navigeret hertil fra Livscyklus-viewet
  const _pendingEp = sessionStorage.getItem("browse_open_ep");
  if (_pendingEp) {
    sessionStorage.removeItem("browse_open_ep");
    const _qIn = container.querySelector("#global-q-input");
    if (_qIn) {
      _qIn.value = _pendingEp;
      state.fullTextQ = _pendingEp;
      state.allRowsCache = null;
    }
  }

  tableAPI.applyColVis();

  startPxGridStream();
  updatePxGridSourceBadge();

  const badgeTickTimer = setInterval(updatePxGridSourceBadge, 5000);
  window.addEventListener("resize", fitStickyTable);

  // Periodisk re-hentning af alle pxGrid-sessioner for at opsamle MnT-berigelse
  // (ISEPolicySetName, authorizationRuleName m.m. tilføjes af MnT-loopen hvert 5. min
  //  men SSE-streamen sender ikke events for berigede sessions).
  const sessionRefreshTimer = setInterval(async () => {
    if (!viewActive || !state.pxgridLive) return;
    try {
      const res = await api.getPxGridSessions();
      const sessions = res?.sessions || res || [];
      if (!Array.isArray(sessions) || !sessions.length) return;
      if (!state.pxgridSessionData) state.pxgridSessionData = new Map();
      for (const s of sessions) {
        const mac = normalizeMac(s.mac);
        if (mac) state.pxgridSessionData.set(mac, s);
      }
      cb.applyAuthStatusColors?.();
    } catch { /* ignore — SSE stream holder sessioner à jour i realtid */ }
  }, 5 * 60 * 1000);

  // ── Anomali-banner ────────────────────────────────────────────────────────
  const anomalyBanner = container.querySelector("#anomaly-banner");
  const _dismissedAnomalies = new Set();

  function renderAnomalyBanner(anomalies) {
    const active = (anomalies || []).filter((a) => !_dismissedAnomalies.has(a.id));
    if (!active.length) { anomalyBanner.style.display = "none"; anomalyBanner.innerHTML = ""; return; }
    anomalyBanner.style.display = "block";
    anomalyBanner.innerHTML = active.map((a) => `
      <div class="alert ${a.severity === "error" ? "error" : "warning"}" style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">
        <span><strong>${esc(a.title)}</strong> — ${esc(a.body)}</span>
        <button type="button" class="secondary small anomaly-dismiss" data-id="${esc(a.id)}"
                style="margin-left:12px;">${t("browse.anomaly_banner_dismiss")}</button>
      </div>`).join("");
    anomalyBanner.querySelectorAll(".anomaly-dismiss").forEach((btn) => {
      btn.addEventListener("click", () => {
        _dismissedAnomalies.add(btn.dataset.id);
        renderAnomalyBanner(active.filter((a) => a.id !== btn.dataset.id));
      });
    });
  }

  async function pollAnomalies() {
    if (!viewActive) return;
    try {
      const anomalies = await api.getAnomalies();
      renderAnomalyBanner(anomalies || []);
    } catch { /* silent — pxGrid kan være slukket */ }
  }

  pollAnomalies();
  const anomalyPollTimer = setInterval(pollAnomalies, 30_000);

  // force=true: poll altid MnT ved view-mount så auth-status er korrekt fra start.
  await tableAPI.load(true);
  fitStickyTable();

  return function cleanup() {
    viewActive = false;
    stopPxGridStream();
    clearInterval(badgeTickTimer);
    clearInterval(sessionRefreshTimer);
    clearInterval(anomalyPollTimer);
    window.removeEventListener("resize", fitStickyTable);
  };
}
