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
        <div class="field">
          <label for="coa_disconnect_type">CoA disconnect type</label>
          <select id="coa_disconnect_type">
            <option value="0">0 — DEFAULT (deauth — wireless/WLC)</option>
            <option value="1">1 — PORT BOUNCE (kun wired)</option>
            <option value="2">2 — PORT SHUTDOWN (kun wired)</option>
          </select>
          <div class="hint">Bruges når klienten skal deautentificeres (tvinger ny DHCP). <strong>0</strong> er rigtig for trådløse klienter.</div>
        </div>
        <div class="hint" style="border-left:3px solid #e6a23c;padding:8px 12px;background:rgba(230,162,60,0.08);margin:8px 0;">
          <strong>Vigtigt:</strong> MnT CoA kræver at ISE-brugeren har rollen
          <code>MnT Admin</code> eller <code>Super Admin</code>. <code>ERS Admin</code>
          alene giver <strong>401 Unauthorized</strong>. Tildel rollen i ISE under
          <em>Administration → System → Admin Access → Administrators → Admin Users</em>.
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
      <h3>Endpoint-cache</h3>
      <p class="hint">
        In-memory cache for endpoint- og gruppe-opslag. Reducerer ISE-kald ved filter-skift og refresh i Browse.
        Cachen invalideres automatisk når du gemmer/sletter et endpoint.
      </p>
      <div id="cache-msg"></div>
      <form id="cache-form">
        <div class="field">
          <label>
            <input type="checkbox" id="cache_enabled" />
            Cache aktiveret
          </label>
          <div class="hint">Slå fra for at debugge — alle reads rammer så ISE direkte.</div>
        </div>
        <div class="field">
          <label for="cache_ttl_seconds">TTL (sekunder)</label>
          <input type="number" id="cache_ttl_seconds" min="5" max="3600" step="5" />
          <div class="hint">Hvor længe en entry regnes som fresh før den skal revalideres.</div>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="cache_stale_while_revalidate" />
            Stale-while-revalidate
          </label>
          <div class="hint">Server stale entries op til 10× TTL og hent ny data i baggrunden.</div>
        </div>
        <div class="field">
          <label for="cache_sync_interval_seconds">Baggrund-sync interval (sekunder)</label>
          <input type="number" id="cache_sync_interval_seconds" min="0" max="3600" step="30" />
          <div class="hint">0 = slå baggrund-sync fra. Workeren refresh'er cachede entries der er ældre end halv TTL.</div>
        </div>
        <div class="actions">
          <button type="submit">Gem cache-indstillinger</button>
        </div>
      </form>

      <h4 style="margin-top:1.5rem;margin-bottom:0.5rem;">Live status</h4>
      <div id="cache-stats" class="cache-stats">
        <div class="hint">Henter…</div>
      </div>
      <div class="actions">
        <button type="button" id="cache-refresh-btn" class="secondary">Opdatér stats</button>
        <button type="button" id="cache-invalidate-btn" class="danger">Ryd cache</button>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card">
      <h3>PxGrid 2.0 (real-time session push)</h3>
      <p class="hint">
        Erstatter MnT-poll med ægte server-push fra ISE pxGrid (port 8910).
        Phase 1 sætter REST control plane + cert op. Når <strong>ENABLED</strong>
        og en <em>Test forbindelse</em> er grøn, kan Phase 2 (STOMP-subscription
        til <code>com.cisco.ise.session</code>) aktiveres. Kræver mTLS — vælg
        cert-mode nedenfor.
      </p>
      <div id="pxgrid-msg"></div>
      <form id="pxgrid-form">
        <div class="field">
          <label>
            <input type="checkbox" id="pxgrid_enabled" />
            PxGrid aktiveret
          </label>
          <div class="hint">Off = portalen falder tilbage til MnT-poll (nuværende adfærd).</div>
        </div>
        <div class="field">
          <label for="pxgrid_node_name">Node-navn (vises i ISE pxGrid Services → Clients)</label>
          <input type="text" id="pxgrid_node_name" placeholder="hypervision-portal" autocomplete="off" />
          <div class="hint">CSR-mode bruger dette som CN i certifikatet.</div>
        </div>
        <div class="field">
          <label for="pxgrid_psn_fqdn">PSN FQDN (port 8910)</label>
          <input type="text" id="pxgrid_psn_fqdn" placeholder="(tomt = host fra Base URL)" autocomplete="off" />
          <div class="hint">FQDN på en ISE PSN-node der har pxGrid-personaen aktiveret.</div>
        </div>
        <div class="field">
          <label for="pxgrid_cert_mode">Cert-mode</label>
          <select id="pxgrid_cert_mode">
            <option value="upload">Upload — admin uploader færdige PEM-filer</option>
            <option value="csr">CSR — portalen genererer keypair + CSR der signeres af ISE internal CA</option>
          </select>
        </div>
        <div id="pxgrid-cert-status" class="hint" style="margin:6px 0;">Cert-status: —</div>

        <div id="pxgrid-upload-block">
          <p class="hint">
            <strong>Upload-mode:</strong> upload tre PEM-filer (klient-cert, privat-key, CA-bundle der har signeret ISE pxGrid server-cert).
            Filer gemmes i <code>backend/pxgrid/</code> med automatisk path-update.
          </p>
          <div class="field">
            <label for="pxgrid-upload-cert">Klient-certifikat (PEM)</label>
            <input type="file" id="pxgrid-upload-cert" accept=".pem,.crt,.cer" />
          </div>
          <div class="field">
            <label for="pxgrid-upload-key">Privat key (PEM)</label>
            <input type="file" id="pxgrid-upload-key" accept=".pem,.key" />
          </div>
          <div class="field">
            <label for="pxgrid-upload-ca">CA-bundle (PEM)</label>
            <input type="file" id="pxgrid-upload-ca" accept=".pem,.crt,.cer" />
          </div>
        </div>

        <div id="pxgrid-csr-block" hidden>
          <p class="hint">
            <strong>CSR-mode:</strong> klik <em>Generér CSR</em> → portalen laver keypair + CSR i <code>backend/pxgrid/</code>.
            Indsend CSR-filen til ISE internal CA, download det signerede cert, og upload det som <em>Klient-certifikat</em> herover.
            Klik derefter <em>Opret pxGrid-konto</em> for at registrere klienten — derefter skal en ISE-admin approve i <em>Administration → pxGrid Services → Clients</em>.
          </p>
          <div class="actions">
            <button type="button" id="pxgrid-csr-btn" class="secondary">Generér CSR + keypair</button>
            <button type="button" id="pxgrid-account-btn" class="secondary">Opret pxGrid-konto (efter cert er uploadet)</button>
          </div>
        </div>

        <div class="field">
          <label for="pxgrid_cert_path">Klient-cert sti (læses fra filsystem)</label>
          <input type="text" id="pxgrid_cert_path" placeholder="pxgrid/client.cert.pem" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pxgrid_key_path">Privat key sti</label>
          <input type="text" id="pxgrid_key_path" placeholder="pxgrid/client.key.pem" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pxgrid_ca_bundle_path">CA-bundle sti (valgfri — tom = system CA store)</label>
          <input type="text" id="pxgrid_ca_bundle_path" placeholder="pxgrid/ca-bundle.pem" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pxgrid_password">Account secret (write-only)</label>
          <input type="password" id="pxgrid_password" placeholder="(lad tom for at beholde)" autocomplete="off" />
          <div class="hint" id="pxgrid-pw-hint">CSR-mode: udfyldes automatisk efter <em>Opret pxGrid-konto</em>. Upload-mode: kun nødvendig hvis ISE-admin har sat shared secret.</div>
        </div>
        <div class="actions">
          <button type="submit">Gem PxGrid settings</button>
          <button type="button" id="pxgrid-test-btn" class="secondary">Test forbindelse</button>
        </div>
      </form>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card">
      <h3>Endpoint-roller</h3>
      <p class="hint">
        Roller der kan tagges på endpoints (CA <code>HypervisionRoles</code>) og tildeles
        brugere. Non-admin ser kun endpoints tagget med en af deres effektive roller
        (tildelte + deres eget username, der altid er en implicit rolle). Admin ser alt.
        Rolle-navne må kun indeholde <code>A-Z a-z 0-9 _ -</code> (max 64 tegn).
      </p>
      <div id="roles-msg"></div>
      <table class="users-table">
        <thead>
          <tr>
            <th>Navn</th>
            <th>Beskrivelse</th>
            <th style="width:9rem;">Oprettet af</th>
            <th style="width:9rem;">Oprettet</th>
            <th style="width:6rem;">Handling</th>
          </tr>
        </thead>
        <tbody id="roles-tbody"></tbody>
      </table>
      <form id="role-create-form" class="user-create-row">
        <input type="text" id="new-role-name" placeholder="rolle-navn (fx alle-Printer)"
               pattern="[A-Za-z0-9_\\-]{1,64}" maxlength="64" required />
        <input type="text" id="new-role-desc" placeholder="beskrivelse (valgfri)" maxlength="256" />
        <button type="submit">Opret rolle</button>
      </form>
    </div>

    <div class="card">
      <h3>Brugere &amp; roller</h3>
      <p class="hint">
        Administrer lokale brugerkonti, system-roller og endpoint-rolle-tildelinger.
        <b>admin</b> har fuld adgang. <b>editor</b> kan oprette/redigere endpoints. <b>viewer</b> kan kun læse.
        <b>registrar</b> kan kun registrere nye endpoints. Endpoint-roller bestemmer hvilke endpoints
        ikke-admin-brugere kan se (deres username er altid implicit tildelt).
      </p>
      <div id="users-msg"></div>
      <table class="users-table">
        <thead>
          <tr>
            <th>Brugernavn</th>
            <th style="width:9rem;">Rolle</th>
            <th>Endpoint-roller</th>
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
          <option value="registrar">registrar (kun opret)</option>
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
    await initCacheSection(container);
    await initPxGridSection(container);
    const rolesState = await initRolesSection(container);
    await initUsersSection(container, currentUser, rolesState);
  }
  initPasswordSection(container);
  initCsvAndPrefsSections(container);
}

async function initPxGridSection(container) {
  const msg = container.querySelector("#pxgrid-msg");
  const certStatus = container.querySelector("#pxgrid-cert-status");
  const uploadBlock = container.querySelector("#pxgrid-upload-block");
  const csrBlock = container.querySelector("#pxgrid-csr-block");
  const modeSel = container.querySelector("#pxgrid_cert_mode");
  const pwHint = container.querySelector("#pxgrid-pw-hint");

  function applyMode(mode) {
    if (mode === "csr") {
      uploadBlock.querySelectorAll("input[type=file]").forEach((el) => {
        // CSR mode still allows uploading the *signed cert* back, so keep
        // upload block visible — admin will use it for the cert file
        // returned by the ISE CA.
      });
      csrBlock.hidden = false;
    } else {
      csrBlock.hidden = true;
    }
  }

  async function loadSettings() {
    try {
      const s = await api.getPxGridSettings();
      container.querySelector("#pxgrid_enabled").checked = !!s.pxgrid_enabled;
      container.querySelector("#pxgrid_node_name").value = s.pxgrid_node_name || "";
      container.querySelector("#pxgrid_psn_fqdn").value = s.pxgrid_psn_fqdn || "";
      modeSel.value = s.pxgrid_cert_mode || "upload";
      container.querySelector("#pxgrid_cert_path").value = s.pxgrid_cert_path || "";
      container.querySelector("#pxgrid_key_path").value = s.pxgrid_key_path || "";
      container.querySelector("#pxgrid_ca_bundle_path").value = s.pxgrid_ca_bundle_path || "";
      const cls = s.cert_status === "ok" ? "success"
                : s.cert_status === "missing" ? "warning" : "error";
      certStatus.innerHTML = `Cert-status: <span class="alert ${cls}" style="display:inline;padding:2px 8px;">${esc(s.cert_status)}</span>`;
      pwHint.textContent = s.pxgrid_password_set
        ? "Account secret er sat. Lad tomt for at beholde."
        : "Intet secret sat. CSR-mode udfylder dette automatisk efter approval; upload-mode kan lades tom hvis ISE ikke kræver det.";
      applyMode(s.pxgrid_cert_mode || "upload");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke hente PxGrid settings: ${esc(err.message)}</div>`;
    }
  }

  modeSel.addEventListener("change", () => applyMode(modeSel.value));

  function buildPayload() {
    return {
      pxgrid_enabled: container.querySelector("#pxgrid_enabled").checked,
      pxgrid_node_name: container.querySelector("#pxgrid_node_name").value.trim(),
      pxgrid_psn_fqdn: container.querySelector("#pxgrid_psn_fqdn").value.trim(),
      pxgrid_cert_mode: modeSel.value,
      pxgrid_cert_path: container.querySelector("#pxgrid_cert_path").value.trim(),
      pxgrid_key_path: container.querySelector("#pxgrid_key_path").value.trim(),
      pxgrid_ca_bundle_path: container.querySelector("#pxgrid_ca_bundle_path").value.trim(),
      pxgrid_password: container.querySelector("#pxgrid_password").value,
    };
  }

  container.querySelector("#pxgrid-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    try {
      await api.updatePxGridSettings(buildPayload());
      msg.innerHTML = `<div class="alert success">PxGrid settings gemt.</div>`;
      container.querySelector("#pxgrid_password").value = "";
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-test-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">Tester PxGrid-forbindelse...</div>`;
    try {
      const r = await api.testPxGridConnection();
      const cls = r.ok ? "success" : "error";
      const services = r.services_found?.length
        ? `<br><small>Services: ${r.services_found.map(esc).join(", ")}</small>`
        : "";
      msg.innerHTML = `<div class="alert ${cls}">[${esc(r.step)}] ${esc(r.message)}${r.latency_ms ? ` (${r.latency_ms}ms)` : ""}${services}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Test fejlede: ${esc(err.message)}</div>`;
    }
  });

  // CSR + account-create kalder backend-endpoints der gatekeeper på persisted
  // settings (node_name, cert_mode). Bruger kan have ændret formularen uden at
  // klikke Gem først — auto-save dropdown/node-navn så backend ser samme state
  // som UI'et. Password-feltet ekskluderes (tomt = bevar) for ikke at wipe en
  // eksisterende secret hvis brugeren ikke har skrevet noget.
  async function autoSaveBeforeAction() {
    const payload = buildPayload();
    payload.pxgrid_password = "";
    await api.updatePxGridSettings(payload);
  }

  container.querySelector("#pxgrid-csr-btn").addEventListener("click", async () => {
    if (!confirm("Generér nyt RSA-2048 keypair + CSR? Eksisterende key for samme node-navn overskrives.")) return;
    msg.innerHTML = `<div class="alert info">Genererer CSR...</div>`;
    try {
      await autoSaveBeforeAction();
      const s = await api.generatePxGridCsr();
      msg.innerHTML = `<div class="alert success">CSR genereret. Key gemt på <code>${esc(s.pxgrid_key_path)}</code>. CSR-fil ligger ved siden af — indsend den til ISE internal CA og upload det signerede cert som "Klient-certifikat" herover.</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-account-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">Opretter pxGrid-konto i ISE...</div>`;
    try {
      await autoSaveBeforeAction();
      const r = await api.createPxGridAccount();
      const cls = r.ok ? "success" : "error";
      msg.innerHTML = `<div class="alert ${cls}">[${esc(r.account_state)}] ${esc(r.message)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  for (const [kind, id] of [["cert", "pxgrid-upload-cert"], ["key", "pxgrid-upload-key"], ["ca", "pxgrid-upload-ca"]]) {
    container.querySelector(`#${id}`).addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      msg.innerHTML = `<div class="alert info">Uploader ${esc(kind)}...</div>`;
      try {
        await api.uploadPxGridCert(kind, file);
        msg.innerHTML = `<div class="alert success">${esc(kind)} uploadet og sti opdateret.</div>`;
        await loadSettings();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">Upload af ${esc(kind)} fejlede: ${esc(err.message)}</div>`;
      } finally {
        e.target.value = "";
      }
    });
  }

  await loadSettings();
}

function fmtAge(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function fmtTimestamp(unixSeconds) {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  const age = (Date.now() / 1000) - unixSeconds;
  return `${d.toLocaleTimeString()} (${fmtAge(age)} siden)`;
}

function renderCacheStats(container, stats) {
  const hits = stats.hits || 0;
  const misses = stats.misses || 0;
  const staleServes = stats.stale_serves || 0;
  const total = hits + misses + staleServes;
  const hitRate = total > 0 ? ((hits + staleServes) / total * 100).toFixed(1) : "—";
  container.innerHTML = `
    <table class="cache-stats-table">
      <tbody>
        <tr><td>Status</td><td>${stats.enabled ? "Aktiveret" : "Deaktiveret"}</td></tr>
        <tr><td>TTL</td><td>${stats.ttl_seconds}s</td></tr>
        <tr><td>Stale-while-revalidate</td><td>${stats.stale_while_revalidate ? "TIL" : "FRA"}</td></tr>
        <tr><td>Detail-entries</td><td>${stats.detail_entries}</td></tr>
        <tr><td>Groups cached</td><td>${stats.groups_cached ? "Ja" : "Nej"}</td></tr>
        <tr><td>Hit-rate</td><td>${hitRate === "—" ? "—" : hitRate + "%"} (hits: ${hits}, stale: ${staleServes}, misses: ${misses})</td></tr>
        <tr><td>Baggrund-refreshes</td><td>${stats.bg_refreshes || 0} (${stats.inflight_detail_refreshes || 0} inflight)</td></tr>
        <tr><td>Invalideringer</td><td>${stats.invalidations || 0}</td></tr>
        <tr><td>Seneste sync</td><td>${fmtTimestamp(stats.last_sync_at)}</td></tr>
        <tr><td>Sync-fejl</td><td>${stats.last_sync_error ? `<span style="color:#c0392b;">${esc(stats.last_sync_error)}</span>` : "(ingen)"}</td></tr>
      </tbody>
    </table>
  `;
}

async function initCacheSection(container) {
  const msg = container.querySelector("#cache-msg");
  const statsBox = container.querySelector("#cache-stats");
  const refreshBtn = container.querySelector("#cache-refresh-btn");
  const invalidateBtn = container.querySelector("#cache-invalidate-btn");

  async function loadSettings() {
    try {
      const s = await api.getBackendSettings();
      container.querySelector("#cache_enabled").checked = !!s.cache_enabled;
      container.querySelector("#cache_ttl_seconds").value = s.cache_ttl_seconds ?? 60;
      container.querySelector("#cache_stale_while_revalidate").checked = !!s.cache_stale_while_revalidate;
      container.querySelector("#cache_sync_interval_seconds").value = s.cache_sync_interval_seconds ?? 300;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke hente cache-indstillinger: ${esc(err.message)}</div>`;
    }
  }

  async function loadStats() {
    try {
      const stats = await api.getCacheStats();
      renderCacheStats(statsBox, stats);
    } catch (err) {
      statsBox.innerHTML = `<div class="alert error">Kunne ikke hente stats: ${esc(err.message)}</div>`;
    }
  }

  await loadSettings();
  await loadStats();

  container.querySelector("#cache-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    // Preserve all other backend settings — cache updates go through the same endpoint.
    let current;
    try {
      current = await api.getBackendSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke læse aktuelle settings: ${esc(err.message)}</div>`;
      return;
    }
    const payload = {
      ise_base_url: current.ise_base_url,
      ise_username: current.ise_username,
      ise_password: "",  // keep existing
      ise_verify_tls: current.ise_verify_tls,
      ise_timeout: current.ise_timeout,
      ise_api_type: current.ise_api_type,
      coa_psn_name: current.coa_psn_name,
      coa_reauth_type: current.coa_reauth_type,
      coa_disconnect_type: current.coa_disconnect_type,
      cache_enabled: container.querySelector("#cache_enabled").checked,
      cache_ttl_seconds: parseFloat(container.querySelector("#cache_ttl_seconds").value),
      cache_stale_while_revalidate: container.querySelector("#cache_stale_while_revalidate").checked,
      cache_sync_interval_seconds: parseFloat(container.querySelector("#cache_sync_interval_seconds").value),
    };
    try {
      await api.updateBackendSettings(payload);
      msg.innerHTML = `<div class="alert success">Cache-indstillinger gemt. Ændringer træder i kraft straks.</div>`;
      await loadStats();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  refreshBtn.addEventListener("click", loadStats);

  invalidateBtn.addEventListener("click", async () => {
    if (!confirm("Ryd hele cachen? Næste opslag vil ramme ISE.")) return;
    try {
      await api.invalidateCache();
      msg.innerHTML = `<div class="alert success">Cache ryddet.</div>`;
      await loadStats();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
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
    container.querySelector("#coa_disconnect_type").value = String(s.coa_disconnect_type ?? 0);
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
      coa_disconnect_type: parseInt(container.querySelector("#coa_disconnect_type").value, 10),
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
      coa_disconnect_type: parseInt(container.querySelector("#coa_disconnect_type").value, 10),
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

async function initRolesSection(container) {
  const tbody = container.querySelector("#roles-tbody");
  const msg = container.querySelector("#roles-msg");
  const form = container.querySelector("#role-create-form");
  const state = { roles: [], onChange: null };

  async function reload() {
    msg.innerHTML = "";
    try {
      const data = await api.listEndpointRoles();
      state.roles = data.roles || [];
      if (state.roles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="hint" style="text-align:center;padding:1rem;">Ingen roller endnu — opret den første nedenfor.</td></tr>`;
      } else {
        tbody.innerHTML = state.roles
          .map(
            (r) => `
              <tr data-role-name="${esc(r.name)}">
                <td><b>${esc(r.name)}</b></td>
                <td>${esc(r.description || "")}</td>
                <td class="mono" style="font-size:0.78rem;">${esc(r.created_by || "")}</td>
                <td class="mono" style="font-size:0.78rem;">${esc((r.created_at || "").slice(0, 10))}</td>
                <td><button class="small danger role-del">Slet</button></td>
              </tr>`,
          )
          .join("");
      }
      if (state.onChange) await state.onChange();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Kunne ikke hente roller: ${esc(err.message)}</div>`;
    }
  }

  tbody.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("role-del")) return;
    const row = e.target.closest("tr");
    const name = row.dataset.roleName;
    if (!confirm(`Slet rollen "${name}"? Brugere mister tildelingen, men endpoint-tags ændres ikke.`)) return;
    try {
      await api.deleteEndpointRole(name);
      msg.innerHTML = `<div class="alert success">Rolle "${esc(name)}" slettet.</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = container.querySelector("#new-role-name");
    const descInput = container.querySelector("#new-role-desc");
    const payload = {
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
    };
    try {
      await api.createEndpointRole(payload);
      nameInput.value = "";
      descInput.value = "";
      msg.innerHTML = `<div class="alert success">Rolle oprettet.</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  await reload();
  return state;
}

async function initUsersSection(container, currentUser, rolesState) {
  const tbody = container.querySelector("#users-tbody");
  const msg = container.querySelector("#users-msg");

  function renderEndpointRoleCell(user) {
    const catalog = rolesState ? rolesState.roles : [];
    const assigned = new Set(user.assigned_endpoint_roles || []);
    if (catalog.length === 0) {
      return `<span class="hint">Ingen roller i kataloget endnu</span>`;
    }
    const checks = catalog
      .map((r) => {
        const checked = assigned.has(r.name) ? " checked" : "";
        return `<label class="role-chip"><input type="checkbox" class="user-role-chip" value="${esc(r.name)}"${checked}/> ${esc(r.name)}</label>`;
      })
      .join("");
    return `<div class="role-chips">${checks}</div>`;
  }

  async function reload() {
    msg.innerHTML = "";
    try {
      const users = await api.listUsers();
      tbody.innerHTML = users
        .map((u) => {
          const isSelf = u.id === currentUser.id;
          return `
            <tr data-user-id="${esc(u.id)}" data-username="${esc(u.username)}">
              <td>${esc(u.username)}</td>
              <td>
                <select class="user-role-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen rolle her'" : ""}>
                  ${["admin", "editor", "viewer", "registrar"]
                    .map((r) => `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`)
                    .join("")}
                </select>
              </td>
              <td>${renderEndpointRoleCell(u)}</td>
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

  // Sub som kan kaldes når rolle-kataloget ændrer sig så user-cellerne følger med.
  if (rolesState) rolesState.onChange = reload;

  tbody.addEventListener("change", async (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.userId;
    if (e.target.classList.contains("user-role-select")) {
      try {
        await api.updateUser(id, { role: e.target.value });
        msg.innerHTML = `<div class="alert success">Rolle opdateret.</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-role-chip")) {
      const checks = row.querySelectorAll(".user-role-chip");
      const selected = Array.from(checks)
        .filter((c) => c.checked)
        .map((c) => c.value);
      try {
        await api.setUserEndpointRoles(id, selected);
        msg.innerHTML = `<div class="alert success">Endpoint-roller opdateret for ${esc(row.dataset.username)}.</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
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

  const csvTplFile = container.querySelector("#csv-tpl-file");
  csvTplFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const columns = parseTemplateHeader(text);
      if (!columns.length) {
        csvTplMsg.innerHTML = `<div class="alert error">Ingen kolonner fundet i filen — kontrollér at første linje er en header-række.</div>`;
        return;
      }
      const extended = extendTemplateWithPortalColumns(columns);
      setCsvTemplate(extended);
      refreshTplPreview();
      const added = extended.length - columns.length;
      const addedNote = added ? ` (+${added} portal-kolonner tilføjet)` : "";
      csvTplMsg.innerHTML = `<div class="alert success">Template importeret — ${extended.length} kolonner${addedNote}. Fremtidige exports bruger denne template.</div>`;
    } catch (err) {
      csvTplMsg.innerHTML = `<div class="alert error">Kunne ikke læse filen: ${esc(err.message)}</div>`;
    } finally {
      // Nulstil input så samme fil kan vælges igen efter fejl/reset.
      e.target.value = "";
    }
  });

  container.querySelector("#csv-tpl-reset").addEventListener("click", () => {
    resetCsvTemplate();
    csvTplFile.value = "";
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
