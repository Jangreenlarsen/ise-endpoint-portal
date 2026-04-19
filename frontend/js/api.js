const BASE = window.location.origin.startsWith("file://")
  ? "http://localhost:8000"
  : "";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
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
  bulkCreateEndpoints: (items) =>
    request("/endpoints/bulk", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  updateEndpoint: (id, payload) =>
    request(`/endpoints/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEndpoint: (id) =>
    request(`/endpoints/${id}`, { method: "DELETE" }),
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
  getLogs: (lines = 500, level = "", search = "") => {
    const parts = [`lines=${lines}`];
    if (level) parts.push(`level=${encodeURIComponent(level)}`);
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    return request(`/logs?${parts.join("&")}`);
  },
};
