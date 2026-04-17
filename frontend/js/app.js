import { api } from "./api.js";
import { renderCreate } from "./views/create.js";
import { renderImport } from "./views/import.js";
import { renderBrowse } from "./views/browse.js";
import { renderAttributes } from "./views/attributes.js";
import { renderSettings, initTheme } from "./views/settings.js";

const statusDot = document.getElementById("status-dot");
const container = document.getElementById("view-container");

const routes = {
  create: renderCreate,
  import: renderImport,
  browse: renderBrowse,
  attributes: renderAttributes,
  settings: renderSettings,
};

const versionEl = document.getElementById("version-info");

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
  const hash = (location.hash || "#/create").replace("#/", "");
  return routes[hash] ? hash : "create";
}

async function renderView() {
  const route = currentRoute();
  container.innerHTML = "";
  document.querySelectorAll(".sidebar nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === route);
  });
  try {
    await routes[route](container);
  } catch (err) {
    container.innerHTML = `<div class="alert error">View error: ${err.message}</div>`;
  }
}

window.addEventListener("hashchange", renderView);

initTheme();
checkHealth();
setInterval(checkHealth, 15000);
renderView();
