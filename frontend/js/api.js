const BASE = window.location.origin.includes("file://")
  ? "http://localhost:8000"
  : "";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => request("/health"),
  listEndpoints: (page = 1, size = 100) =>
    request(`/endpoints?page=${page}&size=${size}`),
  listGroups: () => request("/groups"),
  createEndpoint: (payload) =>
    request("/endpoints", { method: "POST", body: JSON.stringify(payload) }),
  deleteEndpoint: (id) =>
    request(`/endpoints/${id}`, { method: "DELETE" }),
};
