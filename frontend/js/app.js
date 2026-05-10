import { api, setUnauthorizedHandler } from "./api.js";
import { auth } from "./auth.js";
import { renderImport } from "./views/import.js";
import { renderBrowse } from "./views/browse.js";
import { renderAttributes } from "./views/attributes.js";
import { renderDacls } from "./views/dacls.js";
import { renderLogs } from "./views/logs.js";
import { renderAudit } from "./views/audit.js";
import { renderLogin } from "./views/login.js";
import { renderRegister } from "./views/register.js";
import { renderSettings, initTheme } from "./views/settings.js";
import { renderMetrics } from "./views/metrics.js";
import { renderUserPrefs } from "./views/user-prefs.js";
import { renderCsvTemplate } from "./views/csv-template.js";

const statusDot = document.getElementById("status-dot");
const container = document.getElementById("view-container");

const routes = {
  import:     { render: renderImport,     roles: ["admin", "editor", "editor-psk"] },
  browse:     { render: renderBrowse,     roles: ["admin", "editor", "editor-psk", "viewer"] },
  attributes: { render: renderAttributes, roles: ["admin", "editor"] },
  dacls:      { render: renderDacls,      roles: ["admin", "editor"] },
  logs:       { render: renderLogs,       roles: ["admin"] },
  audit:      { render: renderAudit,      roles: ["admin", "editor", "editor-psk", "viewer"] },
  metrics:    { render: renderMetrics,    roles: ["admin"] },
  register:   { render: renderRegister,   roles: ["admin", "editor", "editor-psk", "registrant", "registrant_templet"] },
  settings:     { render: renderSettings,     roles: ["admin", "editor-psk"] },
  "user-prefs": { render: renderUserPrefs,    roles: ["admin", "editor", "editor-psk", "viewer", "registrant", "registrant_templet"] },
  "csv-template": { render: renderCsvTemplate, roles: ["admin", "editor", "editor-psk"] },
};

const REGISTRAR_DEFAULT_ROUTE = "register";

const versionEl = document.getElementById("version-info");
const userInfoEl = document.getElementById("user-info");
const userNameEl = document.getElementById("user-name");
const userRoleEl = document.getElementById("user-role");
const logoutBtn = document.getElementById("logout-btn");

async function checkHealth() {
  try {
    const data = await api.health();
    statusDot.textContent = "ok";
    statusDot.className = "ok";
    if (data?.full && versionEl) versionEl.textContent = `v${data.full}`;
  } catch {
    statusDot.textContent = "down";
    statusDot.className = "err";
  }
}

function currentRoute() {
  const user = auth.getUser();
  const isLimited = user && (user.role === "registrant" || user.role === "registrant_templet");
  const fallback = isLimited ? REGISTRAR_DEFAULT_ROUTE : "browse";
  const hash = (location.hash || `#/${fallback}`).replace("#/", "");
  if (!routes[hash]) return fallback;
  // Hvis brugeren ikke har adgang til ruten, fallback til en tilladt rute.
  if (user && !routes[hash].roles.includes(user.role)) return fallback;
  return hash;
}

// Sider der skal vises uden sidebar/header (mobil-only chrome).
// Registrar-rollen og udloggede brugere på /#register får helt clear UX,
// så der er plads til mobilformularen. Admin/editor beholder sidebaren
// hvis de besøger /#register, så de stadig kan navigere væk.
function isChromelessRoute() {
  const hash = (location.hash || "").replace("#/", "");
  if (hash !== "register") return false;
  const user = auth.getUser();
  if (!user) return true;
  return user.role === "registrant" || user.role === "registrant_templet";
}

function applyChromeMode() {
  document.body.classList.toggle("register-route", isChromelessRoute());
}

function updateNavVisibility(user) {
  document.querySelectorAll(".sidebar nav a").forEach((a) => {
    const route = routes[a.dataset.view];
    if (!route) return;
    const allowed = route.roles.includes(user.role);
    a.style.display = allowed ? "" : "none";
  });
}

function updateUserBadge(user) {
  if (!userInfoEl) return;
  userInfoEl.hidden = !user;
  if (user) {
    const isTacacs = auth.isTacacs();
    userNameEl.textContent = user.username;
    userRoleEl.textContent = user.role;
    userRoleEl.className = `role-badge role-${user.role}`;
    const tacacsEl = userInfoEl.querySelector(".tacacs-badge");
    if (isTacacs) {
      if (!tacacsEl) {
        const badge = document.createElement("span");
        badge.className = "tacacs-badge";
        badge.title = "Autentiseret via TACACS+";
        badge.textContent = "TACACS+";
        userRoleEl.after(badge);
      }
    } else {
      tacacsEl?.remove();
    }
    const prefsLink = userInfoEl.querySelector(".user-prefs-link");
    if (prefsLink) prefsLink.style.display = isTacacs ? "none" : "";
  }
}

async function renderView() {
  const user = auth.getUser();
  if (!user) {
    showLogin();
    return;
  }
  const route = currentRoute();
  const def = routes[route];
  container.innerHTML = "";
  applyChromeMode();
  document.querySelectorAll(".sidebar nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === route);
  });
  if (!def.roles.includes(user.role)) {
    container.innerHTML = `<div class="alert error">Din rolle (<b>${user.role}</b>) har ikke adgang til denne side.</div>`;
    return;
  }
  try {
    await def.render(container);
  } catch (err) {
    container.innerHTML = `<div class="alert error">View error: ${err.message}</div>`;
  }
}

function showLogin() {
  updateUserBadge(null);
  applyChromeMode();
  renderLogin((user) => {
    updateUserBadge(user);
    updateNavVisibility(user);
    const isLimited = user.role === "registrant" || user.role === "registrant_templet";
    const landing = isLimited ? REGISTRAR_DEFAULT_ROUTE : "browse";
    if (!location.hash || location.hash === "#/") location.hash = `#/${landing}`;
    else if (isLimited && !routes[location.hash.replace("#/", "")]?.roles.includes(user.role)) {
      location.hash = `#/${landing}`;
    }
    renderView();
  });
}

async function boot() {
  initTheme();
  checkHealth();
  setInterval(checkHealth, 15000);

  // PWA: registrér service worker så registreringssiden kan installeres og
  // boote uden netværk. Fejler stille hvis SW ikke er understøttet.
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/service-worker.js");
    } catch { /* ignore */ }
  }

  setUnauthorizedHandler(() => {
    auth.clear();
    showLogin();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try { await api.logout(); } catch {}
      auth.clear();
      showLogin();
    });
  }

  window.addEventListener("hashchange", renderView);

  const user = auth.getUser();
  if (!user || auth.isTokenExpired()) {
    auth.clear();
    showLogin();
    return;
  }
  // Verify token still valid against backend
  try {
    const status = await api.authStatus();
    if (!status.authenticated) {
      auth.clear();
      showLogin();
      return;
    }
    if (status.user) auth.save(auth.getToken(), status.user);
    updateUserBadge(status.user || user);
    updateNavVisibility(status.user || user);
    renderView();
  } catch {
    // Backend unreachable — token is not expired but backend is down.
    // Clear session and force login so user sees a proper error rather than
    // a broken UI with stale data.
    auth.clear();
    showLogin();
  }
}

boot();
