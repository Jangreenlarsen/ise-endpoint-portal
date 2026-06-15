// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { auth } from "./auth.js";

const BASE = window.location.origin.startsWith("file://")
  ? "http://localhost:8000"
  : "";

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function requestTimed(path, options = {}) {
  const { _noContentType, _timeout, ...fetchOpts } = options;
  const headers = _noContentType
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  const timeoutMs = _timeout ?? 30_000;
  const signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api${path}`, { ...fetchOpts, headers, signal, credentials: "include" });
  const totalMs = Math.round(performance.now() - t0);
  if (res.status === 401) {
    auth.clear();
    if (onUnauthorized) onUnauthorized();
    throw new Error("401: ikke logget ind");
  }
  if (!res.ok) {
    let detail = await res.text();
    try { const p = JSON.parse(detail); detail = p.detail || detail; } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }
  const data = res.status === 204 ? null : await res.json();
  const cacheAge = parseFloat(res.headers.get("X-Cache-Age-Seconds") ?? "-1");
  const fromCacheHdr = res.headers.get("X-From-Cache");
  const fromCache = fromCacheHdr !== null ? fromCacheHdr === "true" : (cacheAge >= 0 && cacheAge < 5);
  return { data, totalMs, fromCache, cacheAge };
}

async function request(path, options = {}) {
  // _noContentType: true bruges ved FormData-uploads (browser sætter selv boundary)
  const { _noContentType, _timeout, ...fetchOpts } = options;
  const headers = _noContentType
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  // Token sendes som httpOnly cookie — ingen Authorization header nødvendig.
  const timeoutMs = _timeout ?? 30_000;
  const signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const res = await fetch(`${BASE}/api${path}`, { ...fetchOpts, headers, signal, credentials: "include" });
  if (res.status === 401) {
    auth.clear();
    if (onUnauthorized) onUnauthorized();
    throw new Error("401: ikke logget ind");
  }
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      detail = parsed.detail || detail;
    } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => request("/health"),
  listEndpoints: (page = 1, size = 100, search = "", filters = []) => {
    const parts = [`page=${page}`, `size=${size}`];
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    for (const f of filters || []) {
      if (f) parts.push(`filter=${encodeURIComponent(f)}`);
    }
    return request(`/endpoints?${parts.join("&")}`);
  },
  listEndpointDetails: (page = 1, size = 100, search = "", filters = []) => {
    const parts = [`page=${page}`, `size=${size}`];
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    for (const f of filters || []) {
      if (f) parts.push(`filter=${encodeURIComponent(f)}`);
    }
    return request(`/endpoints/details?${parts.join("&")}`);
  },
  listAllEndpointDetails: (search = "", filters = [], q = "") => {
    const parts = [];
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    for (const f of filters || []) {
      if (f) parts.push(`filter=${encodeURIComponent(f)}`);
    }
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    const qs = parts.length ? `?${parts.join("&")}` : "";
    return request(`/endpoints/details/all${qs}`);
  },
  getEndpoint: (id) => requestTimed(`/endpoints/${encodeURIComponent(id)}`),
  getProfilingData: (id) => request(`/endpoints/${encodeURIComponent(id)}/profiling-data`),
  getProfilerProfile: (id) => request(`/endpoints/${encodeURIComponent(id)}/profiler-profile`),
  prioritizeEndpoint: (id) => request(`/endpoints/${encodeURIComponent(id)}/prioritize`, { method: "POST" }),
  listGroups: () => request("/groups"),
  createGroup: (payload) =>
    request("/groups", { method: "POST", body: JSON.stringify(payload) }),
  createEndpoint: (payload) =>
    request("/endpoints", { method: "POST", body: JSON.stringify(payload) }),
  bulkCreateEndpoints: (items, overwrite = false) =>
    request("/endpoints/bulk", {
      method: "POST",
      body: JSON.stringify({ items, overwrite }),
    }),
  updateEndpoint: (id, payload) =>
    request(`/endpoints/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEndpoint: (id) =>
    request(`/endpoints/${id}`, { method: "DELETE" }),
  listActiveSessionMacs: () => request("/endpoints/session-macs"),
  getEndpointStats: () => request("/endpoints/stats"),
  coaReauth: (id) =>
    request(`/endpoints/${encodeURIComponent(id)}/coa-reauth`, { method: "POST" }),
  coaDisconnect: (id) =>
    request(`/endpoints/${encodeURIComponent(id)}/coa-disconnect`, { method: "POST" }),
  getBackendSettings: () => request("/settings/backend"),
  updateBackendSettings: (payload) =>
    request("/settings/backend", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  testBackendConnection: (payload) =>
    request("/settings/test", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  listCustomAttributes: () => request("/custom-attributes"),
  addCustomAttributeValue: (name, value) =>
    request(`/custom-attributes/${encodeURIComponent(name)}/values`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  removeCustomAttributeValue: (name, value) =>
    request(
      `/custom-attributes/${encodeURIComponent(name)}/values/${encodeURIComponent(value)}`,
      { method: "DELETE" },
    ),
  ensureCustomAttrDefinitions: () =>
    request("/custom-attributes/ensure-definitions", { method: "POST" }),
  syncCustomAttributes: () =>
    request("/custom-attributes/sync", { method: "POST" }),
  syncPlatformFromMnt: (overwrite = false) =>
    request(
      `/custom-attributes/PlatformType/sync-mnt${overwrite ? "?overwrite=true" : ""}`,
      { method: "POST" },
    ),
  getPlatformMapping: () =>
    request("/custom-attributes/PlatformType/mapping"),
  setPlatformMapping: (mappings) =>
    request("/custom-attributes/PlatformType/mapping", {
      method: "PUT",
      body: JSON.stringify({ mappings }),
    }),
  getNasDevicesByPlatform: () =>
    request("/custom-attributes/PlatformType/nas-devices"),
  refreshNasDevices: () =>
    request("/custom-attributes/PlatformType/nas-devices/refresh", { method: "POST" }),
  listDacls: () => request("/dacls"),
  getDacl: (id) => request(`/dacls/${encodeURIComponent(id)}`),
  createDacl: (payload) =>
    request("/dacls", { method: "POST", body: JSON.stringify(payload) }),
  updateDacl: (id, payload) =>
    request(`/dacls/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteDacl: (id) =>
    request(`/dacls/${encodeURIComponent(id)}`, { method: "DELETE" }),
  validateDacl: (dacl, dacl_type = "IPV4") =>
    request("/dacls/validate", {
      method: "POST",
      body: JSON.stringify({ dacl, dacl_type }),
    }),
  getLogs: (lines = 500, level = "", search = "") => {
    const parts = [`lines=${lines}`];
    if (level) parts.push(`level=${encodeURIComponent(level)}`);
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    return request(`/logs?${parts.join("&")}`);
  },
  authStatus: () => request("/auth/status"),
  login: (username, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/auth/logout", { method: "POST" }),
  refreshToken: () => request("/auth/refresh", { method: "POST" }),
  githubCheck: () => request("/update/github-check"),
  githubPull:  () => request("/update/github-pull", { method: "POST" }),
  setupAdmin: (username, password) =>
    request("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  changePassword: (current_password, new_password) =>
    request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),
  getCacheStats: () => request("/cache/stats"),
  invalidateCache: () => request("/cache/invalidate", { method: "POST" }),
  getPxGridSettings: () => request("/settings/pxgrid"),
  updatePxGridSettings: (payload) =>
    request("/settings/pxgrid", { method: "PUT", body: JSON.stringify(payload) }),
  getPxGridStatus: () => request("/settings/pxgrid/status"),
  getPxGridWorkerStatus: () => request("/pxgrid/worker/status"),
  testPxGridConnection: () =>
    request("/settings/pxgrid/test", { method: "POST" }),
  createPxGridAccount: () =>
    request("/settings/pxgrid/account", { method: "POST" }),
  generatePxGridCsr: () =>
    request("/settings/pxgrid/csr", { method: "POST" }),
  resetPxGridRegistration: () =>
    request("/settings/pxgrid/reset", { method: "POST" }),
  runPxGridStompProbe: (duration = 10) =>
    request(`/settings/pxgrid/stomp-probe?duration=${duration}`, { method: "POST" }),
  // Saved views (3.9.0)
  listMyViews: () => request("/me/views"),
  createMyView: (name, query) =>
    request("/me/views", { method: "POST", body: JSON.stringify({ name, query }) }),
  updateMyView: (id, payload) =>
    request(`/me/views/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteMyView: (id) =>
    request(`/me/views/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getPxGridSessions: () => request("/pxgrid/sessions"),
  getPxGridSession: (mac) => request(`/pxgrid/sessions/${encodeURIComponent(mac)}`),
  debugPxGridSession: (mac) => request(`/pxgrid/sessions/${encodeURIComponent(mac)}/debug`),
  probeMntSession: (mac) => request(`/pxgrid/probe/mnt/${encodeURIComponent(mac)}`),
  getAnomalies: () => request("/pxgrid/anomalies"),
  getPxGridWorkerStatus: () => request("/pxgrid/worker/status"),
  restartPxGridWorker: () =>
    request("/pxgrid/worker/restart", { method: "POST" }),
  downloadPxGridCsr: async () => {
    const res = await fetch(`${BASE}/api/settings/pxgrid/csr/download`, { credentials: "include" });
    if (!res.ok) {
      let detail = await res.text();
      try { detail = JSON.parse(detail).detail || detail; } catch {}
      throw new Error(`${res.status}: ${detail}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    const filename = m ? decodeURIComponent(m[1]) : "pxgrid.csr.pem";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
  uploadPxGridPfx: async (file, password) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("password", password || "");
    const res = await fetch(`${BASE}/api/settings/pxgrid/pfx`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      let detail = await res.text();
      try { detail = JSON.parse(detail).detail || detail; } catch {}
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json();
  },
  uploadPxGridCert: async (kind, file) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    const res = await fetch(`${BASE}/api/settings/pxgrid/cert`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      let detail = await res.text();
      try { detail = JSON.parse(detail).detail || detail; } catch {}
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json();
  },
  lookupOui: (mac) => request(`/oui/${encodeURIComponent(mac)}`),
  getOuiStats: () => request("/oui/stats"),
  listAuditEvents: (params = {}) => {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      parts.push(`${k}=${encodeURIComponent(v)}`);
    }
    const qs = parts.length ? `?${parts.join("&")}` : "";
    return request(`/audit${qs}`);
  },
  getAuditEvent: (id) => request(`/audit/${encodeURIComponent(id)}`),
  rollbackAuditEvent: (id) =>
    request(`/audit/${encodeURIComponent(id)}/rollback`, { method: "POST" }),
  listUsers: () => request("/users"),
  createUser: (payload) =>
    request("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id, payload) =>
    request(`/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteUser: (id) =>
    request(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setUserEndpointRoles: (id, roles) =>
    request(`/users/${encodeURIComponent(id)}/endpoint-roles`, {
      method: "PUT",
      body: JSON.stringify({ roles }),
    }),
  setUserTemplates: (id, template_ids) =>
    request(`/users/${encodeURIComponent(id)}/templates`, {
      method: "PUT",
      body: JSON.stringify({ template_ids }),
    }),
  listEndpointRoles: () => request("/endpoint-roles"),
  createEndpointRole: (payload) =>
    request("/endpoint-roles", { method: "POST", body: JSON.stringify(payload) }),
  deleteEndpointRole: (name) =>
    request(`/endpoint-roles/${encodeURIComponent(name)}`, { method: "DELETE" }),
  authMe: () => request("/auth/me"),
  getPskPolicy: () => request("/settings/psk-policy"),
  updatePskPolicy: (payload) =>
    request("/settings/psk-policy", { method: "PUT", body: JSON.stringify(payload) }),
  generatePskKey: (policy = null) => request("/settings/psk-policy/generate", {
    method: "POST",
    body: policy ? JSON.stringify(policy) : undefined,
  }),
  validateUpdate: (file) => {
    const fd = new FormData(); fd.append("file", file);
    return request("/update/validate", { method: "POST", body: fd, _noContentType: true });
  },
  applyUpdate: (file) => {
    const fd = new FormData(); fd.append("file", file);
    return request("/update/apply", { method: "POST", body: fd, _noContentType: true });
  },
  restartServer: () => request("/update/restart", { method: "POST" }),
  diagnostics:        () => request("/diagnostics",          { _timeout: 30_000 }),
  diagnosticsQuick:   () => request("/diagnostics/quick",    { _timeout: 10_000 }),
  selfregisterMntProbe: () => request("/selfregister/mnt-probe", { _timeout: 20_000 }),
  featureCheckPhase1: () => request("/feature-check/phase1", { _timeout: 10_000 }),
  featureCheckPhase2: () => request("/feature-check/phase2", { _timeout: 30_000 }),
  sysinfo:            () => request("/sysinfo",              { _timeout:  5_000 }),
  listAncPolicies: () => request("/endpoints/anc-policies"),
  ancStatus: (id) => request(`/endpoints/${encodeURIComponent(id)}/anc-status`),
  ancQuarantine: (id, policyName) =>
    request(`/endpoints/${encodeURIComponent(id)}/anc-quarantine`, {
      method: "POST",
      body: JSON.stringify({ policy_name: policyName }),
    }),
  ancClear: (id) =>
    request(`/endpoints/${encodeURIComponent(id)}/anc-clear`, { method: "POST" }),
  listTemplates: () => request("/templates"),
  getTemplate: (id) => request(`/templates/${encodeURIComponent(id)}`),
  createTemplate: (payload) =>
    request("/templates", { method: "POST", body: JSON.stringify(payload) }),
  updateTemplate: (id, payload) =>
    request(`/templates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteTemplate: (id) =>
    request(`/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Portal Auth Config + TACACS+
  getPortalAuthConfig: () => request("/settings/auth-config"),
  updatePortalAuthConfig: (payload) =>
    request("/settings/auth-config", { method: "PUT", body: JSON.stringify(payload) }),
  testTacacs: (payload) =>
    request("/settings/auth-config/test", { method: "POST", body: JSON.stringify(payload) }),

  // Per-bruger præferencer (i18n)
  getMyPrefs: () => request("/me/prefs"),
  updateMyPrefs: (payload) =>
    request("/me/prefs", { method: "PUT", body: JSON.stringify(payload) }),

  // Portal locale (i18n — admin)
  getPortalLocale: () => request("/settings/locale"),
  updatePortalLocale: (payload) =>
    request("/settings/locale", { method: "PUT", body: JSON.stringify(payload) }),

  // Operator Profiles
  getOperatorProfiles: () => request("/operator-profiles"),
  createOperatorProfile: (payload) =>
    request("/operator-profiles", { method: "POST", body: JSON.stringify(payload) }),
  updateOperatorProfile: (id, payload) =>
    request(`/operator-profiles/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteOperatorProfile: (id) =>
    request(`/operator-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Authorization Profile Manager (5.1.0)
  listAuthzProfiles: () => request("/authz-profiles"),
  getAuthzProfile: (name) => request(`/authz-profiles/${encodeURIComponent(name)}`),
  checkStandardAuthzProfiles: () => request("/authz-profiles/standard/status"),
  ensureStandardAuthzProfiles: () =>
    request("/authz-profiles/standard/ensure", { method: "POST" }),

  // RADIUS Policy (5.0.0)
  listPolicySets: () => request("/policy/policy-sets"),
  getPolicySet: (id) => request(`/policy/policy-sets/${encodeURIComponent(id)}`),
  listPolicyRules: (setId) => request(`/policy/policy-sets/${encodeURIComponent(setId)}/rules`),
  createPolicyRule: (setId, payload) =>
    request(`/policy/policy-sets/${encodeURIComponent(setId)}/rules`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePolicyRule: (setId, ruleId, payload) =>
    request(`/policy/policy-sets/${encodeURIComponent(setId)}/rules/${encodeURIComponent(ruleId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deletePolicyRule: (setId, ruleId) =>
    request(`/policy/policy-sets/${encodeURIComponent(setId)}/rules/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
    }),
  matchPolicyEndpoint: (setId, epAttrs) =>
    request(`/policy/policy-sets/${encodeURIComponent(setId)}/match`, {
      method: "POST",
      body: JSON.stringify(epAttrs),
    }),
  batchSimulate: (policy_set_id, endpoint_ids, radius_attrs = {}) =>
    request("/policy/batch-simulate", {
      method: "POST",
      body: JSON.stringify({ policy_set_id, endpoint_ids, radius_attrs }),
    }),

  // Endpoint history (5.6.0)
  getEndpointHistory: (id, limit = 50) =>
    request(`/endpoints/${encodeURIComponent(id)}/history?limit=${limit}`),

  // Bulk CoA (5.6.0)
  bulkCoa: (endpoint_ids, action = "reauth") =>
    request("/endpoints/bulk-coa", {
      method: "POST",
      body: JSON.stringify({ endpoint_ids, action }),
    }),

  // ISE PSN nodes (5.6.0)
  getIseNodes: () => request("/ise/nodes"),

  // Endpoint lifecycle (5.6.0)
  getStaleEndpoints: (days = 90) => request(`/lifecycle/stale?days=${days}`),

  // Dashboard (5.6.0)
  getDashboard: () => request("/dashboard"),

  // Alerts (5.6.0)
  getAlerts: () => request("/alerts"),

  // Trend-analyse (5.8.0)
  getTrends: (period = "30d") => request(`/trends?period=${encodeURIComponent(period)}`),

  // Decommission / Undecommission (5.17.0 / 5.19.5)
  decommissionEndpoint: (id) =>
    request(`/endpoints/${encodeURIComponent(id)}/decommission`, { method: "POST" }),

  bulkDecommission: (endpoint_ids) =>
    request("/endpoints/bulk-decommission", {
      method: "POST",
      body: JSON.stringify({ endpoint_ids }),
    }),

  undecommissionEndpoint: (id) =>
    request(`/endpoints/${encodeURIComponent(id)}/undecommission`, { method: "POST" }),

  bulkUndecommission: (endpoint_ids) =>
    request("/endpoints/bulk-undecommission", {
      method: "POST",
      body: JSON.stringify({ endpoint_ids }),
    }),

  setActiveStatus: (id, active_status) =>
    request(`/endpoints/${encodeURIComponent(id)}/active-status`, {
      method: "POST",
      body: JSON.stringify({ active_status }),
    }),

  // Bulk template-apply (5.17.0)
  bulkApplyTemplate: (endpoint_ids, template_id) =>
    request("/endpoints/bulk-apply-template", {
      method: "POST",
      body: JSON.stringify({ endpoint_ids, template_id }),
    }),

  // Metrics historik (5.17.0)
  getMetricsHistory: (names = ["cache_entries", "cache_stale_pct", "ise_requests_total", "circuit_state"], limit = 120) => {
    const qs = names.map((n) => `names=${encodeURIComponent(n)}`).join("&") + `&limit=${limit}`;
    return request(`/metrics/history?${qs}`);
  },

  // nmap scanning (6.6)
  nmapScan: (ip, preset = null, customFlags = null) =>
    request("/nmap/scan", {
      method: "POST",
      body: JSON.stringify({ ip, preset, custom_flags: customFlags }),
    }),
};
