import { auth } from "./auth.js";

const BASE = window.location.origin.startsWith("file://")
  ? "http://localhost:8000"
  : "";

// Paths that don't require a Bearer token. /auth/status is NOT in this list:
// it must forward the token so the backend can verify it — otherwise every
// page reload reports authenticated=false and wipes the user's session.
const UNAUTH_PATHS = new Set([
  "/health",
  "/auth/login",
  "/auth/setup",
]);

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = auth.getToken();
  if (token && !UNAUTH_PATHS.has(path.split("?")[0])) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
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
  listAllEndpointDetails: (search = "", filters = []) => {
    const parts = [];
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    for (const f of filters || []) {
      if (f) parts.push(`filter=${encodeURIComponent(f)}`);
    }
    const qs = parts.length ? `?${parts.join("&")}` : "";
    return request(`/endpoints/details/all${qs}`);
  },
  getEndpoint: (id) => request(`/endpoints/${encodeURIComponent(id)}`),
  listGroups: () => request("/groups"),
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
};
