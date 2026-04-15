import { api } from "../api.js";

const FRONTEND_PREFS_KEY = "ise_portal_prefs";

function loadFrontendPrefs() {
  try {
    return JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveFrontendPrefs(prefs) {
  localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(prefs));
}

export async function renderSettings(container) {
  container.innerHTML = `
    <h2>Settings</h2>

    <div class="card">
      <h3>Backend — Cisco ISE connection</h3>
      <p class="hint">
        Disse værdier persisteres i <code>backend/config.json</code> og overrider
        <code>.env</code>. Efter gem genskabes ISE-klienten automatisk.
      </p>
      <div id="backend-msg"></div>
      <form id="backend-form">
        <div class="field">
          <label for="base_url">ISE Base URL (protokol + host + evt. port)</label>
          <input type="url" id="base_url" placeholder="https://ise.example.local" required />
        </div>
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" required autocomplete="off" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" placeholder="(lad tom for at beholde)" autocomplete="off" />
          <div class="hint" id="password-hint"></div>
        </div>
        <div class="field">
          <label for="api_type">API type</label>
          <select id="api_type">
            <option value="ers">ERS — /ers/config/... (legacy, kræver ERS enabled + ERS Admin rolle)</option>
            <option value="openapi">Open API — /api/v1/... (ISE 3.1+, anbefalet)</option>
          </select>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="verify_tls" /> Verificer TLS certifikat
          </label>
          <div class="hint">Slå fra i lab. I produktion bør denne være slået til.</div>
        </div>
        <div class="field">
          <label for="timeout">Timeout (sekunder)</label>
          <input type="number" id="timeout" min="1" max="300" step="1" />
        </div>
        <div class="actions">
          <button type="submit">Gem backend settings</button>
        </div>
      </form>
    </div>

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
            <option value="dark">Dark (ikke implementeret endnu)</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit">Gem frontend settings</button>
        </div>
      </form>
    </div>
  `;

  const backendMsg = container.querySelector("#backend-msg");
  const passwordHint = container.querySelector("#password-hint");

  try {
    const s = await api.getBackendSettings();
    container.querySelector("#base_url").value = s.ise_base_url;
    container.querySelector("#username").value = s.ise_username;
    container.querySelector("#api_type").value = s.ise_api_type;
    container.querySelector("#verify_tls").checked = s.ise_verify_tls;
    container.querySelector("#timeout").value = s.ise_timeout;
    passwordHint.textContent = s.ise_password_set
      ? "Password er sat. Lad tomt for at beholde det, eller skriv nyt for at overskrive."
      : "Intet password sat endnu.";
  } catch (err) {
    backendMsg.innerHTML = `<div class="alert error">Kunne ikke hente backend settings: ${err.message}</div>`;
  }

  container.querySelector("#backend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    backendMsg.innerHTML = "";
    const payload = {
      ise_base_url: container.querySelector("#base_url").value.trim(),
      ise_username: container.querySelector("#username").value.trim(),
      ise_password: container.querySelector("#password").value,
      ise_verify_tls: container.querySelector("#verify_tls").checked,
      ise_timeout: parseFloat(container.querySelector("#timeout").value),
      ise_api_type: container.querySelector("#api_type").value,
    };
    try {
      const s = await api.updateBackendSettings(payload);
      backendMsg.innerHTML = `<div class="alert success">Backend settings gemt. Nye ISE-kald bruger nu de nye værdier.</div>`;
      container.querySelector("#password").value = "";
      passwordHint.textContent = s.ise_password_set
        ? "Password er sat. Lad tomt for at beholde det, eller skriv nyt for at overskrive."
        : "Intet password sat endnu.";
    } catch (err) {
      backendMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
    }
  });

  // Frontend prefs
  const prefs = loadFrontendPrefs();
  container.querySelector("#page_size").value = prefs.pageSize || 100;
  container.querySelector("#theme").value = prefs.theme || "light";
  const frontendMsg = container.querySelector("#frontend-msg");
  container.querySelector("#frontend-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveFrontendPrefs({
      pageSize: parseInt(container.querySelector("#page_size").value, 10),
      theme: container.querySelector("#theme").value,
    });
    frontendMsg.innerHTML = `<div class="alert success">Frontend preferences gemt.</div>`;
  });
}
