// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Pure utility functions and constants shared across browse modules.
import { t } from "../i18n.js";

export const FRONTEND_PREFS_KEY = "ise_portal_prefs";
export function getPageSize() {
  try { return JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}").pageSize || 100; }
  catch { return 100; }
}
export function savePageSize(size) {
  try {
    const p = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    p.pageSize = size;
    localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}
export function getCoaReauthOnSave() {
  try { return !!JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}").coaReauthOnSave; }
  catch { return false; }
}
export function setCoaReauthOnSave(enabled) {
  try {
    const p = JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
    p.coaReauthOnSave = !!enabled;
    localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

export const BROWSE_FILTERS_KEY = "ise_portal_browse_filters";
export function loadBrowseFilters() {
  try { return JSON.parse(localStorage.getItem(BROWSE_FILTERS_KEY) || "null"); }
  catch { return null; }
}
export function saveBrowseFilters(snapshot) {
  try { localStorage.setItem(BROWSE_FILTERS_KEY, JSON.stringify(snapshot)); }
  catch { /* ignore */ }
}

export const COLVIS_KEY = "ise_portal_browse_colvis";
export function loadColVis() {
  try {
    const raw = localStorage.getItem(COLVIS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function saveColVis(snapshot) {
  try { localStorage.setItem(COLVIS_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
  _syncColPrefs();
}

export const COLORDER_KEY = "ise_portal_browse_colorder";
export function loadColOrder() {
  try {
    const raw = localStorage.getItem(COLORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function saveColOrder(order) {
  try { localStorage.setItem(COLORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  _syncColPrefs();
}

export const MARKED_MACS_KEY = "ise_portal_marked_macs";
export function loadMarkedMacs() {
  try {
    const raw = localStorage.getItem(MARKED_MACS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
export function saveMarkedMacs(set) {
  try { localStorage.setItem(MARKED_MACS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}
export function addMarkedMacs(macs) {
  const set = loadMarkedMacs();
  for (const m of macs) set.add(m);
  saveMarkedMacs(set);
  return set;
}
export function clearMarkedMacs() {
  try { localStorage.removeItem(MARKED_MACS_KEY); } catch { /* ignore */ }
}

export const COLWIDTHS_KEY = "ise_portal_browse_colwidths";
export function loadColWidths() {
  try {
    const raw = localStorage.getItem(COLWIDTHS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function saveColWidths(widths) {
  try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(widths)); } catch { /* ignore */ }
  _syncColPrefs();
}

// Skriv backend-præferencer direkte til localStorage uden at trigge backend-sync.
// Kun brugt ved browse-init — skriv KUN hvis localStorage mangler data (tom session,
// incognito, ny enhed). Har brugeren allerede lokale præferencer bevares de, og
// syncColPrefsNow() uploader dem til backend i stedet.
export function applyBackendColPrefs(order, vis, widths) {
  try {
    if (Array.isArray(order) && order.length && !loadColOrder())
      localStorage.setItem(COLORDER_KEY, JSON.stringify(order));
    if (vis && typeof vis === "object" && !Array.isArray(vis) && !loadColVis())
      localStorage.setItem(COLVIS_KEY, JSON.stringify(vis));
    if (widths && typeof widths === "object" && !Array.isArray(widths) && !loadColWidths())
      localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(widths));
  } catch { /* ignore */ }
}

// Backend-sync callback — sættes af browse.js ved init.
let _prefsSyncFn = null;
export function setColPrefsSyncFn(fn) { _prefsSyncFn = fn; }
export function syncColPrefsNow() { _syncColPrefs(); }

function _syncColPrefs() {
  if (!_prefsSyncFn) return;
  try {
    const payload = {};
    const order  = loadColOrder();
    const vis    = loadColVis();
    const widths = loadColWidths();
    if (order)  payload.col_order  = order;
    if (vis)    payload.col_vis    = vis;
    if (widths) payload.col_widths = widths;
    if (Object.keys(payload).length) _prefsSyncFn(payload);
  } catch { /* ignore */ }
}
export function getOrderedColumns() {
  const cols = getColumns();
  const order = loadColOrder();
  if (!order || !order.length) return cols;
  const map = new Map(cols.map(c => [c.key, c]));
  const ordered = order.map(k => map.get(k)).filter(Boolean);
  const orderSet = new Set(order);
  for (const c of cols) { if (!orderSet.has(c.key)) ordered.push(c); }
  return ordered;
}

export function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
export function endpointCreateTime(r) {
  return r.create_time || r.update_time || "";
}
export function fmtRelativeAge(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return t("age.today");
  if (days === 1) return t("age.yesterday");
  if (days < 30) return `${days} ${t("age.days")}`;
  if (days < 365) return `${Math.floor(days / 30)} ${t("age.months")}`;
  return `${Math.floor(days / 365)} ${t("age.years")}`;
}
export function fmtDateTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtAgo(ts) {
  if (!ts) return null;
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}t`;
}
export function normalizeMac(s) {
  return (s || "").replace(/-/g, ":").trim().toUpperCase();
}
export function coaSummaryText(coa) {
  const bits = [];
  if (coa.reauths) bits.push(`${coa.reauths} reauth`);
  if (coa.disconnects) bits.push(`${coa.disconnects} disconnect (AireOS)`);
  const okPart = bits.length ? bits.join(" + ") : `${coa.ok} ok`;
  return `, CoA: ${okPart}${coa.fail ? `, ${coa.fail} fejl` : ""}`;
}
export function optionsHtml(values, selected) {
  const opts = [`<option value="">—</option>`];
  for (const v of values) {
    opts.push(`<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`);
  }
  return opts.join("");
}

export const EIG_PREFIX = "Endpoint Identity Groups:";

/**
 * Build <option> HTML for an ISE endpoint group list showing the full path.
 *
 * groups  — array of { id, name } where name is the full ISE path
 *           e.g. "Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"
 * selId   — currently selected group ID (or "" for none)
 *
 * Each option shows the full path with " / " separators so every level is
 * visible without guessing where a group sits in the hierarchy:
 *   Profiled
 *   Profiled / ADM-Apple-iPhone
 *   Profiled / ADM-Apple-iPhone / SubGroup
 *   Profiled / Android
 *   Unknown / SomeChild
 *
 * Alphabetical sort guarantees parents appear before their own children.
 */
export function groupHierarchyOptionsHtml(groups, selId, emptyLabel = null) {
  const sel  = (g) => g.id === selId ? " selected" : "";
  let   html = `<option value="">${esc(emptyLabel ?? t("cell.no_group"))}</option>`;

  if (!groups.length) return html;

  const items = groups.map((g) => {
    const rest  = g.name.startsWith(EIG_PREFIX) ? g.name.slice(EIG_PREFIX.length) : g.name;
    const parts = rest.split(":");
    return { ...g, _sort: rest.toLowerCase(), _label: parts.join(" / "), _parts: parts };
  }).sort((a, b) => a._sort.localeCompare(b._sort));

  for (const g of items) {
    html += `<option value="${esc(g.id)}"${sel(g)}>${esc(g._label)}</option>`;
  }

  return html;
}

/**
 * Render stacked path lines for a group name (used in detail-modal path hint).
 * Returns array of path segments, e.g. ["Profiled", "Apple-Device", "Leaf"].
 */
export function groupPathParts(groupName) {
  if (!groupName) return [];
  const rest = groupName.startsWith(EIG_PREFIX) ? groupName.slice(EIG_PREFIX.length) : groupName;
  return rest.split(":").filter(Boolean);
}

// getColumns() evalueres ved hvert kald så labels afspejler aktivt sprog.
export function getColumns() {
  return [
    { key: "mac",           label: t("col.mac"),          field: (r) => r.mac || r.name },
    { key: "auth_status",   label: t("col.auth_status"),  field: () => "" },
    { key: "vendor",        label: t("col.vendor"),       field: (r) => r.vendor || "" },
    { key: "group_name",    label: t("col.group_name"),   field: (r) => r.group_name },
    { key: "static_group",  label: t("col.static_group"), field: (r) => r.static_group ? t("cell.static") : t("cell.dynamic") },
    { key: "description",   label: t("col.description"),  field: (r) => r.description },
    { key: "endpoint_type", label: t("col.endpoint_type"),field: (r) => r.endpoint_type },
    { key: "owner",         label: t("col.owner"),        field: (r) => r.owner },
    { key: "lokation",      label: t("col.lokation"),     field: (r) => r.lokation },
    { key: "registret_by",      label: t("col.registret_by"),      field: (r) => r.registret_by },
    { key: "guest_registration", label: t("col.guest_registration"), field: (r) => r.guest_registration },
    { key: "platform_type", label: t("col.platform_type"),field: (r) => r.platform_type },
    { key: "psk_mode",      label: t("col.psk_mode"),     field: (r) => r.psk_mode ? t("cell.yes") : "" },
    { key: "psk_key",       label: t("col.psk_key"),      field: (r) => r.psk_key || "",       cls: "authz-col" },
    { key: "authz_vlan",    label: t("col.authz_vlan"),   field: (r) => r.authz_vlan,          cls: "authz-col" },
    { key: "authz_acl",     label: t("col.authz_acl"),    field: (r) => r.authz_acl,           cls: "authz-col" },
    { key: "roles",         label: t("col.roles"),        field: (r) => (r.roles || []).join(", ") },
    { key: "first_seen",    label: t("col.first_seen"),   field: (r) => r.first_seen_at ? fmtDateTime(new Date(r.first_seen_at * 1000).toISOString()) : "—" },
    { key: "nas",           label: t("col.nas"),          field: () => "" },
    { key: "ise_session",   label: t("col.ise_session"),  field: () => "" },
  ];
}
