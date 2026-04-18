import { api } from "../api.js";
import { getCsvTemplate, setCsvTemplate, resetCsvTemplate, parseTemplateHeader, extendTemplateWithPortalColumns } from "../csv.js";

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

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "light");
}

export function initTheme() {
  const prefs = loadFrontendPrefs();
  applyTheme(prefs.theme);
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
          <button type="button" id="test-conn-btn" class="secondary"
                  title="Test ISE-forbindelsen uden at gemme">Test forbindelse</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>CSV Export Template</h3>
      <p class="hint">
        Definerer hvilke kolonner der inkluderes ved CSV-eksport fra Browse view.
        Importér en CSV-fil (kun header-rækken bruges) for at sætte en ny template.
      </p>
      <div id="csv-tpl-msg"></div>
      <div class="field">
        <label>Aktiv template (<span id="csv-tpl-count">0</span> kolonner)</label>
        <textarea id="csv-tpl-preview" rows="3" readonly
                  style="font-size:0.82rem;background:#f9fafb;"></textarea>
      </div>
      <div class="field">
        <label for="csv-tpl-file">Importér template fra CSV-fil</label>
        <input type="file" id="csv-tpl-file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="actions">
        <button type="button" id="csv-tpl-reset">Nulstil til standard</button>
      </div>
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
            <option value="dark">Dark</option>
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

  container.querySelector("#test-conn-btn").addEventListener("click", async () => {
    backendMsg.innerHTML = `<div class="alert info">Tester forbindelse til ISE...</div>`;
    const payload = {
      ise_base_url: container.querySelector("#base_url").value.trim(),
      ise_username: container.querySelector("#username").value.trim(),
      ise_password: container.querySelector("#password").value,
      ise_verify_tls: container.querySelector("#verify_tls").checked,
      ise_timeout: parseFloat(container.querySelector("#timeout").value),
      ise_api_type: container.querySelector("#api_type").value,
    };
    try {
      const res = await api.testBackendConnection(payload);
      const cls = res.ok ? "success" : "error";
      backendMsg.innerHTML = `<div class="alert ${cls}">${res.message}</div>`;
    } catch (err) {
      backendMsg.innerHTML = `<div class="alert error">Test fejlede: ${err.message}</div>`;
    }
  });

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

  // CSV template
  const csvTplMsg = container.querySelector("#csv-tpl-msg");
  const csvTplPreview = container.querySelector("#csv-tpl-preview");
  const csvTplCount = container.querySelector("#csv-tpl-count");

  function refreshTplPreview() {
    const tpl = getCsvTemplate();
    csvTplPreview.value = tpl.join(", ");
    csvTplCount.textContent = tpl.length;
  }
  refreshTplPreview();

  container.querySelector("#csv-tpl-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const columns = parseTemplateHeader(text);
    if (!columns.length) {
      csvTplMsg.innerHTML = `<div class="alert error">Ingen kolonner fundet i filen.</div>`;
      return;
    }
    const extended = extendTemplateWithPortalColumns(columns);
    setCsvTemplate(extended);
    refreshTplPreview();
    const added = extended.length - columns.length;
    const addedNote = added ? ` (+${added} portal-kolonner tilføjet)` : "";
    csvTplMsg.innerHTML = `<div class="alert success">Template importeret — ${extended.length} kolonner${addedNote}. Fremtidige exports bruger denne template.</div>`;
  });

  container.querySelector("#csv-tpl-reset").addEventListener("click", () => {
    resetCsvTemplate();
    refreshTplPreview();
    csvTplMsg.innerHTML = `<div class="alert success">Template nulstillet til standard (${getCsvTemplate().length} kolonner).</div>`;
  });

  // Frontend prefs
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
