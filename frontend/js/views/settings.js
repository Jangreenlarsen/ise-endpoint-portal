import { api } from "../api.js";
import { auth } from "../auth.js";
import { getCsvTemplate, setCsvTemplate, resetCsvTemplate, parseTemplateHeader, extendTemplateWithPortalColumns } from "../csv.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

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
  const isAdmin = auth.isAdmin();
  const currentUser = auth.getUser();

  container.innerHTML = `
    <h2>Settings</h2>

    ${isAdmin ? `
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
        <div class="field">
          <label for="coa_psn_name">CoA PSN-hostnavn (MnT)</label>
          <input type="text" id="coa_psn_name" placeholder="(tomt = brug host fra Base URL)" autocomplete="off" />
          <div class="hint">Hostnavn på den PSN der skal udstede CoA via <code>/admin/API/mnt/CoA/Reauth</code>. Tomt = afledes af Base URL.</div>
        </div>
        <div class="field">
          <label for="coa_reauth_type">CoA reauth type</label>
          <select id="coa_reauth_type">
            <option value="0">0 — DEFAULT</option>
            <option value="1">1 — RERUN (anbefalet ved attribut-ændringer)</option>
            <option value="2">2 — LAST</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit">Gem backend settings</button>
          <button type="button" id="test-conn-btn" class="secondary"
                  title="Test ISE-forbindelsen uden at gemme">Test forbindelse</button>
        </div>
      </form>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card">
      <h3>Brugere &amp; roller</h3>
      <p class="hint">
        Administrer lokale brugerkonti og deres roller.
        <b>admin</b> har fuld adgang. <b>editor</b> kan oprette/redigere endpoints. <b>viewer</b> kan kun læse.
      </p>
      <div id="users-msg"></div>
      <table class="users-table">
        <thead>
          <tr>
            <th>Brugernavn</th>
            <th style="width:9rem;">Rolle</th>
            <th style="width:11rem;">Sidst logget ind</th>
            <th style="width:9rem;">Oprettet</th>
            <th style="width:10rem;">Handlinger</th>
          </tr>
        </thead>
        <tbody id="users-tbody"></tbody>
      </table>
      <form id="user-create-form" class="user-create-row">
        <input type="text" id="new-username" placeholder="brugernavn" minlength="3" required />
        <input type="password" id="new-password" placeholder="password (min. 8 tegn)" minlength="8" required />
        <select id="new-role">
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Opret bruger</button>
      </form>
    </div>
    ` : ""}

    <div class="card">
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

  if (isAdmin) {
    await initBackendSection(container);
    await initUsersSection(container, currentUser);
  }
  initPasswordSection(container);
  initCsvAndPrefsSections(container);
}

async function initBackendSection(container) {
  const backendMsg = container.querySelector("#backend-msg");
  const passwordHint = container.querySelector("#password-hint");

  try {
    const s = await api.getBackendSettings();
    container.querySelector("#base_url").value = s.ise_base_url;
    container.querySelector("#username").value = s.ise_username;
    container.querySelector("#api_type").value = s.ise_api_type;
    container.querySelector("#verify_tls").checked = s.ise_verify_tls;
    container.querySelector("#timeout").value = s.ise_timeout;
    container.querySelector("#coa_psn_name").value = s.coa_psn_name || "";
    container.querySelector("#coa_reauth_type").value = String(s.coa_reauth_type ?? 1);
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
      coa_psn_name: container.querySelector("#coa_psn_name").value.trim(),
      coa_reauth_type: parseInt(container.querySelector("#coa_reauth_type").value, 10),
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
      coa_psn_name: container.querySelector("#coa_psn_name").value.trim(),
      coa_reauth_type: parseInt(container.querySelector("#coa_reauth_type").value, 10),
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
}

async function initUsersSection(container, currentUser) {
  const tbody = container.querySelector("#users-tbody");
  const msg = container.querySelector("#users-msg");

  async function reload() {
    msg.innerHTML = "";
    try {
      const users = await api.listUsers();
      tbody.innerHTML = users
        .map((u) => {
          const isSelf = u.id === currentUser.id;
          return `
            <tr data-user-id="${esc(u.id)}">
              <td>${esc(u.username)}</td>
              <td>
                <select class="user-role-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen rolle her'" : ""}>
                  ${["admin", "editor", "viewer"]
                    .map((r) => `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`)
                    .join("")}
                </select>
              </td>
              <td class="mono" style="font-size:0.78rem;">${esc(u.last_login || "—")}</td>
              <td class="mono" style="font-size:0.78rem;">${esc((u.created_at || "").slice(0, 10))}</td>
              <td>
                <button class="small user-reset-pw" ${isSelf ? "disabled" : ""}>Nyt password</button>
                <button class="small danger user-del" ${isSelf ? "disabled" : ""}>Slet</button>
              </td>
            </tr>`;
        })
        .join("");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke hente brugere: ${esc(err.message)}</div>`;
    }
  }

  tbody.addEventListener("change", async (e) => {
    if (!e.target.classList.contains("user-role-select")) return;
    const row = e.target.closest("tr");
    const id = row.dataset.userId;
    try {
      await api.updateUser(id, { role: e.target.value });
      msg.innerHTML = `<div class="alert success">Rolle opdateret.</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      await reload();
    }
  });

  tbody.addEventListener("click", async (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.userId;
    const username = row.querySelector("td").textContent;
    if (e.target.classList.contains("user-del")) {
      if (!confirm(`Slet brugeren "${username}"?`)) return;
      try {
        await api.deleteUser(id);
        msg.innerHTML = `<div class="alert success">Bruger slettet.</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    }
    if (e.target.classList.contains("user-reset-pw")) {
      const pw = prompt(`Nyt password for "${username}" (min. 8 tegn):`);
      if (!pw) return;
      if (pw.length < 8) {
        msg.innerHTML = `<div class="alert error">Password skal være mindst 8 tegn.</div>`;
        return;
      }
      try {
        await api.updateUser(id, { password: pw });
        msg.innerHTML = `<div class="alert success">Password opdateret for ${esc(username)}.</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    }
  });

  container.querySelector("#user-create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      username: container.querySelector("#new-username").value.trim(),
      password: container.querySelector("#new-password").value,
      role: container.querySelector("#new-role").value,
    };
    try {
      await api.createUser(payload);
      container.querySelector("#new-username").value = "";
      container.querySelector("#new-password").value = "";
      msg.innerHTML = `<div class="alert success">Bruger oprettet.</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  await reload();
}

function initPasswordSection(container) {
  const msg = container.querySelector("#pw-msg");
  container.querySelector("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const current = container.querySelector("#pw-current").value;
    const newPw = container.querySelector("#pw-new").value;
    const newPw2 = container.querySelector("#pw-new2").value;
    if (newPw !== newPw2) {
      msg.innerHTML = `<div class="alert error">De to nye passwords matcher ikke.</div>`;
      return;
    }
    try {
      await api.changePassword(current, newPw);
      container.querySelector("#pw-form").reset();
      msg.innerHTML = `<div class="alert success">Password skiftet.</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

function initCsvAndPrefsSections(container) {
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
