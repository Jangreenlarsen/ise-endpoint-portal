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
  listEndpoints: (page = 1, size = 100, search = "") => {
    const q = search ? `&search=${encodeURIComponent(search)}` : "";
    return request(`/endpoints?page=${page}&size=${size}${q}`);
  },
  listEndpointDetails: (page = 1, size = 100, search = "") => {
    const q = search ? `&search=${encodeURIComponent(search)}` : "";
    return request(`/endpoints/details?page=${page}&size=${size}${q}`);
  },
  listAllEndpointDetails: (search = "") => {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    return request(`/endpoints/details/all${q}`);
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
};
