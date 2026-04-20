import { api, setUnauthorizedHandler } from "./api.js";
import { auth } from "./auth.js";
import { renderCreate } from "./views/create.js";
import { renderImport } from "./views/import.js";
import { renderBrowse } from "./views/browse.js";
import { renderAttributes } from "./views/attributes.js";
import { renderDacls } from "./views/dacls.js";
import { renderLogs } from "./views/logs.js";
import { renderLogin } from "./views/login.js";
import { renderSettings, initTheme } from "./views/settings.js";

const statusDot = document.getElementById("status-dot");
const container = document.getElementById("view-container");

const routes = {
  create: { render: renderCreate, roles: ["admin", "editor"] },
  import: { render: renderImport, roles: ["admin", "editor"] },
  browse: { render: renderBrowse, roles: ["admin", "editor", "viewer"] },
  attributes: { render: renderAttributes, roles: ["admin", "editor"] },
  dacls: { render: renderDacls, roles: ["admin", "editor"] },
  logs: { render: renderLogs, roles: ["admin"] },
  settings: { render: renderSettings, roles: ["admin", "editor", "viewer"] },
};

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
  const hash = (location.hash || "#/browse").replace("#/", "");
  return routes[hash] ? hash : "browse";
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
    userNameEl.textContent = user.username;
    userRoleEl.textContent = user.role;
    userRoleEl.className = `role-badge role-${user.role}`;
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
  renderLogin((user) => {
    updateUserBadge(user);
    updateNavVisibility(user);
    if (!location.hash || location.hash === "#/") location.hash = "#/browse";
    renderView();
  });
}

async function boot() {
  initTheme();
  checkHealth();
  setInterval(checkHealth, 15000);

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
  if (!user) {
    showLogin();
    return;
  }
  // Verify token still valid
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
    // Backend unreachable — keep cached user but show a warning on next call.
    updateUserBadge(user);
    updateNavVisibility(user);
    renderView();
  }
}

boot();
