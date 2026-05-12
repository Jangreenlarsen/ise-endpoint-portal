export function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export const FRONTEND_PREFS_KEY = "ise_portal_prefs";

export function loadFrontendPrefs() {
  try {
    return JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveFrontendPrefs(prefs) {
  localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(prefs));
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "light");
}

export function initTheme() {
  const prefs = loadFrontendPrefs();
  applyTheme(prefs.theme);
}
