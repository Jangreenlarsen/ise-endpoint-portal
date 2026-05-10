import { api } from "../api.js";
import { auth } from "../auth.js";
import { applyTheme } from "./settings.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const FRONTEND_PREFS_KEY = "ise_portal_prefs";

function loadFrontendPrefs() {
  try { return JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}"); }
  catch { return {}; }
}

function saveFrontendPrefs(prefs) {
  localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(prefs));
}

export async function renderUserPrefs(container) {
  const currentUser = auth.getUser();
  const isTacacs = auth.isTacacs();

  const passwordCard = isTacacs
    ? `<div class="card">
        <h3>Password</h3>
        <p class="hint">Logget ind som <b>${esc(currentUser?.username || "")}</b> via <strong>TACACS+</strong>.</p>
        <p>Password administreres af TACACS+-serveren — det kan ikke skiftes her i portalen.</p>
      </div>`
    : `<div class="card">
        <h3>Skift dit password</h3>
        <p class="hint">Logget ind som <b>${esc(currentUser?.username || "")}</b> (rolle: ${esc(currentUser?.role || "")}).</p>
        <div id="pw-msg"></div>
        <form id="pw-form" class="pw-form">
          <div class="field">
            <label for="pw-current">Nuværende password</label>
            <input type="password" id="pw-current" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="pw-new">Nyt password (min. 8 tegn)</label>
            <input type="password" id="pw-new" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="field">
            <label for="pw-new2">Bekræft nyt password</label>
            <input type="password" id="pw-new2" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="actions">
            <button type="submit">Skift password</button>
          </div>
        </form>
      </div>`;

  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">Præferencer</h2>
    </div>
    ${passwordCard}

    <div class="card">
      <h3>Frontend — preferences</h3>
      <p class="hint">Gemmes lokalt i browser <code>localStorage</code>.</p>
      <div id="frontend-msg"></div>
      <form id="frontend-form">
        <div class="field">
          <label for="page_size">Default page size (browse view)</label>
          <input type="number" id="page_size" min="10" max="500" step="10" />
        </div>
        <div class="field">
          <label for="theme">Tema</label>
          <select id="theme">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit">Gem frontend settings</button>
        </div>
      </form>
    </div>
  `;

  if (!isTacacs) {
    const pwMsg = container.querySelector("#pw-msg");
    container.querySelector("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      pwMsg.innerHTML = "";
      const current = container.querySelector("#pw-current").value;
      const newPw = container.querySelector("#pw-new").value;
      const newPw2 = container.querySelector("#pw-new2").value;
      if (newPw !== newPw2) {
        pwMsg.innerHTML = `<div class="alert error">De to nye passwords matcher ikke.</div>`;
        return;
      }
      try {
        await api.changePassword(current, newPw);
        container.querySelector("#pw-form").reset();
        pwMsg.innerHTML = `<div class="alert success">Password skiftet.</div>`;
      } catch (err) {
        pwMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    });
  }

  const prefs = loadFrontendPrefs();
  container.querySelector("#page_size").value = prefs.pageSize || 100;
  container.querySelector("#theme").value = prefs.theme || "light";
  const frontendMsg = container.querySelector("#frontend-msg");
  container.querySelector("#frontend-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const newPrefs = {
      pageSize: parseInt(container.querySelector("#page_size").value, 10),
      theme: container.querySelector("#theme").value,
    };
    saveFrontendPrefs(newPrefs);
    applyTheme(newPrefs.theme);
    frontendMsg.innerHTML = `<div class="alert success">Frontend preferences gemt.</div>`;
  });
}
