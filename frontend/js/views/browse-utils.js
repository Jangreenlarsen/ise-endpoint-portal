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

const EIG_PREFIX = "Endpoint Identity Groups:";

/**
 * Build hierarchical <optgroup> HTML for an ISE endpoint group list.
 *
 * groups  — array of { id, name } where name is the full ISE path
 *           e.g. "Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"
 * selId   — currently selected group ID (or "" for none)
 *
 * Renders:
 *   <optgroup label="Endpoint Identity Groups"> — direct children
 *   <optgroup label="↳ Profiled">               — children of Profiled
 *   … one optgroup per parent that has sub-groups
 */
export function groupHierarchyOptionsHtml(groups, selId, emptyLabel = null) {
  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name));

  // Separate by depth after the root prefix
  const level1   = sorted.filter((g) => {
    const rest = g.name.startsWith(EIG_PREFIX) ? g.name.slice(EIG_PREFIX.length) : g.name;
    return !rest.includes(":");
  });
  const deeper   = sorted.filter((g) => {
    const rest = g.name.startsWith(EIG_PREFIX) ? g.name.slice(EIG_PREFIX.length) : g.name;
    return rest.includes(":");
  });

  // Group deeper items by immediate parent full-path
  const byParent = new Map();
  for (const g of deeper) {
    const parts      = g.name.split(":");
    const parentName = parts.slice(0, -1).join(":");
    if (!byParent.has(parentName)) byParent.set(parentName, []);
    byParent.get(parentName).push(g);
  }

  const sel = (g) => g.id === selId ? " selected" : "";
  const shortName = (g) => g.name.split(":").pop();

  let html = `<option value="">${esc(emptyLabel ?? t("cell.no_group"))}</option>`;

  // Root optgroup — direct children of "Endpoint Identity Groups"
  if (level1.length || deeper.length) {
    html += `<optgroup label="${esc(EIG_PREFIX.slice(0, -1))}">`;
    for (const g of level1) {
      html += `<option value="${esc(g.id)}"${sel(g)}>${esc(shortName(g))}</option>`;
    }
    html += `</optgroup>`;
  }

  // One optgroup per parent-with-children, sorted by parent path
  for (const [parentPath, children] of [...byParent.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parentLabel = "↳ " + (parentPath.startsWith(EIG_PREFIX) ? parentPath.slice(EIG_PREFIX.length) : parentPath);
    html += `<optgroup label="${esc(parentLabel)}">`;
    for (const g of children) {
      html += `<option value="${esc(g.id)}"${sel(g)}>${esc(shortName(g))}</option>`;
    }
    html += `</optgroup>`;
  }

  return html;
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
    { key: "platform_type", label: t("col.platform_type"),field: (r) => r.platform_type },
    { key: "psk_mode",      label: t("col.psk_mode"),     field: (r) => r.psk_mode ? t("cell.yes") : "" },
    { key: "psk_key",       label: t("col.psk_key"),      field: (r) => r.psk_key || "",       cls: "authz-col" },
    { key: "authz_vlan",    label: t("col.authz_vlan"),   field: (r) => r.authz_vlan,          cls: "authz-col" },
    { key: "authz_acl",     label: t("col.authz_acl"),    field: (r) => r.authz_acl,           cls: "authz-col" },
    { key: "roles",         label: t("col.roles"),        field: (r) => (r.roles || []).join(", ") },
    { key: "first_seen",    label: t("col.first_seen"),   field: (r) => r.first_seen_at ? fmtRelativeAge(new Date(r.first_seen_at * 1000).toISOString()) : "—" },
    { key: "nas",           label: t("col.nas"),          field: () => "" },
    { key: "ise_session",   label: t("col.ise_session"),  field: () => "" },
  ];
}
