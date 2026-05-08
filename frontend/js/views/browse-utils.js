// Pure utility functions and constants shared across browse modules.

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

export function esc(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
export function endpointCreateTime(r) {
  return r.create_time || r.update_time || "";
}
export function fmtRelativeAge(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "I dag";
  if (days === 1) return "I går";
  if (days < 30) return `${days} dage`;
  if (days < 365) return `${Math.floor(days / 30)} mdr.`;
  return `${Math.floor(days / 365)} år`;
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

export const COLUMNS = [
  { key: "mac",           label: "MAC",            field: (r) => r.mac || r.name },
  { key: "vendor",        label: "Vendor",         field: (r) => r.vendor || "" },
  { key: "group_name",    label: "Identity Group", field: (r) => r.group_name },
  { key: "static_group",  label: "Tilknytning",    field: (r) => r.static_group ? "Statisk" : "Dynamisk" },
  { key: "description",   label: "Description",    field: (r) => r.description },
  { key: "endpoint_type", label: "Type",           field: (r) => r.endpoint_type },
  { key: "owner",         label: "Owner",          field: (r) => r.owner },
  { key: "lokation",      label: "Lokation",       field: (r) => r.lokation },
  { key: "platform_type", label: "Platform",       field: (r) => r.platform_type },
  { key: "psk_mode",      label: "PSK Mode",       field: (r) => r.psk_mode ? "Ja" : "" },
  { key: "psk_key",       label: "PSK Key",        field: (r) => r.psk_key || "",       cls: "authz-col" },
  { key: "authz_vlan",    label: "AuthzVlan",      field: (r) => r.authz_vlan,          cls: "authz-col" },
  { key: "authz_acl",     label: "AuthzACL",       field: (r) => r.authz_acl,           cls: "authz-col" },
  { key: "roles",         label: "System adm",     field: (r) => (r.roles || []).join(", ") },
  { key: "create_time",   label: "Alder",          field: (r) => fmtRelativeAge(endpointCreateTime(r)) },
];
