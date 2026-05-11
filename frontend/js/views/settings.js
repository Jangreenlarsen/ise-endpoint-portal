import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
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
  const isPskEditorUser = isAdmin || currentUser?.role === "editor-psk";

  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">${t("settings.title")}</h2>
    </div>
    <nav class="settings-tabs" id="settings-tabs">
      ${isAdmin ? `
      <button class="settings-tab" data-tab="ise-connection">${t("settings.tab_ise_connection")}</button>
      <button class="settings-tab" data-tab="portal-performance">${t("settings.tab_performance")}</button>
      <button class="settings-tab" data-tab="portal-bruger-config">${t("settings.tab_user_config")}</button>
      <button class="settings-tab" data-tab="portal-auth-config">${t("settings.tab_auth_config")}</button>
      ` : ""}
      ${isPskEditorUser ? `
      <button class="settings-tab" data-tab="portal-config">${t("settings.tab_portal_config")}</button>
      ` : ""}
    </nav>
    <div class="settings-panels" id="settings-panels">

    ${isAdmin ? `
    <nav class="settings-subtab-nav" data-for-tab="ise-connection">
      <button class="settings-subtab" data-subtab="ic-rest">REST API</button>
      <button class="settings-subtab" data-subtab="ic-pxgrid">PxGrid</button>
    </nav>
    <div class="card" data-tab="ise-connection" data-subtab="ic-rest">
      <h3>Backend — Cisco ISE connection</h3>
      <p class="hint" id="ic-hint-p"></p>
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
          <input type="password" id="password" id="ic-pw-input" autocomplete="off" />
          <div class="hint" id="password-hint"></div>
        </div>
        <div class="field">
          <label for="api_type">API type</label>
          <select id="api_type">
            <option value="ers" id="ic-api-ers-opt"></option>
            <option value="openapi" id="ic-api-openapi-opt"></option>
          </select>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="verify_tls" /> <span id="ic-verify-tls-lbl"></span>
          </label>
          <div class="hint" id="ic-verify-tls-hint"></div>
        </div>
        <div class="field">
          <label for="timeout" id="ic-timeout-lbl"></label>
          <input type="number" id="timeout" min="1" max="300" step="1" />
        </div>
        <div class="field">
          <label for="coa_psn_name" id="ic-coa-psn-lbl"></label>
          <input type="text" id="coa_psn_name" autocomplete="off" />
          <div class="hint">Hostnavn på den PSN der skal udstede CoA via <code>/admin/API/mnt/CoA/Reauth</code>. Tomt = afledes af Base URL.</div>
        </div>
        <div class="field">
          <label for="coa_reauth_type">CoA reauth type</label>
          <select id="coa_reauth_type">
            <option value="0">0 — DEFAULT</option>
            <option value="1" id="ic-coa-reauth-1-opt"></option>
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
          <div class="hint" id="ic-coa-dc-hint"></div>
        </div>
        <div class="hint" style="border-left:3px solid #e6a23c;padding:8px 12px;background:rgba(230,162,60,0.08);margin:8px 0;">
          <strong>Vigtigt:</strong> MnT CoA kræver at ISE-brugeren har rollen
          <code>MnT Admin</code> eller <code>Super Admin</code>. <code>ERS Admin</code>
          alene giver <strong>401 Unauthorized</strong>. Tildel rollen i ISE under
          <em>Administration → System → Admin Access → Administrators → Admin Users</em>.
        </div>
        <div class="actions">
          <button type="submit" id="ic-btn-save"></button>
          <button type="button" id="test-conn-btn" class="secondary"></button>
        </div>
      </form>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-performance">
      <h3 id="cache-card-h3"></h3>
      <p class="hint">
        Intelligent to-lags cache: en <strong>pre-warm worker</strong> scanner alle ISE-endpoints i baggrunden og
        gemmer dem på disk, så portalen viser data med det samme ved genstart (markeret med ⏱ hvis data er ældre end TTL).
        Redigering af et endpoint prioriterer det i hot-queue, så du altid ser friske data i edit-dialogen.
        Cachen invalideres automatisk når du gemmer/sletter et endpoint.
      </p>
      <div id="cache-msg"></div>
      <form id="cache-form">
        <div class="field">
          <label>
            <input type="checkbox" id="cache_enabled" />
            <span id="cache-enabled-lbl"></span>
          </label>
          <div class="hint" id="cache-enabled-hint"></div>
        </div>
        <div class="field">
          <label for="cache_ttl_seconds" id="cache-ttl-lbl"></label>
          <input type="number" id="cache_ttl_seconds" min="5" max="3600" step="5" />
          <div class="hint">Hvor længe en detail-entry regnes som fresh. Pre-warm workeren erstatter løbende stale entries.</div>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="cache_stale_while_revalidate" />
            <span id="cache-stale-wr-lbl"></span>
          </label>
          <div class="hint">Server stale entries straks og hent ny data i baggrunden — undgår ventetid i Browse.</div>
        </div>
        <div class="field">
          <label for="cache_sync_interval_seconds" id="cache-sync-interval-lbl"></label>
          <input type="number" id="cache_sync_interval_seconds" min="0" max="3600" step="30" />
          <div class="hint">0 = deaktiveret. Supplerer pre-warm: refresh'er entries der er ældre end halv TTL ud over den planlagte scanning.</div>
        </div>

        <h4 style="margin-top:1.2rem;margin-bottom:0.6rem;" id="cache-prewarm-h4"></h4>
        <div class="field">
          <label for="cache_prewarm_interval_s" id="cache-scan-interval-lbl"></label>
          <input type="number" id="cache_prewarm_interval_s" min="60" max="86400" step="60" />
          <div class="hint">Hvor ofte workeren scanner <em>alle</em> ISE-endpoints (default: 1800 = 30 min).</div>
        </div>
        <div class="field">
          <label for="cache_prewarm_concurrency" id="cache-concurrency-lbl"></label>
          <input type="number" id="cache_prewarm_concurrency" min="1" max="10" step="1" />
          <div class="hint">Antal samtidige GET-kald mod ISE under scanning. ISE klarer max ~5 (default: 5).</div>
        </div>
        <div class="field">
          <label for="cache_disk_path" id="cache-disk-path-lbl"></label>
          <input type="text" id="cache_disk_path" style="font-family:monospace;width:100%;" />
          <div class="hint">Relativ til backend-mappen. Indeholdet genindlæses ved genstart og markeres med ⏱ i Browse.</div>
        </div>

        <div class="actions">
          <button type="submit" id="cache-btn-save"></button>
        </div>
      </form>

      <h4 style="margin-top:1.5rem;margin-bottom:0.5rem;" id="cache-live-status-h4"></h4>
      <div id="cache-stats" class="cache-stats">
        <div class="hint" id="cache-fetching-hint"></div>
      </div>
      <div class="actions">
        <button type="button" id="cache-refresh-btn" class="secondary"></button>
        <button type="button" id="cache-invalidate-btn" class="danger"></button>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="ise-connection" data-subtab="ic-pxgrid">
      <h3 id="pxgrid-card-h3"></h3>
      <p class="hint">
        Erstatter MnT-poll med ægte server-push fra ISE pxGrid (port 8910).
        Phase 1 sætter REST control plane + cert op. Når <strong>ENABLED</strong>
        og en <em>Test forbindelse</em> er grøn, kan Phase 2 (STOMP-subscription
        til <code>com.cisco.ise.session</code>) aktiveres. Kræver mTLS — vælg
        cert-mode nedenfor.
      </p>
      <form id="pxgrid-form">
        <div class="field">
          <label>
            <input type="checkbox" id="pxgrid_enabled" />
            <span id="pxgrid-enabled-lbl"></span>
          </label>
          <div class="hint" id="pxgrid-enabled-hint"></div>
        </div>
        <div class="field">
          <label for="pxgrid_node_name" id="pxgrid-node-name-lbl"></label>
          <input type="text" id="pxgrid_node_name" placeholder="hypervision-portal" autocomplete="off" />
          <div class="hint" id="pxgrid-node-hint"></div>
        </div>
        <div class="field">
          <label for="pxgrid_cert_extra_sans" id="pxgrid-extra-sans-lbl"></label>
          <input type="text" id="pxgrid_cert_extra_sans" placeholder="portal.ll.lan, hypervision-portal.ll.lan" autocomplete="off" />
          <div class="hint">
            Tilføjes som <code>SubjectAlternativeName:dNSName</code> i CSR'en udover node-navnet.
            <strong>Anbefalet:</strong> medtag portalens host-FQDN — pxGrid 2.0 / RFC 6125 best practice.
            Tom = kun node-navnet i SAN (minimum-kravet for ISE 3.4).
            <em>Påvirker kun nye CSR'er — eksisterende cert skal genskabes via Nulstil registrering → Trin 1.</em>
          </div>
        </div>
        <div class="field">
          <label for="pxgrid_psn_fqdn" id="pxgrid-psn-lbl"></label>
          <input type="text" id="pxgrid_psn_fqdn" placeholder="(tomt = host fra Base URL)" autocomplete="off" />
          <div class="hint" id="pxgrid-psn-hint"></div>
        </div>
        <div class="field">
          <label for="pxgrid_cert_mode" id="pxgrid-cert-mode-lbl"></label>
          <select id="pxgrid_cert_mode">
            <option value="upload" id="pxgrid-cert-upload-opt"></option>
            <option value="csr" id="pxgrid-cert-csr-opt"></option>
          </select>
        </div>
        <div id="pxgrid-cert-status" class="hint" style="margin:6px 0;">Cert-status: —</div>

        <div id="pxgrid-upload-block">
          <p class="hint">
            <strong>Upload-mode:</strong> upload tre PEM-filer (klient-cert, privat-key, CA-bundle der har signeret ISE pxGrid server-cert).
            Filer gemmes i <code>backend/pxgrid/</code> med automatisk path-update.
          </p>
          <div class="field">
            <label for="pxgrid-upload-cert" id="pxgrid-upload-cert-lbl"></label>
            <input type="file" id="pxgrid-upload-cert" accept=".pem,.crt,.cer" />
            <div class="upload-status hint" id="pxgrid-upload-cert-status"></div>
          </div>
          <div class="field">
            <label for="pxgrid-upload-key" id="pxgrid-upload-key-lbl"></label>
            <input type="file" id="pxgrid-upload-key" accept=".pem,.key" />
            <div class="upload-status hint" id="pxgrid-upload-key-status"></div>
          </div>
          <div class="field">
            <label for="pxgrid-upload-ca" id="pxgrid-upload-ca-lbl"></label>
            <input type="file" id="pxgrid-upload-ca" accept=".pem,.crt,.cer" />
            <div class="upload-status hint" id="pxgrid-upload-ca-status"></div>
          </div>

          <hr style="margin:1rem 0;border:0;border-top:1px solid #e5e7eb;" />
          <p class="hint">
            <strong>Eller importér PKCS#12 (.pfx/.p12)</strong> — typisk fra
            <em>MS certsrv → Install Certificate → Export</em> med
            "Yes, export the private key" + "Include all certificates in path".
            Portalen splitter bundlet i cert/key/CA og opdaterer alle tre stier
            i ét hug.
          </p>
          <div class="field">
            <label for="pxgrid-pfx-file" id="pxgrid-pfx-label-el"></label>
            <input type="file" id="pxgrid-pfx-file" accept=".pfx,.p12" />
          </div>
          <div class="field">
            <label for="pxgrid-pfx-pw" id="pxgrid-pfx-pw-lbl"></label>
            <input type="password" id="pxgrid-pfx-pw" autocomplete="off" />
          </div>
          <div class="actions">
            <button type="button" id="pxgrid-pfx-import-btn" class="secondary"></button>
          </div>
        </div>

        <div id="pxgrid-csr-block" hidden>
          <p class="hint">
            <strong>CSR-mode — 5 trin (gør i rækkefølge):</strong>
          </p>
          <div class="field">
            <label><strong id="pxgrid-csr-step1-lbl"></strong></label>
            <div class="hint" id="pxgrid-csr-step1-hint"></div>
            <div class="actions" style="margin-top:0.25rem;">
              <button type="button" id="pxgrid-csr-btn" class="secondary"></button>
              <button type="button" id="pxgrid-csr-dl-btn" class="secondary"></button>
            </div>
          </div>
          <div class="field">
            <label><strong id="pxgrid-csr-step2-lbl"></strong></label>
            <div class="hint">
              <strong>ISE Internal CA</strong>: Administration → pxGrid Services → Certificates → Generate Certificate → "I have a certificate signing request" → upload CSR → download signeret cert. CA-chain hentes fra Administration → System → Certificates → Certificate Authority Certificates.<br>
              <strong>MS certsrv</strong>: <code>https://&lt;ca&gt;/certsrv/</code> → advanced request → submit CSR (Base 64) → vælg template (typisk "pxGrid Client") → "Download certificate" (ikke chain). CA-bundle: forsiden → "Download a CA certificate chain" → konvertér p7b til PEM med <code>openssl pkcs7 -print_certs -in certnew.p7b -out ca.pem</code>.
            </div>
          </div>
          <div class="field">
            <label for="pxgrid-csr-signed-cert"><strong id="pxgrid-csr-step3-lbl"></strong></label>
            <input type="file" id="pxgrid-csr-signed-cert" accept=".pem,.crt,.cer" />
            <div class="upload-status hint" id="pxgrid-csr-signed-cert-status"></div>
            <div class="hint" id="pxgrid-csr-step3-hint"></div>
          </div>
          <div class="field">
            <label for="pxgrid-csr-ca-bundle"><strong id="pxgrid-csr-step4-lbl"></strong></label>
            <input type="file" id="pxgrid-csr-ca-bundle" accept=".pem,.crt,.cer" />
            <div class="upload-status hint" id="pxgrid-csr-ca-bundle-status"></div>
            <div class="hint" id="pxgrid-csr-step4-hint"></div>
          </div>
          <div class="field">
            <label><strong id="pxgrid-csr-step5-lbl"></strong></label>
            <div class="hint" id="pxgrid-csr-step5-hint"></div>
            <div class="actions" style="margin-top:0.25rem;">
              <button type="button" id="pxgrid-account-btn" class="secondary"></button>
            </div>
          </div>
        </div>

        <div class="field">
          <label for="pxgrid_cert_path" id="pxgrid-cert-path-lbl"></label>
          <input type="text" id="pxgrid_cert_path" placeholder="pxgrid/client.cert.pem" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pxgrid_key_path" id="pxgrid-key-path-lbl"></label>
          <input type="text" id="pxgrid_key_path" placeholder="pxgrid/client.key.pem" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pxgrid_ca_bundle_path" id="pxgrid-ca-path-lbl"></label>
          <input type="text" id="pxgrid_ca_bundle_path" placeholder="pxgrid/ca-bundle.pem" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pxgrid_password">Account secret (write-only)</label>
          <input type="password" id="pxgrid_password" placeholder="(lad tom for at beholde)" autocomplete="off" />
          <div class="hint" id="pxgrid-pw-hint">CSR-mode: udfyldes automatisk efter <em>Opret pxGrid-konto</em>. Upload-mode: kun nødvendig hvis ISE-admin har sat shared secret.</div>
        </div>
        <fieldset style="margin-top:0.8rem; padding:0.6rem 0.8rem; border:1px solid var(--border, #ccc); border-radius:6px;">
          <legend style="padding:0 0.4rem; font-weight:600;" id="pxgrid-phase2b-lbl"></legend>
          <div class="field">
            <label>
              <input type="checkbox" id="pxgrid_worker_enabled" />
              <span id="pxgrid-worker-lbl"></span>
            </label>
            <div class="hint" id="pxgrid-worker-hint"></div>
          </div>
          <div class="field">
            <label for="pxgrid_session_topic" id="pxgrid-session-topic-lbl"></label>
            <input type="text" id="pxgrid_session_topic" placeholder="/topic/com.cisco.ise.session" autocomplete="off" />
            <div class="hint">Default <code>/topic/com.cisco.ise.session</code>. RADIUS session-events (STARTED/AUTHENTICATED/DISCONNECTED).</div>
          </div>
          <div class="field">
            <label>
              <input type="checkbox" id="pxgrid_endpoint_topic_enabled" />
              <span id="pxgrid-ep-topic-lbl"></span>
            </label>
            <div class="hint">Når ON: ISE-admin's endpoint create/update/delete-events invaliderer 2.8.0-cachen og pushes til Browse, så rækken reloader automatisk uden refresh. Off = kun session-topic.</div>
          </div>
          <div class="field">
            <label for="pxgrid_endpoint_service" id="pxgrid-ep-service-lbl"></label>
            <input type="text" id="pxgrid_endpoint_service" placeholder="com.cisco.ise.endpoint" autocomplete="off" />
            <div class="hint">
              ISE pxGrid-service der ServiceLookup'es for at finde den kanoniske endpoint-topic.
              Hvis events udebliver, prøv: <code>com.cisco.ise.config.profiler</code> eller
              <code>com.cisco.ise.endpoint.asset</code>. Worker-status feltet viser hvilken topic der faktisk blev fundet.
            </div>
          </div>
          <div class="field">
            <label for="pxgrid_endpoint_topic" id="pxgrid-ep-topic-fallback-lbl"></label>
            <input type="text" id="pxgrid_endpoint_topic" placeholder="/topic/com.cisco.ise.endpoint" autocomplete="off" />
            <div class="hint">Bruges kun hvis ServiceLookup på service-navnet ikke returnerer en eksplicit topic.</div>
          </div>
          <div class="field">
            <label for="pxgrid_stomp_heartbeat_ms" id="pxgrid-heartbeat-lbl"></label>
            <input type="number" id="pxgrid_stomp_heartbeat_ms" min="0" step="1000" placeholder="30000" />
            <div class="hint">Annonceres som <code>0,N</code> i CONNECT. Tab af heartbeat trigger reconnect efter 2× interval. 0 = ingen heartbeat.</div>
          </div>
          <div class="field" style="display:flex; gap:0.6rem;">
            <div style="flex:1;">
              <label for="pxgrid_stomp_reconnect_min_s" id="pxgrid-reconnect-min-lbl"></label>
              <input type="number" id="pxgrid_stomp_reconnect_min_s" min="0.5" step="0.5" placeholder="1" />
            </div>
            <div style="flex:1;">
              <label for="pxgrid_stomp_reconnect_max_s" id="pxgrid-reconnect-max-lbl"></label>
              <input type="number" id="pxgrid_stomp_reconnect_max_s" min="1" step="1" placeholder="300" />
            </div>
          </div>
          <div class="hint">Eksponentiel backoff: starter ved <em>min</em>, fordobles efter hver fejlet reconnect, capper ved <em>max</em>. 1 → 300s er en god balance.</div>
          <div class="field">
            <label for="pxgrid_session_cache_max_age_s" id="pxgrid-session-age-lbl"></label>
            <input type="number" id="pxgrid_session_cache_max_age_s" min="0" step="60" placeholder="0" />
            <div class="hint">0 = ingen automatisk udløb (kun DISCONNECTED-events evictor). 86400 = 24t.</div>
          </div>
          <div id="pxgrid-worker-status" class="hint" style="margin-top:0.4rem; padding:0.5rem; background:rgba(0,0,0,0.04); border-radius:4px;"></div>
          <div class="actions" style="margin-top:0.4rem;">
            <button type="button" id="pxgrid-worker-refresh-btn" class="secondary"></button>
            <button type="button" id="pxgrid-worker-restart-btn" class="secondary"></button>
          </div>
        </fieldset>
        <div class="actions">
          <button type="submit" id="pxgrid-btn-save"></button>
          <button type="button" id="pxgrid-test-btn" class="secondary"></button>
          <button type="button" id="pxgrid-stomp-btn" class="secondary"></button>
          <button type="button" id="pxgrid-reset-btn" class="danger" style="margin-left:auto;"></button>
        </div>
        <div id="pxgrid-msg" style="margin-top:0.6rem;"></div>
        <div class="hint" style="margin-top:0.4rem;">
          <strong>Test STOMP-subscription</strong> verificerer at WebSocket+STOMP-laget mod pubsub-noden virker.
          Subscriber kortvarigt til <code>com.cisco.ise.session</code> og rapporterer hvor mange events der kom.
          Tom-resultat (0 events) er ikke en fejl — bare lav RADIUS-trafik i tidsvinduet.
        </div>
        <div class="hint" style="margin-top:0.4rem;">
          <strong>Nulstil registrering</strong> sletter cert/key/CA/CSR-filer fra
          portalen og rydder gemt password — så CSR-flowet kan køres forfra.
          Bruges efter server-skift, forkert cert, eller når noget er gået i hak.
          <em>Husk også at slette klient-entry'en i ISE → pxGrid Services → All
          Clients hvis du vil starte 100% rent.</em>
        </div>
      </form>
    </div>
    ` : ""}

    ${isAdmin ? `
    <nav class="settings-subtab-nav" data-for-tab="portal-bruger-config">
      <button class="settings-subtab" data-subtab="pbc-roles">${t("settings.subtab_roles")}</button>
      <button class="settings-subtab" data-subtab="pbc-users">${t("settings.subtab_users")}</button>
      <button class="settings-subtab" data-subtab="pbc-templates">${t("settings.subtab_templates")}</button>
    </nav>
    <nav class="settings-subtab-nav" data-for-tab="portal-config">
      <button class="settings-subtab" data-subtab="pc-psk">${t("settings.subtab_psk")}</button>
      <button class="settings-subtab" data-subtab="pc-locale">${t("settings.subtab_locale")}</button>
      <button class="settings-subtab" data-subtab="pc-ise-config">${t("settings.subtab_ise_purge")}</button>
      <button class="settings-subtab" data-subtab="pc-update">${t("settings.subtab_update")}</button>
      <button class="settings-subtab" data-subtab="pc-advanced">${t("settings.subtab_advanced")}</button>
    </nav>
    <div class="card" data-tab="portal-config" data-subtab="pc-ise-config">
      <h3>Anbefalet ISE purge-config</h3>
      <p class="hint">
        ISE's default endpoint-purge-policy sletter endpoints efter inaktivitet — det er
        ødelæggende for portal-managed devices. <strong>ISE 3.5+</strong> understøtter
        custom attributes som purge-condition (i 3.4 og tidligere er denne mulighed ikke
        tilgængelig — der skal man bruge Identity Group som condition i stedet).
      </p>
      <p class="hint">
        Portalen stempler automatisk <code>HypervisionISEPortal = true</code> på alle
        endpoints den opretter eller redigerer. Tilføj én "Never Purge"-regel i ISE der
        matcher den attribut, så slipper portal-endpoints for purge:
      </p>
      <ol style="margin-left:1rem; line-height:1.6;">
        <li>Log på ISE GUI som admin</li>
        <li>Gå til <strong>Administration → Identity Management → Settings → Endpoint Purge</strong></li>
        <li>Find sektionen <strong>Never Purge</strong> og klik <strong>Add</strong> (eller "Insert New Rule")</li>
        <li>Sæt felterne:
          <ul style="margin-top:0.3rem;">
            <li><strong>Rule Name:</strong> <code>HyperVision Portal</code> <button type="button" class="secondary small copy-btn" data-copy="HyperVision Portal">${t("settings.purge_copy_btn")}</button></li>
            <li><strong>Condition:</strong> <code>CUSTOMATTRIBUTE HypervisionISEPortal EQUALS true</code> <button type="button" class="secondary small copy-btn" data-copy="HypervisionISEPortal">${t("settings.purge_copy_attr_btn")}</button></li>
            <li><strong>Status:</strong> ✅ Enabled</li>
          </ul>
        </li>
        <li>Klik <strong>Save</strong></li>
      </ol>
      <p class="hint" style="margin-top:0.5rem;">
        Der findes <em>ingen ERS/Open API</em> til at oprette purge-rules programmatisk
        — det skal gøres manuelt i ISE GUI'en. Til gengæld er det en engangs-opsætning.
      </p>
      <p class="hint">
        <strong>ISE 3.4 alternativ</strong> (uden custom-attribute support i purge-rules):
        opret en dedikeret Endpoint Identity Group (fx <code>HypervisionPortalManaged</code>)
        og placér portal-endpoints i den; brug derefter Identity Group som condition i Never Purge-rule.
      </p>
      <div id="purge-protect-msg" class="hint"></div>
    </div>

    <div class="card" data-tab="portal-bruger-config" data-subtab="pbc-roles">
      <h3 id="roles-card-h3"></h3>
      <p class="hint">
        System adm-tags der kan sættes på endpoints (CA <code>HypervisionRoles</code>) og
        tildeles brugere. Non-admin ser kun endpoints tagget med en af deres effektive
        System adm (tildelte + deres eget username, der altid er en implicit System adm-rolle).
        Portal-admin har ingen System adm tilknyttet og ser derfor alt — det er admin der
        fordeler System adm/tags på endpoints. Hvert username får automatisk en
        System adm-rolle med samme navn ved bruger-oprettelse.
        Navne må kun indeholde <code>A-Z a-z 0-9 _ -</code> (max 64 tegn).
      </p>
      <div id="roles-msg"></div>
      <table class="users-table">
        <thead>
          <tr>
            <th id="roles-col-name"></th>
            <th id="roles-col-desc"></th>
            <th style="width:9rem;" id="roles-col-created-by"></th>
            <th style="width:9rem;" id="roles-col-created"></th>
            <th style="width:6rem;" id="roles-col-action"></th>
          </tr>
        </thead>
        <tbody id="roles-tbody"></tbody>
      </table>
      <form id="role-create-form" class="user-create-row">
        <input type="text" id="new-role-name"
               pattern="[A-Za-z0-9_\\-]{1,64}" maxlength="64" required />
        <input type="text" id="new-role-desc" maxlength="256" />
        <button type="submit" id="roles-btn-create"></button>
      </form>
    </div>

    <div class="card" data-tab="portal-bruger-config" data-subtab="pbc-users">
      <h3 id="users-section-title"></h3>
      <p class="hint" id="users-section-hint"></p>
      <p class="hint" id="users-tacacs-hint" style="display:none;background:var(--bg-alt,#f8f9fa);border-left:3px solid var(--accent,#3b82f6);padding:0.5rem 0.75rem;border-radius:4px;"></p>
      <div id="users-msg"></div>
      <table class="users-table">
        <thead>
          <tr>
            <th id="users-col-username"></th>
            <th style="width:9rem;" id="users-col-role"></th>
            <th style="width:7rem;" id="users-col-type"></th>
            <th id="users-col-roles"></th>
            <th id="users-col-templates"></th>
            <th style="width:11rem;" id="users-col-last-login"></th>
            <th style="width:9rem;" id="users-col-created"></th>
            <th style="width:10rem;" id="users-col-actions"></th>
          </tr>
        </thead>
        <tbody id="users-tbody"></tbody>
      </table>
      <form id="user-create-form" class="user-create-row">
        <input type="text" id="new-username" minlength="3" required />
        <input type="password" id="new-password" minlength="8" required />
        <select id="new-role">
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="editor-psk" id="new-role-editor-psk"></option>
          <option value="admin">admin</option>
          <option value="registrant" id="new-role-registrant"></option>
          <option value="registrant_templet" id="new-role-registrant-tpl"></option>
        </select>
        <button type="submit" id="users-btn-create"></button>
      </form>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-auth-config">
      <h3 id="auth-card-h3"></h3>
      <div id="auth-cfg-msg"></div>
      <form id="auth-cfg-form">
        <div class="field">
          <label for="auth_mode" id="auth-mode-lbl">Auth mode</label>
          <select id="auth_mode">
            <option value="local" id="auth-mode-local-opt"></option>
            <option value="tacacs" id="auth-mode-tacacs-opt"></option>
          </select>
        </div>

        <fieldset id="tacacs-fields" style="border:1px solid var(--border);border-radius:6px;padding:1rem;margin-top:0.75rem;">
          <legend style="padding:0 0.5rem;font-weight:600;">TACACS+ server</legend>
          <div class="field">
            <label for="tacacs_host" id="auth-tacacs-host-lbl"></label>
            <input type="text" id="tacacs_host" placeholder="10.0.0.10" autocomplete="off" />
          </div>
          <div class="field">
            <label for="tacacs_port" id="auth-tacacs-port-lbl"></label>
            <input type="number" id="tacacs_port" value="49" min="1" max="65535" />
          </div>
          <div class="field">
            <label for="tacacs_secret" id="auth-tacacs-secret-lbl"></label>
            <input type="password" id="tacacs_secret" autocomplete="new-password" />
            <div class="hint" id="tacacs-secret-hint"></div>
          </div>
          <div class="field">
            <label for="tacacs_timeout" id="auth-tacacs-timeout-lbl"></label>
            <input type="number" id="tacacs_timeout" value="5" min="1" max="60" />
          </div>
          <div class="field">
            <label>
              <input type="checkbox" id="tacacs_fallback" />
              <span id="auth-tacacs-fallback-lbl"></span>
            </label>
          </div>

          <fieldset style="border:1px solid var(--border);border-radius:4px;padding:0.75rem;margin-top:0.75rem;">
            <legend style="padding:0 0.5rem;font-size:0.85rem;color:var(--text-muted);" id="auth-attr-mapping-lbl"></legend>
            <div class="field">
              <label for="tacacs_profile_attr" id="auth-profile-attr-lbl"></label>
              <input type="text" id="tacacs_profile_attr" placeholder="portal-operator-profile" autocomplete="off" />
            </div>
          </fieldset>
        </fieldset>

        <div style="margin-top:1rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <button type="submit" id="auth-btn-save"></button>
          <button type="button" id="tacacs-test-btn" class="secondary" id="auth-btn-test"></button>
        </div>
      </form>

      <div id="tacacs-test-panel" style="display:none;margin-top:1rem;">
        <fieldset style="border:1px solid var(--border);border-radius:6px;padding:1rem;">
          <legend style="padding:0 0.5rem;font-weight:600;" id="auth-test-legend-lbl"></legend>
          <div class="field">
            <label for="test-tacacs-user" id="auth-test-user-lbl"></label>
            <input type="text" id="test-tacacs-user" autocomplete="off" />
          </div>
          <div class="field">
            <label for="test-tacacs-pw" id="auth-test-pw-lbl"></label>
            <input type="password" id="test-tacacs-pw" autocomplete="new-password" />
          </div>
          <button type="button" id="tacacs-run-test-btn"></button>
          <div id="tacacs-test-result" style="margin-top:0.75rem;"></div>
        </fieldset>
      </div>
    </div>

    <div class="card" data-tab="portal-auth-config" style="margin-top:1rem;">
      <h3 id="auth-op-card-h3"></h3>
    </div>
    ` : ""}

    ${isPskEditorUser ? `
    <div class="card" data-tab="portal-config" ${isAdmin ? 'data-subtab="pc-psk"' : ""}>
      <h3 id="psk-card-h3"></h3>
      <div id="psk-policy-msg"></div>
      <form id="psk-policy-form">
        <div class="field">
          <label id="psk-mode-type-lbl"></label>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="psk-type" id="psk-type-mpsk" value="MPSK" checked /> <b>MPSK</b> — Multi-PSK (Cisco WLC)</label>
            <label class="radio-label"><input type="radio" name="psk-type" id="psk-type-ipsk" value="IPSK" /> <b>IPSK</b> — Identity PSK (Cisco ISE RADIUS). Portalen tilføjer automatisk <code>psk=</code>-prefix i ISE.</label>
          </div>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-show-key" /> <span id="psk-show-key-lbl"></span></label>
        </div>
        <div class="field">
          <label for="psk-min-length" id="psk-min-length-lbl"></label>
          <input type="number" id="psk-min-length" min="8" max="128" step="1" value="8" />
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-req-upper" /> <span id="psk-req-upper-lbl"></span></label>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-req-number" /> <span id="psk-req-number-lbl"></span></label>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-req-special" /> <span id="psk-req-special-lbl"></span></label>
        </div>
        <div class="actions">
          <button type="submit" id="psk-btn-save"></button>
          <button type="button" id="psk-test-gen" class="secondary" id="psk-btn-test"></button>
        </div>
      </form>
      <div id="psk-gen-result" class="hint" style="margin-top:0.5rem;font-family:monospace;"></div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-bruger-config" data-subtab="pbc-templates">
      <h3 id="tpl-card-h3"></h3>
      <div id="tpl-msg"></div>
      <div id="tpl-list" style="margin-bottom:1rem;"></div>
      <button type="button" id="tpl-new-btn" class="secondary"></button>

      <div id="tpl-form-wrap" class="hidden" style="margin-top:1.5rem;border-top:1px solid var(--border,#e2e8f0);padding-top:1.25rem;">
        <h4 id="tpl-form-title" style="margin:0 0 1.25rem;"></h4>
        <input type="hidden" id="tpl-edit-id" value="" />
        <form id="tpl-form" onsubmit="return false;" style="max-width:560px;">
          <div class="field">
            <label for="tpl-name" id="tpl-name-lbl"></label>
            <input type="text" id="tpl-name" placeholder="fx ESP32-Modbus" required />
          </div>
          <div class="field">
            <label for="tpl-desc-field" id="tpl-desc-lbl"></label>
            <input type="text" id="tpl-desc-field" />
          </div>
          <div class="field">
            <label for="tpl-group" id="tpl-group-lbl"></label>
            <select id="tpl-group">
              <option value="" id="tpl-group-none-opt"></option>
            </select>
          </div>
          <div class="field">
            <label for="tpl-ep-desc" id="tpl-ep-desc-lbl"></label>
            <input type="text" id="tpl-ep-desc" />
          </div>
          <div id="tpl-attrs-wrap"></div>
          <div class="field checkbox-field">
            <input type="checkbox" id="tpl-static-group" />
            <label for="tpl-static-group">Static Group Assignment</label>
          </div>
          <div class="field">
            <label id="tpl-visible-lbl"></label>
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem 1.5rem;">
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="editor" /> editor</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="editor-psk" /> editor-psk</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="registrant" /> registrant</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="registrant_templet" /> registrant_templet</label>
            </div>
          </div>
          <div class="actions" style="margin-top:1.25rem;">
            <button type="button" id="tpl-save-btn" class="primary"></button>
            <button type="button" id="tpl-cancel-btn" class="secondary"></button>
          </div>
        </form>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-config" data-subtab="pc-locale">
      <h3 id="locale-card-title">Portalsrog</h3>
      <p class="hint" id="locale-card-hint">Standardsprog for brugere uden personligt sprogvalg.</p>
      <div id="locale-msg"></div>
      <form id="locale-form">
        <div class="field">
          <label for="portal-language" id="locale-label">Standard sprog</label>
          <select id="portal-language">
            <option value="da">Dansk</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit" id="locale-submit">Gem sprogindstilling</button>
        </div>
      </form>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-config" data-subtab="pc-update">
      <h3 id="update-card-h3"></h3>
      <div id="update-msg"></div>

      <div class="field">
        <label id="update-pkg-lbl"></label>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <input type="file" id="update-file-input" accept=".zip" style="flex:1;min-width:200px;" />
          <button type="button" id="update-validate-btn" class="secondary" disabled></button>
        </div>
      </div>

      <div id="update-preview" class="hidden" style="margin-top:1rem;">
        <div class="field">
          <label id="update-pkg-info-lbl"></label>
          <div id="update-pkg-info" style="font-family:monospace;font-size:0.85rem;background:var(--bg-secondary,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:0.75rem;"></div>
        </div>
        <div id="update-file-list-wrap" class="field hidden">
          <label id="update-file-list-lbl"></label>
          <div id="update-file-list" style="font-family:monospace;font-size:0.78rem;max-height:180px;overflow-y:auto;background:var(--bg-secondary,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:0.5rem;white-space:pre;"></div>
        </div>
        <div id="update-blocked-wrap" class="field hidden">
          <label style="color:#b45309;" id="update-blocked-lbl"></label>
          <div id="update-blocked-list" style="font-family:monospace;font-size:0.78rem;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:0.5rem;white-space:pre;color:#92400e;"></div>
        </div>
        <div class="actions" style="margin-top:1rem;">
          <button type="button" id="update-apply-btn" class="primary" disabled></button>
        </div>
      </div>

      <div id="update-result" class="hidden" style="margin-top:1rem;">
        <div id="update-result-msg"></div>
      </div>

      <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border,#e2e8f0);">
        <h4 style="margin:0 0 0.5rem;" id="update-restart-h4"></h4>
        <p class="hint" style="margin:0 0 0.75rem;" id="update-restart-hint"></p>
        <div class="actions">
          <button type="button" id="update-restart-btn" class="secondary"></button>
        </div>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-config" data-subtab="pc-advanced">
      <h3 id="adv-card-h3"></h3>
      <div id="migration-sync-result" style="margin-bottom:0.75rem;"></div>
      <div class="actions">
        <button type="button" id="migration-sync-btn" class="secondary"></button>
      </div>
    </div>
    ` : ""}

    </div><!-- /settings-panels -->
  `;

  initSettingsTabs(container, isAdmin, isPskEditorUser);

  if (isAdmin) {
    await initBackendSection(container);
    await initCacheSection(container);
    await initPxGridSection(container);
    await initPurgeProtectSection(container);
    const rolesState = await initRolesSection(container);
    await initUsersSection(container, currentUser, rolesState);
    await initPortalAuthConfigSection(container);
  }
  if (isPskEditorUser) {
    await initPskPolicySection(container);
  }
  if (isAdmin) {
    await initLocaleSection(container);
    await initTemplatesSection(container);
    initSystemUpdateSection(container);
    initAdvancedSection(container);
  }
}

async function initLocaleSection(container) {
  const form = container.querySelector("#locale-form");
  if (!form) return;
  const msg = container.querySelector("#locale-msg");
  const sel = container.querySelector("#portal-language");

  // Opdater panel-tekster med aktiv locale
  const cardTitle = container.querySelector("#locale-card-title");
  const cardHint = container.querySelector("#locale-card-hint");
  const localeLabel = container.querySelector("#locale-label");
  const submitBtn = container.querySelector("#locale-submit");
  if (cardTitle) cardTitle.textContent = t("settings.locale_card");
  if (cardHint) cardHint.textContent = t("settings.locale_hint");
  if (localeLabel) localeLabel.textContent = t("settings.locale_label");
  if (submitBtn) submitBtn.textContent = t("settings.locale_submit");

  try {
    const data = await api.getPortalLocale();
    if (sel && data?.default_language) sel.value = data.default_language;
  } catch { /* ignore */ }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    try {
      await api.updatePortalLocale({ default_language: sel.value });
      msg.innerHTML = `<div class="alert success">${t("settings.locale_success")}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

async function initPxGridSection(container) {
  const msg = container.querySelector("#pxgrid-msg");
  const certStatus = container.querySelector("#pxgrid-cert-status");
  const uploadBlock = container.querySelector("#pxgrid-upload-block");
  const csrBlock = container.querySelector("#pxgrid-csr-block");
  const modeSel = container.querySelector("#pxgrid_cert_mode");
  const pwHint = container.querySelector("#pxgrid-pw-hint");

  // Set element texts
  const pxgridCardH3 = container.querySelector("#pxgrid-card-h3");
  if (pxgridCardH3) pxgridCardH3.textContent = t("settings.pxgrid_card");
  const pxgridEnabledLbl = container.querySelector("#pxgrid-enabled-lbl");
  if (pxgridEnabledLbl) pxgridEnabledLbl.textContent = t("settings.pxgrid_enabled_lbl");
  const pxgridEnabledHint = container.querySelector("#pxgrid-enabled-hint");
  if (pxgridEnabledHint) pxgridEnabledHint.textContent = t("settings.pxgrid_enabled_hint");
  const pxgridNodeNameLbl = container.querySelector("#pxgrid-node-name-lbl");
  if (pxgridNodeNameLbl) pxgridNodeNameLbl.textContent = t("settings.pxgrid_node_name");
  const pxgridNodeHint = container.querySelector("#pxgrid-node-hint");
  if (pxgridNodeHint) pxgridNodeHint.textContent = t("settings.pxgrid_node_hint");
  const pxgridExtraSansLbl = container.querySelector("#pxgrid-extra-sans-lbl");
  if (pxgridExtraSansLbl) pxgridExtraSansLbl.textContent = t("settings.pxgrid_extra_sans");
  const pxgridPsnLbl = container.querySelector("#pxgrid-psn-lbl");
  if (pxgridPsnLbl) pxgridPsnLbl.textContent = t("settings.pxgrid_psn");
  const pxgridPsnHint = container.querySelector("#pxgrid-psn-hint");
  if (pxgridPsnHint) pxgridPsnHint.textContent = t("settings.pxgrid_psn_hint");
  const pxgridCertModeLbl = container.querySelector("#pxgrid-cert-mode-lbl");
  if (pxgridCertModeLbl) pxgridCertModeLbl.textContent = t("settings.pxgrid_cert_mode");
  const pxgridCertUploadOpt = container.querySelector("#pxgrid-cert-upload-opt");
  if (pxgridCertUploadOpt) pxgridCertUploadOpt.textContent = t("settings.pxgrid_cert_upload");
  const pxgridCertCsrOpt = container.querySelector("#pxgrid-cert-csr-opt");
  if (pxgridCertCsrOpt) pxgridCertCsrOpt.textContent = t("settings.pxgrid_cert_csr");
  const pxgridUploadCertLbl = container.querySelector("#pxgrid-upload-cert-lbl");
  if (pxgridUploadCertLbl) pxgridUploadCertLbl.textContent = t("settings.pxgrid_upload_cert");
  const pxgridUploadKeyLbl = container.querySelector("#pxgrid-upload-key-lbl");
  if (pxgridUploadKeyLbl) pxgridUploadKeyLbl.textContent = t("settings.pxgrid_upload_key");
  const pxgridUploadCaLbl = container.querySelector("#pxgrid-upload-ca-lbl");
  if (pxgridUploadCaLbl) pxgridUploadCaLbl.textContent = t("settings.pxgrid_upload_ca");
  const pxgridPfxLabelEl = container.querySelector("#pxgrid-pfx-label-el");
  if (pxgridPfxLabelEl) pxgridPfxLabelEl.textContent = t("settings.pxgrid_pfx_label");
  const pxgridPfxPwLbl = container.querySelector("#pxgrid-pfx-pw-lbl");
  if (pxgridPfxPwLbl) pxgridPfxPwLbl.textContent = t("settings.pxgrid_pfx_pw");
  const pxgridPfxPw = container.querySelector("#pxgrid-pfx-pw");
  if (pxgridPfxPw) pxgridPfxPw.placeholder = t("settings.pxgrid_pfx_ph");
  const pxgridPfxImportBtn = container.querySelector("#pxgrid-pfx-import-btn");
  if (pxgridPfxImportBtn) pxgridPfxImportBtn.textContent = t("settings.pxgrid_pfx_btn");
  const pxgridCsrStep1Lbl = container.querySelector("#pxgrid-csr-step1-lbl");
  if (pxgridCsrStep1Lbl) pxgridCsrStep1Lbl.textContent = t("settings.pxgrid_csr_step1");
  const pxgridCsrStep1Hint = container.querySelector("#pxgrid-csr-step1-hint");
  if (pxgridCsrStep1Hint) pxgridCsrStep1Hint.textContent = t("settings.pxgrid_csr_step1_hint");
  const pxgridCsrBtn = container.querySelector("#pxgrid-csr-btn");
  if (pxgridCsrBtn) pxgridCsrBtn.textContent = t("settings.pxgrid_csr_btn");
  const pxgridCsrDlBtn = container.querySelector("#pxgrid-csr-dl-btn");
  if (pxgridCsrDlBtn) pxgridCsrDlBtn.textContent = t("settings.pxgrid_csr_dl_btn");
  const pxgridCsrStep2Lbl = container.querySelector("#pxgrid-csr-step2-lbl");
  if (pxgridCsrStep2Lbl) pxgridCsrStep2Lbl.textContent = t("settings.pxgrid_csr_step2");
  const pxgridCsrStep3Lbl = container.querySelector("#pxgrid-csr-step3-lbl");
  if (pxgridCsrStep3Lbl) pxgridCsrStep3Lbl.textContent = t("settings.pxgrid_csr_step3");
  const pxgridCsrStep3Hint = container.querySelector("#pxgrid-csr-step3-hint");
  if (pxgridCsrStep3Hint) pxgridCsrStep3Hint.textContent = t("settings.pxgrid_csr_step3_hint");
  const pxgridCsrStep4Lbl = container.querySelector("#pxgrid-csr-step4-lbl");
  if (pxgridCsrStep4Lbl) pxgridCsrStep4Lbl.textContent = t("settings.pxgrid_csr_step4");
  const pxgridCsrStep4Hint = container.querySelector("#pxgrid-csr-step4-hint");
  if (pxgridCsrStep4Hint) pxgridCsrStep4Hint.textContent = t("settings.pxgrid_csr_step4_hint");
  const pxgridCsrStep5Lbl = container.querySelector("#pxgrid-csr-step5-lbl");
  if (pxgridCsrStep5Lbl) pxgridCsrStep5Lbl.textContent = t("settings.pxgrid_csr_step5");
  const pxgridCsrStep5Hint = container.querySelector("#pxgrid-csr-step5-hint");
  if (pxgridCsrStep5Hint) pxgridCsrStep5Hint.textContent = t("settings.pxgrid_csr_step5_hint");
  const pxgridAccountBtn = container.querySelector("#pxgrid-account-btn");
  if (pxgridAccountBtn) pxgridAccountBtn.textContent = t("settings.pxgrid_account_btn");
  const pxgridCertPathLbl = container.querySelector("#pxgrid-cert-path-lbl");
  if (pxgridCertPathLbl) pxgridCertPathLbl.textContent = t("settings.pxgrid_cert_path");
  const pxgridKeyPathLbl = container.querySelector("#pxgrid-key-path-lbl");
  if (pxgridKeyPathLbl) pxgridKeyPathLbl.textContent = t("settings.pxgrid_key_path");
  const pxgridCaPathLbl = container.querySelector("#pxgrid-ca-path-lbl");
  if (pxgridCaPathLbl) pxgridCaPathLbl.textContent = t("settings.pxgrid_ca_path");
  const pxgridPhase2bLbl = container.querySelector("#pxgrid-phase2b-lbl");
  if (pxgridPhase2bLbl) pxgridPhase2bLbl.textContent = t("settings.pxgrid_phase2b");
  const pxgridWorkerLbl = container.querySelector("#pxgrid-worker-lbl");
  if (pxgridWorkerLbl) pxgridWorkerLbl.textContent = t("settings.pxgrid_worker_lbl");
  const pxgridWorkerHint = container.querySelector("#pxgrid-worker-hint");
  if (pxgridWorkerHint) pxgridWorkerHint.textContent = t("settings.pxgrid_worker_hint");
  const pxgridSessionTopicLbl = container.querySelector("#pxgrid-session-topic-lbl");
  if (pxgridSessionTopicLbl) pxgridSessionTopicLbl.textContent = t("settings.pxgrid_session_topic");
  const pxgridEpTopicLbl = container.querySelector("#pxgrid-ep-topic-lbl");
  if (pxgridEpTopicLbl) pxgridEpTopicLbl.textContent = t("settings.pxgrid_ep_topic_lbl");
  const pxgridEpServiceLbl = container.querySelector("#pxgrid-ep-service-lbl");
  if (pxgridEpServiceLbl) pxgridEpServiceLbl.textContent = t("settings.pxgrid_ep_service");
  const pxgridEpTopicFallbackLbl = container.querySelector("#pxgrid-ep-topic-fallback-lbl");
  if (pxgridEpTopicFallbackLbl) pxgridEpTopicFallbackLbl.textContent = t("settings.pxgrid_ep_topic");
  const pxgridHeartbeatLbl = container.querySelector("#pxgrid-heartbeat-lbl");
  if (pxgridHeartbeatLbl) pxgridHeartbeatLbl.textContent = t("settings.pxgrid_heartbeat");
  const pxgridReconnectMinLbl = container.querySelector("#pxgrid-reconnect-min-lbl");
  if (pxgridReconnectMinLbl) pxgridReconnectMinLbl.textContent = t("settings.pxgrid_reconnect_min");
  const pxgridReconnectMaxLbl = container.querySelector("#pxgrid-reconnect-max-lbl");
  if (pxgridReconnectMaxLbl) pxgridReconnectMaxLbl.textContent = t("settings.pxgrid_reconnect_max");
  const pxgridSessionAgeLbl = container.querySelector("#pxgrid-session-age-lbl");
  if (pxgridSessionAgeLbl) pxgridSessionAgeLbl.textContent = t("settings.pxgrid_session_age");
  const pxgridWorkerRefreshBtn = container.querySelector("#pxgrid-worker-refresh-btn");
  if (pxgridWorkerRefreshBtn) pxgridWorkerRefreshBtn.textContent = t("settings.pxgrid_btn_refresh");
  const pxgridWorkerRestartBtn = container.querySelector("#pxgrid-worker-restart-btn");
  if (pxgridWorkerRestartBtn) pxgridWorkerRestartBtn.textContent = t("settings.pxgrid_btn_restart");
  const pxgridBtnSave = container.querySelector("#pxgrid-btn-save");
  if (pxgridBtnSave) pxgridBtnSave.textContent = t("settings.pxgrid_btn_save");
  const pxgridTestBtn = container.querySelector("#pxgrid-test-btn");
  if (pxgridTestBtn) pxgridTestBtn.textContent = t("settings.pxgrid_btn_test");
  const pxgridStompBtn = container.querySelector("#pxgrid-stomp-btn");
  if (pxgridStompBtn) pxgridStompBtn.textContent = t("settings.pxgrid_btn_stomp");
  const pxgridResetBtn = container.querySelector("#pxgrid-reset-btn");
  if (pxgridResetBtn) pxgridResetBtn.textContent = t("settings.pxgrid_btn_reset");

  function applyMode(mode) {
    // I CSR-mode bor *alle* cert-uploads inde i csrBlock (trin 3 + 3b), og
    // upload-blokkens "Privat key"-felt ville overskrive den nøgle portalen
    // lige har genereret — så vi skjuler hele upload-blokken. Upload-mode
    // er omvendt simpelt: 3 separate PEMs eller PFX-import.
    if (mode === "csr") {
      uploadBlock.hidden = true;
      csrBlock.hidden = false;
    } else {
      uploadBlock.hidden = false;
      csrBlock.hidden = true;
    }
  }

  async function loadSettings() {
    try {
      const s = await api.getPxGridSettings();
      container.querySelector("#pxgrid_enabled").checked = !!s.pxgrid_enabled;
      container.querySelector("#pxgrid_node_name").value = s.pxgrid_node_name || "";
      container.querySelector("#pxgrid_cert_extra_sans").value = s.pxgrid_cert_extra_sans || "";
      container.querySelector("#pxgrid_psn_fqdn").value = s.pxgrid_psn_fqdn || "";
      modeSel.value = s.pxgrid_cert_mode || "upload";
      container.querySelector("#pxgrid_cert_path").value = s.pxgrid_cert_path || "";
      container.querySelector("#pxgrid_key_path").value = s.pxgrid_key_path || "";
      container.querySelector("#pxgrid_ca_bundle_path").value = s.pxgrid_ca_bundle_path || "";
      container.querySelector("#pxgrid_worker_enabled").checked = s.pxgrid_worker_enabled !== false;
      container.querySelector("#pxgrid_session_topic").value = s.pxgrid_session_topic || "/topic/com.cisco.ise.session";
      container.querySelector("#pxgrid_stomp_heartbeat_ms").value = s.pxgrid_stomp_heartbeat_ms ?? 30000;
      container.querySelector("#pxgrid_stomp_reconnect_min_s").value = s.pxgrid_stomp_reconnect_min_s ?? 1;
      container.querySelector("#pxgrid_stomp_reconnect_max_s").value = s.pxgrid_stomp_reconnect_max_s ?? 300;
      container.querySelector("#pxgrid_session_cache_max_age_s").value = s.pxgrid_session_cache_max_age_s ?? 0;
      container.querySelector("#pxgrid_endpoint_topic_enabled").checked = !!s.pxgrid_endpoint_topic_enabled;
      container.querySelector("#pxgrid_endpoint_topic").value = s.pxgrid_endpoint_topic || "/topic/com.cisco.ise.endpoint";
      container.querySelector("#pxgrid_endpoint_service").value = s.pxgrid_endpoint_service || "com.cisco.ise.endpoint";
      const cls = s.cert_status === "ok" ? "success"
                : s.cert_status === "missing" ? "warning" : "error";
      certStatus.innerHTML = `${t("settings.pxgrid_cert_status")}<span class="alert ${cls}" style="display:inline;padding:2px 8px;">${esc(s.cert_status)}</span>`;
      pwHint.textContent = s.pxgrid_password_set
        ? t("settings.pxgrid_pw_set")
        : t("settings.pxgrid_pw_empty");
      applyMode(s.pxgrid_cert_mode || "upload");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_load_err").replace("{msg}", esc(err.message))}</div>`;
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
      pxgrid_cert_extra_sans: container.querySelector("#pxgrid_cert_extra_sans").value.trim(),
      pxgrid_worker_enabled: container.querySelector("#pxgrid_worker_enabled").checked,
      pxgrid_session_topic: container.querySelector("#pxgrid_session_topic").value.trim() || "/topic/com.cisco.ise.session",
      pxgrid_stomp_heartbeat_ms: parseInt(container.querySelector("#pxgrid_stomp_heartbeat_ms").value, 10) || 0,
      pxgrid_stomp_reconnect_min_s: parseFloat(container.querySelector("#pxgrid_stomp_reconnect_min_s").value) || 1,
      pxgrid_stomp_reconnect_max_s: parseFloat(container.querySelector("#pxgrid_stomp_reconnect_max_s").value) || 300,
      pxgrid_session_cache_max_age_s: parseFloat(container.querySelector("#pxgrid_session_cache_max_age_s").value) || 0,
      pxgrid_endpoint_topic_enabled: container.querySelector("#pxgrid_endpoint_topic_enabled").checked,
      pxgrid_endpoint_topic: container.querySelector("#pxgrid_endpoint_topic").value.trim() || "/topic/com.cisco.ise.endpoint",
      pxgrid_endpoint_service: container.querySelector("#pxgrid_endpoint_service").value.trim() || "com.cisco.ise.endpoint",
    };
  }

  container.querySelector("#pxgrid-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    try {
      await api.updatePxGridSettings(buildPayload());
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_saved")}</div>`;
      container.querySelector("#pxgrid_password").value = "";
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-test-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_testing")}</div>`;
    try {
      const r = await api.testPxGridConnection();
      const cls = r.ok ? "success" : "error";
      const services = r.services_found?.length
        ? `<br><small>Services: ${r.services_found.map(esc).join(", ")}</small>`
        : "";
      msg.innerHTML = `<div class="alert ${cls}">[${esc(r.step)}] ${esc(r.message)}${r.latency_ms ? ` (${r.latency_ms}ms)` : ""}${services}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_test_failed").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#pxgrid-stomp-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_stomp_testing")}</div>`;
    try {
      const r = await api.runPxGridStompProbe(10);
      const cls = r.ok ? "success" : "error";
      const samples = r.sample_payloads?.length
        ? `<br><details style="margin-top:0.4rem;"><summary>${r.sample_payloads.length} sample payload(s)</summary><pre style="white-space:pre-wrap;font-size:0.85em;background:#f3f4f6;padding:0.5rem;margin-top:0.3rem;border-radius:4px;">${r.sample_payloads.map(esc).join("\n---\n")}</pre></details>`
        : "";
      const broker = r.peer_node ? ` via ${esc(r.peer_node)}` : "";
      const headline = r.ok
        ? t("settings.pxgrid_stomp_ok").replace("{step}", esc(r.step)).replace("{n}", r.messages_received).replace("{dur}", r.duration_s).replace("{broker}", broker)
        : t("settings.pxgrid_stomp_fail").replace("{step}", esc(r.step)).replace("{err}", esc(r.error || "ukendt"));
      msg.innerHTML = `<div class="alert ${cls}">${headline}${samples}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_stomp_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  function fmtAge(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return t("settings.cache_ago").replace("{t}", s + "s");
    if (s < 3600) return t("settings.cache_ago").replace("{t}", Math.floor(s/60) + "m");
    return t("settings.cache_ago").replace("{t}", Math.floor(s/3600) + "t");
  }

  async function refreshWorkerStatus() {
    const el = container.querySelector("#pxgrid-worker-status");
    if (!el) return;
    try {
      const w = await api.getPxGridWorkerStatus();
      const dot = w.connected ? "🟢" : (w.running ? "🟡" : "🔴");
      const lbl = w.connected ? t("settings.pxgrid_worker_conn") : (w.running ? t("settings.pxgrid_worker_run") : t("settings.pxgrid_worker_stop"));
      const lastErr = w.last_error
        ? `<br><span style="color:#b91c1c;">${t("settings.pxgrid_worker_lasterr")} ${esc(w.last_error)}</span>`
        : "";
      const topics = (w.subscribed_topics && w.subscribed_topics.length)
        ? w.subscribed_topics : (w.subscribed_topic ? [w.subscribed_topic] : []);
      const topicsHtml = topics.length
        ? topics.map(t => `<code>${esc(t)}</code>`).join(", ")
        : "—";
      let lookupHtml = "";
      if (w.endpoint_lookup_service) {
        const propsKeys = Object.keys(w.endpoint_lookup_props || {});
        const propsLine = propsKeys.length
          ? `<pre style="margin:0.2rem 0;font-size:0.85em;background:#f3f4f6;padding:0.4rem;border-radius:4px;white-space:pre-wrap;">${esc(JSON.stringify(w.endpoint_lookup_props, null, 2))}</pre>`
          : `<em>${t("settings.pxgrid_no_props")}</em>`;
        lookupHtml = `<br><strong>${t("settings.pxgrid_ep_lookup")}</strong> <code>${esc(w.endpoint_lookup_service)}</code> ${propsLine}`;
      }
      el.innerHTML = `
        <strong>${dot} Worker: ${esc(lbl)}</strong>
        — peer: <code>${esc(w.peer_node || "—")}</code>
        — topics: ${topicsHtml}<br>
        Events: <strong>${w.messages_total}</strong>
        (session: ${w.session_events_total ?? 0}, endpoint: ${w.endpoint_events_total ?? 0})
        · cache: <strong>${w.cache_size}</strong> sessioner
        · reconnects: ${w.reconnect_count}
        · sidste event: ${fmtAge(w.last_event_at)}
        · sidste connect: ${fmtAge(w.last_connect_at)}${lastErr}${lookupHtml}`;
    } catch (err) {
      el.innerHTML = `<span style="color:#b91c1c;">${t("settings.pxgrid_worker_err").replace("{msg}", esc(err.message))}</span>`;
    }
  }

  container.querySelector("#pxgrid-worker-refresh-btn").addEventListener("click", refreshWorkerStatus);
  container.querySelector("#pxgrid-worker-restart-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_restarting")}</div>`;
    try {
      await api.restartPxGridWorker();
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_restarted")}</div>`;
      await refreshWorkerStatus();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_restart_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  // Auto-refresh worker-status hvert 10s mens settings-siden er åben.
  refreshWorkerStatus();
  const workerStatusTimer = setInterval(refreshWorkerStatus, 10000);
  // Best-effort cleanup når view skiftes (app.js rydder containerens children).
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      clearInterval(workerStatusTimer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

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

  async function downloadCsr({ silentOnError = false } = {}) {
    try {
      const filename = await api.downloadPxGridCsr();
      return filename;
    } catch (err) {
      if (!silentOnError) {
        msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_csr_dl_err").replace("{msg}", esc(err.message))}</div>`;
      }
      return null;
    }
  }

  container.querySelector("#pxgrid-csr-btn").addEventListener("click", async () => {
    if (!confirm(t("settings.pxgrid_csr_confirm"))) return;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_csr_generating")}</div>`;
    try {
      await autoSaveBeforeAction();
      const s = await api.generatePxGridCsr();
      // Auto-trigger download so admin har CSR-filen i Downloads med det samme.
      const filename = await downloadCsr({ silentOnError: true });
      const dlNote = filename
        ? t("settings.pxgrid_csr_dl_ok_note").replace("{filename}", `<code>${esc(filename)}</code>`)
        : t("settings.pxgrid_csr_dl_fail_note");
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_csr_done").replace("{path}", `<code>${esc(s.pxgrid_key_path)}</code>`).replace("{dl_note}", dlNote)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-csr-dl-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_csr_dl_loading")}</div>`;
    const filename = await downloadCsr();
    if (filename) {
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_csr_dl_done").replace("{filename}", `<code>${esc(filename)}</code>`)}</div>`;
    }
  });

  container.querySelector("#pxgrid-account-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_account_load")}</div>`;
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

  container.querySelector("#pxgrid-reset-btn").addEventListener("click", async () => {
    const ok = window.confirm(t("settings.pxgrid_reset_confirm"));
    if (!ok) return;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_resetting")}</div>`;
    try {
      const r = await api.resetPxGridRegistration();
      msg.innerHTML = `<div class="alert success">${esc(r.message)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_reset_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#pxgrid-pfx-import-btn").addEventListener("click", async () => {
    const fileEl = container.querySelector("#pxgrid-pfx-file");
    const pwEl = container.querySelector("#pxgrid-pfx-pw");
    const file = fileEl.files?.[0];
    if (!file) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_pfx_no_file")}</div>`;
      return;
    }
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_pfx_importing")}</div>`;
    try {
      const s = await api.uploadPxGridPfx(file, pwEl.value);
      const caNote = s.pxgrid_ca_bundle_path
        ? ` CA-chain: <code>${esc(s.pxgrid_ca_bundle_path)}</code>.`
        : ` (Ingen CA-chain i bundlet — upload separat hvis nødvendigt.)`;
      msg.innerHTML = `<div class="alert success">PKCS#12 importeret. Cert: <code>${esc(s.pxgrid_cert_path)}</code>, Key: <code>${esc(s.pxgrid_key_path)}</code>.${caNote}</div>`;
      fileEl.value = "";
      pwEl.value = "";
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_pfx_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  for (const [kind, id] of [
    ["cert", "pxgrid-upload-cert"],
    ["key", "pxgrid-upload-key"],
    ["ca", "pxgrid-upload-ca"],
    // Trin 3 + 4 i CSR-flowet: samme backend-endpoint som upload-block,
    // men eksponeret inde i CSR-blokken så admin ikke skal hoppe ud af
    // flowet efter download fra MS certsrv / ISE internal CA.
    ["cert", "pxgrid-csr-signed-cert"],
    ["ca", "pxgrid-csr-ca-bundle"],
  ]) {
    const inputEl = container.querySelector(`#${id}`);
    const statusEl = container.querySelector(`#${id}-status`);
    inputEl.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const filename = file.name;
      msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_upload_loading").replace("{file}", esc(filename))}</div>`;
      if (statusEl) statusEl.innerHTML = `<span style="color:#666;">${t("settings.pxgrid_upload_loading").replace("{file}", esc(filename))}</span>`;
      try {
        await api.uploadPxGridCert(kind, file);
        msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_upload_done").replace("{kind}", esc(kind)).replace("{file}", esc(filename))}</div>`;
        if (statusEl) statusEl.innerHTML = `<span style="color:#16a34a;">${t("settings.pxgrid_upload_ok").replace("{file}", esc(filename))}</span>`;
        await loadSettings();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_upload_err").replace("{kind}", esc(kind)).replace("{msg}", esc(err.message))}</div>`;
        if (statusEl) statusEl.innerHTML = `<span style="color:#c0392b;">${t("settings.pxgrid_upload_fail").replace("{msg}", esc(err.message))}</span>`;
      } finally {
        // Reset input så samme fil kan vælges igen efter fejl/genupload.
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

  const pw = stats.prewarm;
  let prewarmRows = "";
  if (pw == null) {
    prewarmRows = `<tr><td colspan="2" style="color:#888;font-style:italic;">${t("settings.cache_prewarm_na")}</td></tr>`;
  } else {
    const scanPct = pw.total_endpoints > 0 ? Math.round(pw.scanned / pw.total_endpoints * 100) : 0;
    const scanStatus = pw.scanning
      ? t("settings.cache_scanning").replace("{done}", pw.scanned).replace("{total}", pw.total_endpoints).replace("{pct}", scanPct).replace("{n}", pw.scan_number)
      : pw.running ? t("settings.cache_active").replace("{n}", pw.scan_number + 1) : `<span style="color:#c0392b;">${t("settings.cache_stopped")}</span>`;
    const scanAge = pw.last_full_scan_age_s != null
      ? t("settings.cache_ago").replace("{t}", fmtAge(pw.last_full_scan_age_s * 1000)) : "—";
    const diskSave = pw.last_disk_save_at
      ? fmtTimestamp(pw.last_disk_save_at) : "—";
    prewarmRows = `
        <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Pre-warm worker</td></tr>
        <tr><td>Status</td><td>${scanStatus}</td></tr>
        <tr><td>${t("settings.cache_prewarm_last")}</td><td>${scanAge}</td></tr>
        <tr><td>${t("settings.cache_prewarm_disk")}</td><td>${diskSave}</td></tr>
        <tr><td>${t("settings.cache_prewarm_loaded")}</td><td>${pw.disk_loaded}</td></tr>
        <tr><td>${t("settings.cache_hot_queue")}</td><td>${t("settings.cache_hot_n").replace("{n}", pw.hot_queue_size)}</td></tr>
        ${pw.last_error ? `<tr><td>${t("settings.cache_last_err")}</td><td><span style="color:#c0392b;">${esc(pw.last_error)}</span></td></tr>` : ""}`;
  }

  container.innerHTML = `
    <table class="cache-stats-table">
      <tbody>
        <tr><td>Status</td><td>${stats.enabled ? t("settings.cache_stats_enabled") : t("settings.cache_stats_disabled")}</td></tr>
        <tr><td>TTL</td><td>${stats.ttl_seconds}s</td></tr>
        <tr><td>Stale-while-revalidate</td><td>${stats.stale_while_revalidate ? t("settings.cache_stats_on") : t("settings.cache_stats_off")}</td></tr>
        <tr><td>${t("settings.cache_detail_entries")}</td><td>${stats.detail_entries}</td></tr>
        <tr><td>${t("settings.cache_disk_stale")}</td><td>${stats.disk_stale_entries ?? 0}</td></tr>
        <tr><td>${t("settings.cache_disk_loads")}</td><td>${stats.disk_loads ?? 0}</td></tr>
        <tr><td>${t("settings.cache_groups")}</td><td>${stats.groups_cached ? t("cell.yes") : t("btn.no")}</td></tr>
        <tr><td>${t("settings.cache_hitrate")}</td><td>${hitRate === "—" ? "—" : hitRate + "%"} (hits: ${hits}, stale: ${staleServes}, misses: ${misses})</td></tr>
        <tr><td>${t("settings.cache_bg_refresh")}</td><td>${stats.bg_refreshes || 0} (${stats.inflight_detail_refreshes || 0} inflight)</td></tr>
        <tr><td>${t("settings.cache_invalidations")}</td><td>${stats.invalidations || 0}</td></tr>
        <tr><td>${t("settings.cache_last_sync")}</td><td>${fmtTimestamp(stats.last_sync_at)}</td></tr>
        <tr><td>${t("settings.cache_sync_err")}</td><td>${stats.last_sync_error ? `<span style="color:#c0392b;">${esc(stats.last_sync_error)}</span>` : t("settings.cache_no_err")}</td></tr>
        ${prewarmRows}
      </tbody>
    </table>
  `;
}

async function initCacheSection(container) {
  const msg = container.querySelector("#cache-msg");
  const statsBox = container.querySelector("#cache-stats");
  const refreshBtn = container.querySelector("#cache-refresh-btn");
  const invalidateBtn = container.querySelector("#cache-invalidate-btn");

  // Set element texts
  const cacheCardH3 = container.querySelector("#cache-card-h3");
  if (cacheCardH3) cacheCardH3.textContent = t("settings.cache_card");
  const cacheEnabledLbl = container.querySelector("#cache-enabled-lbl");
  if (cacheEnabledLbl) cacheEnabledLbl.textContent = t("settings.cache_enabled_lbl");
  const cacheEnabledHint = container.querySelector("#cache-enabled-hint");
  if (cacheEnabledHint) cacheEnabledHint.textContent = t("settings.cache_enabled_hint");
  const cacheTtlLbl = container.querySelector("#cache-ttl-lbl");
  if (cacheTtlLbl) cacheTtlLbl.textContent = t("settings.cache_ttl");
  const cacheStaleWrLbl = container.querySelector("#cache-stale-wr-lbl");
  if (cacheStaleWrLbl) cacheStaleWrLbl.textContent = t("settings.cache_stale_wr");
  const cacheSyncLbl = container.querySelector("#cache-sync-interval-lbl");
  if (cacheSyncLbl) cacheSyncLbl.textContent = t("settings.cache_sync_interval");
  const cachePrewarmH4 = container.querySelector("#cache-prewarm-h4");
  if (cachePrewarmH4) cachePrewarmH4.textContent = t("settings.cache_prewarm_h4");
  const cacheScanLbl = container.querySelector("#cache-scan-interval-lbl");
  if (cacheScanLbl) cacheScanLbl.textContent = t("settings.cache_scan_interval");
  const cacheConcurrencyLbl = container.querySelector("#cache-concurrency-lbl");
  if (cacheConcurrencyLbl) cacheConcurrencyLbl.textContent = t("settings.cache_concurrency");
  const cacheDiskPathLbl = container.querySelector("#cache-disk-path-lbl");
  if (cacheDiskPathLbl) cacheDiskPathLbl.textContent = t("settings.cache_disk_path_lbl");
  const cacheBtnSave = container.querySelector("#cache-btn-save");
  if (cacheBtnSave) cacheBtnSave.textContent = t("settings.cache_btn_save");
  const cacheLiveH4 = container.querySelector("#cache-live-status-h4");
  if (cacheLiveH4) cacheLiveH4.textContent = t("settings.cache_live_status");
  const cacheFetchingHint = container.querySelector("#cache-fetching-hint");
  if (cacheFetchingHint) cacheFetchingHint.textContent = t("settings.cache_fetching");
  const cacheRefreshBtn = container.querySelector("#cache-refresh-btn");
  if (cacheRefreshBtn) cacheRefreshBtn.textContent = t("settings.cache_btn_refresh");
  const cacheInvalidateBtn = container.querySelector("#cache-invalidate-btn");
  if (cacheInvalidateBtn) cacheInvalidateBtn.textContent = t("settings.cache_btn_clear");

  async function loadSettings() {
    try {
      const s = await api.getBackendSettings();
      container.querySelector("#cache_enabled").checked = !!s.cache_enabled;
      container.querySelector("#cache_ttl_seconds").value = s.cache_ttl_seconds ?? 60;
      container.querySelector("#cache_stale_while_revalidate").checked = !!s.cache_stale_while_revalidate;
      container.querySelector("#cache_sync_interval_seconds").value = s.cache_sync_interval_seconds ?? 300;
      container.querySelector("#cache_prewarm_interval_s").value = s.cache_prewarm_interval_s ?? 1800;
      container.querySelector("#cache_prewarm_concurrency").value = s.cache_prewarm_concurrency ?? 5;
      container.querySelector("#cache_disk_path").value = s.cache_disk_path ?? "cache/endpoints.json";
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.cache_load_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  async function loadStats() {
    try {
      const stats = await api.getCacheStats();
      renderCacheStats(statsBox, stats);
    } catch (err) {
      statsBox.innerHTML = `<div class="alert error">${t("settings.cache_stats_err").replace("{msg}", esc(err.message))}</div>`;
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
      msg.innerHTML = `<div class="alert error">${t("settings.cache_read_err").replace("{msg}", esc(err.message))}</div>`;
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
      cache_prewarm_interval_s: parseFloat(container.querySelector("#cache_prewarm_interval_s").value),
      cache_prewarm_concurrency: parseInt(container.querySelector("#cache_prewarm_concurrency").value, 10),
      cache_disk_path: container.querySelector("#cache_disk_path").value.trim(),
    };
    try {
      await api.updateBackendSettings(payload);
      msg.innerHTML = `<div class="alert success">${t("settings.cache_saved")}</div>`;
      await loadStats();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  refreshBtn.addEventListener("click", loadStats);

  invalidateBtn.addEventListener("click", async () => {
    if (!confirm(t("settings.cache_clear_confirm"))) return;
    try {
      await api.invalidateCache();
      msg.innerHTML = `<div class="alert success">${t("settings.cache_cleared")}</div>`;
      await loadStats();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

async function initBackendSection(container) {
  const backendMsg = container.querySelector("#backend-msg");
  const passwordHint = container.querySelector("#password-hint");

  // Set element texts
  const icHintP = container.querySelector("#ic-hint-p");
  if (icHintP) icHintP.innerHTML = t("settings.ic_hint");
  const pwInput = container.querySelector("#password");
  if (pwInput) pwInput.placeholder = t("settings.ic_pw_placeholder");
  const apiErsOpt = container.querySelector("#ic-api-ers-opt");
  if (apiErsOpt) apiErsOpt.textContent = t("settings.ic_api_ers");
  const apiOpenApiOpt = container.querySelector("#ic-api-openapi-opt");
  if (apiOpenApiOpt) apiOpenApiOpt.textContent = t("settings.ic_api_openapi");
  const verifyTlsLbl = container.querySelector("#ic-verify-tls-lbl");
  if (verifyTlsLbl) verifyTlsLbl.textContent = t("settings.ic_verify_tls");
  const verifyTlsHint = container.querySelector("#ic-verify-tls-hint");
  if (verifyTlsHint) verifyTlsHint.textContent = t("settings.ic_verify_tls_hint");
  const timeoutLbl = container.querySelector("#ic-timeout-lbl");
  if (timeoutLbl) timeoutLbl.textContent = t("settings.ic_timeout");
  const coaPsnLbl = container.querySelector("#ic-coa-psn-lbl");
  if (coaPsnLbl) coaPsnLbl.textContent = t("settings.ic_coa_psn");
  const coaPsnInput = container.querySelector("#coa_psn_name");
  if (coaPsnInput) coaPsnInput.placeholder = t("settings.ic_coa_psn_ph");
  const coaReauth1 = container.querySelector("#ic-coa-reauth-1-opt");
  if (coaReauth1) coaReauth1.textContent = t("settings.ic_coa_reauth_1");
  const coaDcHint = container.querySelector("#ic-coa-dc-hint");
  if (coaDcHint) coaDcHint.innerHTML = t("settings.ic_coa_dc_hint");
  const btnSave = container.querySelector("#ic-btn-save");
  if (btnSave) btnSave.textContent = t("settings.ic_btn_save");
  const btnTest = container.querySelector("#test-conn-btn");
  if (btnTest) { btnTest.textContent = t("settings.ic_btn_test"); btnTest.title = t("settings.ic_btn_test_title"); }

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
      ? t("settings.ic_pw_keep")
      : t("settings.ic_pw_empty");
  } catch (err) {
    backendMsg.innerHTML = `<div class="alert error">${t("settings.ic_load_err").replace("{msg}", esc(err.message))}</div>`;
  }

  container.querySelector("#test-conn-btn").addEventListener("click", async () => {
    backendMsg.innerHTML = `<div class="alert info">${t("settings.ic_testing")}</div>`;
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
      backendMsg.innerHTML = `<div class="alert error">${t("settings.ic_test_failed").replace("{msg}", esc(err.message))}</div>`;
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
      backendMsg.innerHTML = `<div class="alert success">${t("settings.ic_saved")}</div>`;
      container.querySelector("#password").value = "";
      passwordHint.textContent = s.ise_password_set
        ? t("settings.ic_pw_keep")
        : t("settings.ic_pw_empty");
    } catch (err) {
      backendMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

async function initPurgeProtectSection(container) {
  // Copy-knapper i vejledning-card'et: lægger den specificerede streng på
  // udklipsholderen så admin hurtigt kan paste ind i ISE-formularen.
  const msg = container.querySelector("#purge-protect-msg");
  container.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
        if (msg) msg.innerHTML = `<span style="color:#166534;">${t("settings.purge_copied").replace("{text}", `<code>${esc(text)}</code>`)}</span>`;
        const original = btn.textContent;
        btn.textContent = t("settings.purge_copy_ok");
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (err) {
        if (msg) msg.innerHTML = `<span style="color:#b91c1c;">${t("settings.purge_copy_err").replace("{msg}", esc(err.message))}</span>`;
      }
    });
  });
}

async function initRolesSection(container) {
  const tbody = container.querySelector("#roles-tbody");
  const msg = container.querySelector("#roles-msg");
  const form = container.querySelector("#role-create-form");
  const state = { roles: [], onChange: null, reload: null };

  // Set element texts
  const rolesCardH3 = container.querySelector("#roles-card-h3");
  if (rolesCardH3) rolesCardH3.textContent = t("settings.roles_card");
  const rolesColName = container.querySelector("#roles-col-name");
  if (rolesColName) rolesColName.textContent = t("settings.roles_col_name");
  const rolesColDesc = container.querySelector("#roles-col-desc");
  if (rolesColDesc) rolesColDesc.textContent = t("settings.roles_col_desc");
  const rolesColCreatedBy = container.querySelector("#roles-col-created-by");
  if (rolesColCreatedBy) rolesColCreatedBy.textContent = t("settings.roles_col_created_by");
  const rolesColCreated = container.querySelector("#roles-col-created");
  if (rolesColCreated) rolesColCreated.textContent = t("settings.roles_col_created");
  const rolesColAction = container.querySelector("#roles-col-action");
  if (rolesColAction) rolesColAction.textContent = t("settings.roles_col_action");
  const rolesNameInput = container.querySelector("#new-role-name");
  if (rolesNameInput) rolesNameInput.placeholder = t("settings.roles_name_ph");
  const rolesDescInput = container.querySelector("#new-role-desc");
  if (rolesDescInput) rolesDescInput.placeholder = t("settings.roles_desc_ph");
  const rolesBtnCreate = container.querySelector("#roles-btn-create");
  if (rolesBtnCreate) rolesBtnCreate.textContent = t("settings.roles_btn_create");

  async function reload() {
    msg.innerHTML = "";
    try {
      const data = await api.listEndpointRoles();
      state.roles = data.roles || [];
      if (state.roles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="hint" style="text-align:center;padding:1rem;">${t("settings.roles_empty")}</td></tr>`;
      } else {
        tbody.innerHTML = state.roles
          .map(
            (r) => `
              <tr data-role-name="${esc(r.name)}">
                <td><b>${esc(r.name)}</b></td>
                <td>${esc(r.description || "")}</td>
                <td class="mono" style="font-size:0.78rem;">${esc(r.created_by || "")}</td>
                <td class="mono" style="font-size:0.78rem;">${esc((r.created_at || "").slice(0, 10))}</td>
                <td><button class="small danger role-del">${t("btn.delete")}</button></td>
              </tr>`,
          )
          .join("");
      }
      if (state.onChange) await state.onChange();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.roles_load_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  tbody.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("role-del")) return;
    const row = e.target.closest("tr");
    const name = row.dataset.roleName;
    if (!confirm(t("settings.roles_del_confirm").replace("{name}", name))) return;
    try {
      await api.deleteEndpointRole(name);
      msg.innerHTML = `<div class="alert success">${t("settings.roles_deleted").replace("{name}", esc(name))}</div>`;
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
      msg.innerHTML = `<div class="alert success">${t("settings.roles_created")}</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  // load error message
  // Note: roles_load_err handled in reload() catch block
  await reload();
  state.reload = reload;
  return state;
}

async function initUsersSection(container, currentUser, rolesState) {
  const tbody = container.querySelector("#users-tbody");
  const msg = container.querySelector("#users-msg");
  let _isTacacs = false;

  // Set static element texts
  const usersColRoleLbl = container.querySelector("#users-col-role");
  if (usersColRoleLbl) usersColRoleLbl.textContent = t("settings.users_col_role");
  const usersColTypeLbl = container.querySelector("#users-col-type");
  if (usersColTypeLbl) usersColTypeLbl.textContent = t("settings.users_col_type");
  const usersColRolesLbl = container.querySelector("#users-col-roles");
  if (usersColRolesLbl) usersColRolesLbl.textContent = t("col.roles");
  const usersColTemplatesLbl = container.querySelector("#users-col-templates");
  if (usersColTemplatesLbl) usersColTemplatesLbl.textContent = t("settings.subtab_templates");
  const usersColLastLoginLbl = container.querySelector("#users-col-last-login");
  if (usersColLastLoginLbl) usersColLastLoginLbl.textContent = t("settings.users_col_last_login");
  const usersColCreatedLbl = container.querySelector("#users-col-created");
  if (usersColCreatedLbl) usersColCreatedLbl.textContent = t("settings.users_col_created");
  const usersColActionsLbl = container.querySelector("#users-col-actions");
  if (usersColActionsLbl) usersColActionsLbl.textContent = t("settings.users_col_actions");
  const usersNameInput = container.querySelector("#new-username");
  if (usersNameInput) usersNameInput.placeholder = t("settings.users_name_ph");
  const usersPwInput = container.querySelector("#new-password");
  if (usersPwInput) usersPwInput.placeholder = t("settings.users_pw_ph");
  const usersBtnCreate = container.querySelector("#users-btn-create");
  if (usersBtnCreate) usersBtnCreate.textContent = t("settings.users_btn_create");
  // Role option texts
  const newRoleEditorPsk = container.querySelector("#new-role-editor-psk");
  if (newRoleEditorPsk) newRoleEditorPsk.textContent = `editor-psk (PSK-${t("btn.edit").toLowerCase()})`;
  const newRoleRegistrant = container.querySelector("#new-role-registrant");
  if (newRoleRegistrant) newRoleRegistrant.textContent = `registrant (${t("settings.users_type_user").toLowerCase()} — ${t("btn.create").toLowerCase()})`;
  const newRoleRegistrantTpl = container.querySelector("#new-role-registrant-tpl");
  if (newRoleRegistrantTpl) newRoleRegistrantTpl.textContent = `registrant_templet (${t("settings.subtab_templates").toLowerCase()} + MAC)`;

  // Hent auth-mode og opdater kosmetiske labels
  try {
    const authCfg = await api.getPortalAuthConfig();
    _isTacacs = authCfg.auth_mode === "tacacs";
    const titleEl = container.querySelector("#users-section-title");
    const hintEl = container.querySelector("#users-section-hint");
    const tacacsHintEl = container.querySelector("#users-tacacs-hint");
    const colHeader = container.querySelector("#users-col-username");
    const pwInput = container.querySelector("#new-password");
    if (hintEl) hintEl.textContent = t("settings.users_section_hint");
    if (tacacsHintEl) tacacsHintEl.textContent = t("settings.users_tacacs_hint");
    if (_isTacacs) {
      if (titleEl) titleEl.innerHTML = `${t("settings.subtab_users")} — <span style='font-size:0.85em;font-weight:normal;color:var(--text-muted);'>${t("settings.users_type_operator")} mode (TACACS+)</span>`;
      if (tacacsHintEl) tacacsHintEl.style.display = "";
      if (colHeader) colHeader.textContent = t("settings.users_op_col");
      if (pwInput) {
        pwInput.required = false;
        pwInput.placeholder = t("settings.users_tacacs_pw_ph");
        pwInput.removeAttribute("minlength");
      }
    } else {
      if (titleEl) titleEl.textContent = t("settings.subtab_users");
      if (colHeader) colHeader.textContent = t("settings.users_col_username");
    }
  } catch { /* non-critical */ }

  let allTemplates = [];

  function renderEndpointRoleCell(user) {
    const catalog = (rolesState ? rolesState.roles : []).filter((r) => r.name.toLowerCase() !== "admin");
    const assigned = new Set(user.assigned_endpoint_roles || []);
    if (catalog.length === 0) {
      return `<span class="hint">${t("settings.users_no_roles")}</span>`;
    }
    const checks = catalog
      .map((r) => {
        const checked = assigned.has(r.name) ? " checked" : "";
        const isOwn = r.name.toLowerCase() === user.username.toLowerCase();
        return `<label class="role-chip${isOwn ? " own-role-chip" : ""}"><input type="checkbox" class="user-role-chip" value="${esc(r.name)}"${checked}/> ${esc(r.name)}</label>`;
      })
      .join("");
    return `<div class="role-chips">${checks}</div>`;
  }

  function visibleTemplatesForRole(role) {
    if (role === "admin") return null; // null = alle
    return allTemplates.filter((t) => {
      const vt = t.visible_to || [];
      return vt.length === 0 || vt.includes(role);
    });
  }

  function renderTemplateCell(user) {
    // viewer kan ikke oprette endpoints — skabeloner ikke relevante
    if (user.role === "viewer") return `<span style="color:var(--text-secondary,#94a3b8);">—</span>`;

    if (!allTemplates.length) return `<span class="hint" style="color:var(--text-secondary,#94a3b8);">${t("settings.users_no_tpls")}</span>`;

    if (user.role === "admin") {
      return `<span class="hint" style="font-style:italic;">${t("settings.users_all_tpls").replace("{n}", allTemplates.length)}</span>`;
    }

    if (user.role === "registrant_templet") {
      // Redigerbare checkboxes — admin tildeler eksplicit
      const assigned = new Set(user.assigned_templates || []);
      const checks = allTemplates
        .map((t) => {
          const checked = assigned.has(t.id) ? " checked" : "";
          return `<label class="role-chip"><input type="checkbox" class="user-tpl-chip" value="${esc(t.id)}"${checked}/> ${esc(t.name)}</label>`;
        })
        .join("");
      return `<div class="role-chips">${checks}</div>`;
    }

    // Alle andre roller: vis hvilke skabeloner de kan se via visible_to
    const visible = visibleTemplatesForRole(user.role);
    if (!visible.length) {
      return `<span class="hint" style="color:var(--text-secondary,#94a3b8);">${t("settings.users_no_access")}</span>`;
    }
    const tags = visible
      .map((t) => `<span class="role-chip" style="background:var(--bg-secondary,#f1f5f9);border:1px solid var(--border,#e2e8f0);padding:1px 7px;border-radius:4px;font-size:0.78rem;">${esc(t.name)}</span>`)
      .join("");
    return `<div style="display:flex;flex-wrap:wrap;gap:0.25rem;">${tags}</div>`;
  }

  async function reload() {
    msg.innerHTML = "";
    try {
      const tplResp = await api.listTemplates().catch(() => ({ templates: [] }));
      allTemplates = tplResp.templates || [];
    } catch { /* ignorer */ }
    try {
      const users = await api.listUsers();
      tbody.innerHTML = users
        .map((u) => {
          const isSelf = u.id === currentUser.id;
          const isPortalAdmin = u.role === "admin";
          const adminCell = `<span class="hint" style="font-style:italic;">${t("settings.users_admin_roles")}</span>`;
          const isOperator = u.user_type === "operator";
          return `
            <tr data-user-id="${esc(u.id)}" data-username="${esc(u.username)}">
              <td>${esc(u.username)}</td>
              <td>
                <select class="user-role-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen rolle her'" : ""}>
                  ${["admin", "editor", "editor-psk", "viewer", "registrant", "registrant_templet"]
                    .map((r) => `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`)
                    .join("")}
                </select>
              </td>
              <td>
                <select class="user-type-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen type her'" : ""}>
                  <option value="user"${!isOperator ? " selected" : ""}>${t("settings.users_type_user")}</option>
                  <option value="operator"${isOperator ? " selected" : ""}>${t("settings.users_type_operator")}</option>
                </select>
              </td>
              <td>${isPortalAdmin ? adminCell : renderEndpointRoleCell(u)}</td>
              <td>${renderTemplateCell(u)}</td>
              <td class="mono" style="font-size:0.78rem;">${esc(u.last_login || "—")}</td>
              <td class="mono" style="font-size:0.78rem;">${esc((u.created_at || "").slice(0, 10))}</td>
              <td>
                <button class="small user-copy">${t("settings.users_btn_copy")}</button>
                <button class="small user-reset-pw" ${isSelf ? "disabled" : ""}>${t("settings.users_btn_reset_pw")}</button>
                <button class="small danger user-del" ${isSelf ? "disabled" : ""}>${t("btn.delete")}</button>
              </td>
            </tr>`;
        })
        .join("");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.users_load_err").replace("{msg}", esc(err.message))}</div>`;
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
        msg.innerHTML = `<div class="alert success">${t("settings.users_role_updated")}</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-type-select")) {
      const newType = e.target.value;
      const label = newType === "operator" ? t("settings.users_type_operator") : t("settings.users_type_user");
      try {
        await api.updateUser(id, { user_type: newType });
        msg.innerHTML = `<div class="alert success">${t("settings.users_type_updated").replace("{user}", esc(row.dataset.username)).replace("{type}", `<strong>${label}</strong>`)}</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-role-chip")) {
      const checks = row.querySelectorAll(".user-role-chip");
      const selected = Array.from(checks).filter((c) => c.checked).map((c) => c.value);
      try {
        await api.setUserEndpointRoles(id, selected);
        msg.innerHTML = `<div class="alert success">${t("settings.users_roles_updated").replace("{user}", esc(row.dataset.username))}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-tpl-chip")) {
      const checks = row.querySelectorAll(".user-tpl-chip");
      const selected = Array.from(checks).filter((c) => c.checked).map((c) => c.value);
      try {
        await api.setUserTemplates(id, selected);
        msg.innerHTML = `<div class="alert success">${t("settings.users_tpls_updated").replace("{user}", esc(row.dataset.username))}</div>`;
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
      if (!confirm(t("settings.users_del_confirm").replace("{user}", username))) return;
      try {
        await api.deleteUser(id);
        msg.innerHTML = `<div class="alert success">${t("settings.users_deleted")}</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    }
    if (e.target.classList.contains("user-reset-pw")) {
      const pw = prompt(t("settings.users_pw_prompt").replace("{user}", username));
      if (!pw) return;
      if (pw.length < 8) {
        msg.innerHTML = `<div class="alert error">${t("settings.users_pw_min8")}</div>`;
        return;
      }
      try {
        await api.updateUser(id, { password: pw });
        msg.innerHTML = `<div class="alert success">${t("settings.users_pw_updated").replace("{user}", esc(username))}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    }

    if (e.target.classList.contains("user-copy")) {
      // Fjern evt. eksisterende copy-række
      tbody.querySelector(".user-copy-row")?.remove();

      const users = await api.listUsers().catch(() => []);
      const srcUser = users.find((u) => u.id === id);
      if (!srcUser) return;

      const suggestedName = srcUser.username.replace(/_copy(\d*)$/, "") + "_copy";
      const pwRequired = !_isTacacs;
      const pwHint = _isTacacs ? t("settings.users_tacacs_pw_ph") : t("settings.users_pw_ph");

      const copyRow = document.createElement("tr");
      copyRow.className = "user-copy-row";
      copyRow.innerHTML = `
        <td colspan="7" style="padding:0.6rem 0.75rem;background:var(--bg-alt,#f8fafc);border-left:3px solid var(--accent,#3b82f6);border-top:1px dashed #e5e7eb;">
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
            <span style="font-size:0.82rem;color:var(--text-secondary,#64748b);white-space:nowrap;">
              ${t("settings.users_copy_of").replace("{user}", `<strong>${esc(srcUser.username)}</strong>`).replace("{role}", esc(srcUser.role))}
            </span>
            <input type="text" class="copy-username" value="${esc(suggestedName)}"
              placeholder="nyt brugernavn" minlength="3" maxlength="64"
              style="width:16rem;" />
            <input type="password" class="copy-password"
              placeholder="password (${pwHint})"
              ${pwRequired ? 'minlength="8"' : ""}
              style="width:16rem;" />
            <button type="button" class="copy-confirm">${t("settings.users_copy_btn")}</button>
            <button type="button" class="copy-cancel secondary">${t("btn.cancel")}</button>
            <span class="copy-msg" style="font-size:0.82rem;"></span>
          </div>
        </td>`;

      row.after(copyRow);
      copyRow.querySelector(".copy-username").focus();

      copyRow.querySelector(".copy-cancel").addEventListener("click", () => copyRow.remove());

      copyRow.querySelector(".copy-confirm").addEventListener("click", async () => {
        const copyMsg = copyRow.querySelector(".copy-msg");
        const newUsername = copyRow.querySelector(".copy-username").value.trim();
        const newPassword = copyRow.querySelector(".copy-password").value;

        if (!newUsername || newUsername.length < 3) {
          copyMsg.innerHTML = `<span style="color:var(--error,#ef4444);">${t("settings.users_copy_min3")}</span>`;
          return;
        }
        if (pwRequired && newPassword.length < 8) {
          copyMsg.innerHTML = `<span style="color:var(--error,#ef4444);">${t("settings.users_pw_min8")}</span>`;
          return;
        }

        copyMsg.textContent = t("settings.users_creating");
        try {
          const created = await api.createUser({
            username: newUsername,
            password: newPassword,
            role: srcUser.role,
          });
          // Kopiér endpoint-roller og skabeloner
          if (srcUser.assigned_endpoint_roles?.length) {
            await api.setUserEndpointRoles(created.id, srcUser.assigned_endpoint_roles).catch(() => {});
          }
          if (srcUser.assigned_templates?.length) {
            await api.setUserTemplates(created.id, srcUser.assigned_templates).catch(() => {});
          }
          copyRow.remove();
          msg.innerHTML = `<div class="alert success">${t("settings.users_copy_done").replace("{user}", `<strong>${esc(newUsername)}</strong>`).replace("{role}", esc(srcUser.role))}</div>`;
          if (rolesState && typeof rolesState.reload === "function") await rolesState.reload();
          await reload();
        } catch (err) {
          copyMsg.innerHTML = `<span style="color:var(--error,#ef4444);">${esc(err.message)}</span>`;
        }
      });
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
      msg.innerHTML = `<div class="alert success">${t("settings.users_created")}</div>`;
      // 3.8.2: backend opretter automatisk en System adm-rolle med navn =
      // username (3.8.0-feature). Refresh rolle-kataloget så admin straks
      // kan tilvælge rollen til den nye bruger uden side-reload.
      if (rolesState && typeof rolesState.reload === "function") {
        await rolesState.reload();
      }
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
      msg.innerHTML = `<div class="alert error">${t("prefs.pw_err_match")}</div>`;
      return;
    }
    try {
      await api.changePassword(current, newPw);
      container.querySelector("#pw-form").reset();
      msg.innerHTML = `<div class="alert success">${t("prefs.pw_success")}</div>`;
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
        csvTplMsg.innerHTML = `<div class="alert error">${t("csv_tpl.err_no_cols")}</div>`;
        return;
      }
      const extended = extendTemplateWithPortalColumns(columns);
      setCsvTemplate(extended);
      refreshTplPreview();
      const added = extended.length - columns.length;
      const addedNote = added ? t("csv_tpl.portal_added").replace("{n}", added) : "";
      csvTplMsg.innerHTML = `<div class="alert success">${t("csv_tpl.imported").replace("{n}", extended.length).replace("{extra}", addedNote)}</div>`;
    } catch (err) {
      csvTplMsg.innerHTML = `<div class="alert error">${t("csv_tpl.err_read").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      // Nulstil input så samme fil kan vælges igen efter fejl/reset.
      e.target.value = "";
    }
  });

  container.querySelector("#csv-tpl-reset").addEventListener("click", () => {
    resetCsvTemplate();
    csvTplFile.value = "";
    refreshTplPreview();
    csvTplMsg.innerHTML = `<div class="alert success">${t("csv_tpl.reset_done").replace("{n}", getCsvTemplate().length)}</div>`;
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
    frontendMsg.innerHTML = `<div class="alert success">${t("prefs.success")}</div>`;
  });
}

async function initPskPolicySection(container) {
  const msg = container.querySelector("#psk-policy-msg");
  const form = container.querySelector("#psk-policy-form");
  const genResult = container.querySelector("#psk-gen-result");
  if (!form) return;

  // Set element texts
  const pskCardH3 = container.querySelector("#psk-card-h3");
  if (pskCardH3) pskCardH3.textContent = t("settings.psk_card");
  const pskModeTypeLbl = container.querySelector("#psk-mode-type-lbl");
  if (pskModeTypeLbl) pskModeTypeLbl.textContent = t("settings.psk_mode_type");
  const pskShowKeyLbl = container.querySelector("#psk-show-key-lbl");
  if (pskShowKeyLbl) pskShowKeyLbl.textContent = t("settings.psk_show_key");
  const pskMinLengthLbl = container.querySelector("#psk-min-length-lbl");
  if (pskMinLengthLbl) pskMinLengthLbl.textContent = t("settings.psk_min_length");
  const pskReqUpperLbl = container.querySelector("#psk-req-upper-lbl");
  if (pskReqUpperLbl) pskReqUpperLbl.textContent = t("settings.psk_req_upper");
  const pskReqNumberLbl = container.querySelector("#psk-req-number-lbl");
  if (pskReqNumberLbl) pskReqNumberLbl.textContent = t("settings.psk_req_number");
  const pskReqSpecialLbl = container.querySelector("#psk-req-special-lbl");
  if (pskReqSpecialLbl) pskReqSpecialLbl.textContent = t("settings.psk_req_special");
  const pskBtnSave = container.querySelector("#psk-btn-save");
  if (pskBtnSave) pskBtnSave.textContent = t("settings.psk_btn_save");
  const pskTestGen = container.querySelector("#psk-test-gen");
  if (pskTestGen) pskTestGen.textContent = t("settings.psk_btn_test");

  function applyPolicy(p) {
    const pskType = (p.psk_type || "MPSK").toUpperCase();
    const mpskRb = container.querySelector("#psk-type-mpsk");
    const ipskRb = container.querySelector("#psk-type-ipsk");
    if (mpskRb) mpskRb.checked = pskType !== "IPSK";
    if (ipskRb) ipskRb.checked = pskType === "IPSK";
    container.querySelector("#psk-show-key").checked = !!p.show_key_in_table;
    container.querySelector("#psk-min-length").value = p.min_length ?? 8;
    container.querySelector("#psk-req-upper").checked = !!p.require_uppercase;
    container.querySelector("#psk-req-number").checked = !!p.require_numbers;
    container.querySelector("#psk-req-special").checked = !!p.require_special;
  }

  try {
    const policy = await api.getPskPolicy();
    applyPolicy(policy);
  } catch (err) {
    msg.innerHTML = `<div class="alert error">${t("settings.psk_load_err").replace("{msg}", esc(err.message))}</div>`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const pskTypeEl = container.querySelector("input[name='psk-type']:checked");
    const payload = {
      psk_type: pskTypeEl ? pskTypeEl.value : "MPSK",
      show_key_in_table: container.querySelector("#psk-show-key").checked,
      min_length: parseInt(container.querySelector("#psk-min-length").value, 10),
      require_uppercase: container.querySelector("#psk-req-upper").checked,
      require_numbers: container.querySelector("#psk-req-number").checked,
      require_special: container.querySelector("#psk-req-special").checked,
    };
    try {
      const saved = await api.updatePskPolicy(payload);
      applyPolicy(saved);
      msg.innerHTML = `<div class="alert success">${t("settings.psk_saved")}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.psk_gen_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#psk-test-gen").addEventListener("click", async () => {
    genResult.textContent = t("settings.psk_generating");
    try {
      const { key } = await api.generatePskKey();
      genResult.textContent = t("settings.psk_example").replace("{key}", key);
    } catch (err) {
      genResult.textContent = t("settings.psk_gen_err").replace("{msg}", err.message);
    }
  });
}

/* Settings tab + sub-tab navigation.
 * Hoved-tabs: data-tab på .settings-tab knapper.
 * Sub-tabs: .settings-subtab-nav[data-for-tab] med .settings-subtab[data-subtab] knapper.
 * Kort med data-subtab vises kun når det matchende sub-tab er aktivt.
 * Kort uden data-subtab vises altid når hoved-tab er aktiv. */
const SETTINGS_TAB_KEY = "ise_portal_settings_tab";
function initSettingsTabs(container, isAdmin, isPskEditorUser = false) {
  const tabs = container.querySelectorAll(".settings-tab");
  if (!tabs.length) return;

  const validTabs = Array.from(tabs).map(t => t.dataset.tab);
  const defaultTab = isAdmin ? "ise-connection" : "portal-config";
  let stored = null;
  try { stored = localStorage.getItem(SETTINGS_TAB_KEY); } catch { /* ignore */ }
  const initial = validTabs.includes(stored) ? stored : defaultTab;

  // Aktive sub-tab pr. hoved-tab (initialiseres nedenfor)
  const activeSubTab = {};

  function activateTab(tabId) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    try { localStorage.setItem(SETTINGS_TAB_KEY, tabId); } catch { /* ignore */ }

    // Vis/skjul sub-nav barer
    container.querySelectorAll(".settings-subtab-nav").forEach(nav => {
      nav.style.display = nav.dataset.forTab === tabId ? "" : "none";
    });

    // Vis/skjul kort
    container.querySelectorAll(".settings-panels .card[data-tab]").forEach(c => {
      if (c.dataset.tab !== tabId) { c.style.display = "none"; return; }
      const sub = c.dataset.subtab;
      c.style.display = (!sub || !activeSubTab[tabId] || sub === activeSubTab[tabId]) ? "" : "none";
    });
  }

  // Initialiser sub-tab navigationerne
  container.querySelectorAll(".settings-subtab-nav").forEach(nav => {
    const forTab = nav.dataset.forTab;
    const btns = nav.querySelectorAll(".settings-subtab");
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        activeSubTab[forTab] = btn.dataset.subtab;
        btns.forEach(b => b.classList.toggle("active", b === btn));
        activateTab(forTab);
      });
    });
    if (btns.length) {
      activeSubTab[forTab] = btns[0].dataset.subtab;
      btns[0].classList.add("active");
    }
  });

  tabs.forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));
  activateTab(initial);
}

async function initTemplatesSection(container) {
  const msg        = container.querySelector("#tpl-msg");
  const listDiv    = container.querySelector("#tpl-list");
  const formWrap   = container.querySelector("#tpl-form-wrap");
  const formTitle  = container.querySelector("#tpl-form-title");
  const editIdInp  = container.querySelector("#tpl-edit-id");
  const nameInp    = container.querySelector("#tpl-name");
  const descFieldInp = container.querySelector("#tpl-desc-field");
  const groupSel   = container.querySelector("#tpl-group");
  const epDescInp  = container.querySelector("#tpl-ep-desc");
  const attrsWrap  = container.querySelector("#tpl-attrs-wrap");
  const staticCb   = container.querySelector("#tpl-static-group");
  const newBtn     = container.querySelector("#tpl-new-btn");
  const saveBtn    = container.querySelector("#tpl-save-btn");
  const cancelBtn  = container.querySelector("#tpl-cancel-btn");

  const attrLabels = {
    Type: "Type", Owner: t("settings.tpl_owner"), Lokation: t("settings.tpl_lokation"),
    AuthzVlan: "Authz VLAN", AuthzACL: "Authz ACL", PlatformType: "Platform",
  };

  // Set element texts
  const tplCardH3 = container.querySelector("#tpl-card-h3");
  if (tplCardH3) tplCardH3.textContent = t("settings.tpl_card");
  const tplNewBtn = container.querySelector("#tpl-new-btn");
  if (tplNewBtn) tplNewBtn.textContent = t("settings.tpl_btn_new");
  const tplNameLbl = container.querySelector("#tpl-name-lbl");
  if (tplNameLbl) tplNameLbl.textContent = t("settings.tpl_name_lbl");
  const tplDescLbl = container.querySelector("#tpl-desc-lbl");
  if (tplDescLbl) tplDescLbl.textContent = t("settings.tpl_desc_lbl");
  const tplGroupLbl = container.querySelector("#tpl-group-lbl");
  if (tplGroupLbl) tplGroupLbl.textContent = t("settings.tpl_group_lbl");
  const tplGroupNoneOpt = container.querySelector("#tpl-group-none-opt");
  if (tplGroupNoneOpt) tplGroupNoneOpt.textContent = t("settings.tpl_group_none");
  const tplEpDescLbl = container.querySelector("#tpl-ep-desc-lbl");
  if (tplEpDescLbl) tplEpDescLbl.textContent = t("settings.tpl_ep_desc_lbl");
  const tplVisibleLbl = container.querySelector("#tpl-visible-lbl");
  if (tplVisibleLbl) tplVisibleLbl.textContent = t("settings.tpl_visible_lbl");
  const tplSaveBtn = container.querySelector("#tpl-save-btn");
  if (tplSaveBtn) tplSaveBtn.textContent = t("settings.tpl_btn_save");
  const tplCancelBtn = container.querySelector("#tpl-cancel-btn");
  if (tplCancelBtn) tplCancelBtn.textContent = t("settings.tpl_btn_cancel");

  // Hent grupper + custom-attr-værdier til form-dropdowns
  let groups = [];
  let attrMap = {};
  try {
    const [groupsResp, caResp, daclsResp] = await Promise.all([
      api.listGroups().catch(() => []),
      api.listCustomAttributes().catch(() => ({ attributes: [] })),
      api.listDacls().catch(() => []),
    ]);
    groups = groupsResp || [];
    for (const a of (caResp.attributes || [])) attrMap[a.name] = a.values || [];
    attrMap.AuthzACL = (daclsResp || []).map((d) => d.name).filter(Boolean).sort();
  } catch { /* ignorer */ }

  groupSel.innerHTML =
    `<option value="">${t("settings.tpl_group_none")}</option>` +
    groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");

  attrsWrap.innerHTML = Object.entries(attrLabels).map(([name, label]) => {
    const opts = (attrMap[name] || [])
      .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    return `
      <div class="field">
        <label for="tpl-ca-${name}">${label}</label>
        <select id="tpl-ca-${name}" style="max-width:320px;">
          <option value="">${t("settings.tpl_attr_select")}</option>${opts}
        </select>
      </div>`;
  }).join("");

  function showMsg(html) { msg.innerHTML = html; }
  function clearMsg() { msg.innerHTML = ""; }

  function getVisibleToCheckboxes() {
    return container.querySelectorAll(".tpl-visible-to");
  }

  function resetForm() {
    editIdInp.value = "";
    nameInp.value = "";
    descFieldInp.value = "";
    groupSel.value = "";
    epDescInp.value = "";
    staticCb.checked = false;
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#tpl-ca-${name}`);
      if (sel) sel.value = "";
    }
    getVisibleToCheckboxes().forEach((cb) => { cb.checked = false; });
    formWrap.classList.add("hidden");
    formTitle.textContent = t("settings.tpl_form_new");
  }

  function fillForm(tpl) {
    editIdInp.value = tpl.id;
    nameInp.value = tpl.name;
    descFieldInp.value = tpl.description || "";
    const f = tpl.fields || {};
    groupSel.value = f.group_id || "";
    epDescInp.value = f.description || "";
    staticCb.checked = !!f.static_group_assignment;
    const ca = f.custom_attributes || {};
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#tpl-ca-${name}`);
      if (sel) sel.value = ca[name] || "";
    }
    const visibleTo = tpl.visible_to || [];
    getVisibleToCheckboxes().forEach((cb) => {
      cb.checked = visibleTo.includes(cb.value);
    });
    formTitle.textContent = t("settings.tpl_form_edit").replace("{name}", esc(tpl.name));
    formWrap.classList.remove("hidden");
    nameInp.focus();
  }

  function buildPayload() {
    const ca = {};
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#tpl-ca-${name}`);
      const v = sel ? sel.value.trim() : "";
      if (v) ca[name] = v;
    }
    const visibleTo = Array.from(getVisibleToCheckboxes())
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    return {
      name: nameInp.value.trim(),
      description: descFieldInp.value.trim(),
      fields: {
        group_id: groupSel.value,
        description: epDescInp.value.trim(),
        static_group_assignment: staticCb.checked || null,
        custom_attributes: ca,
      },
      visible_to: visibleTo,
    };
  }

  async function loadAndRender() {
    try {
      const resp = await api.listTemplates();
      const templates = resp.templates || [];
      if (!templates.length) {
        listDiv.innerHTML = `<p class="hint">${t("settings.tpl_empty")}</p>`;
        return;
      }
      listDiv.innerHTML = `
        <table class="data-table" style="width:100%;">
          <thead><tr>
            <th>${t("settings.tpl_col_name")}</th><th>${t("settings.tpl_col_desc")}</th><th>${t("settings.tpl_col_group")}</th><th>${t("settings.tpl_col_attrs")}</th><th>${t("settings.tpl_col_visible")}</th><th></th>
          </tr></thead>
          <tbody>
          ${templates.map((tpl) => {
            const f = tpl.fields || {};
            const ca = f.custom_attributes || {};
            const caStr = Object.entries(ca).filter(([,v]) => v)
              .map(([k,v]) => `${k}=${v}`).join(", ") || "—";
            const grpName = groups.find((g) => g.id === f.group_id)?.name || f.group_id || "—";
            const vt = (tpl.visible_to || []);
            const vtStr = vt.length ? vt.join(", ") : t("settings.tpl_all_visible");
            return `<tr data-tpl-id="${esc(tpl.id)}">
              <td><b>${esc(tpl.name)}</b></td>
              <td>${esc(tpl.description || "—")}</td>
              <td>${esc(grpName)}</td>
              <td style="font-size:0.82rem;color:var(--text-secondary,#64748b);">${esc(caStr)}</td>
              <td style="font-size:0.82rem;color:var(--text-secondary,#64748b);">${esc(vtStr)}</td>
              <td style="white-space:nowrap;">
                <button type="button" class="secondary tpl-edit-btn" data-id="${esc(tpl.id)}" style="padding:2px 10px;margin-right:4px;">${t("settings.tpl_btn_edit")}</button>
                <button type="button" class="danger tpl-del-btn" data-id="${esc(tpl.id)}" style="padding:2px 10px;">${t("settings.tpl_btn_del")}</button>
              </td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>`;

      listDiv.querySelectorAll(".tpl-edit-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tplItem = templates.find((tpl) => tpl.id === btn.dataset.id);
          if (tplItem) fillForm(tplItem);
          formWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
      listDiv.querySelectorAll(".tpl-del-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tplItem = templates.find((tpl) => tpl.id === btn.dataset.id);
          if (!tplItem) return;
          if (!confirm(t("settings.tpl_del_confirm").replace("{name}", tplItem.name))) return;
          try {
            await api.deleteTemplate(tplItem.id);
            showMsg(`<div class="alert success">${t("settings.tpl_deleted").replace("{name}", esc(tplItem.name))}</div>`);
            resetForm();
            await loadAndRender();
          } catch (err) {
            showMsg(`<div class="alert error">${t("settings.tpl_err").replace("{msg}", esc(err.message))}</div>`);
          }
        });
      });
    } catch (err) {
      listDiv.innerHTML = `<p class="hint" style="color:#e11d48;">${t("settings.tpl_load_err").replace("{msg}", esc(err.message))}</p>`;
    }
  }

  newBtn.addEventListener("click", () => {
    resetForm();
    formWrap.classList.remove("hidden");
    formTitle.textContent = t("settings.tpl_form_new");
    nameInp.focus();
  });
  cancelBtn.addEventListener("click", resetForm);

  saveBtn.addEventListener("click", async () => {
    clearMsg();
    const payload = buildPayload();
    if (!payload.name) {
      showMsg(`<div class="alert error">${t("settings.tpl_name_required")}</div>`);
      nameInp.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const id = editIdInp.value;
      if (id) {
        await api.updateTemplate(id, payload);
        showMsg(`<div class="alert success">${t("settings.tpl_updated").replace("{name}", esc(payload.name))}</div>`);
      } else {
        await api.createTemplate(payload);
        showMsg(`<div class="alert success">${t("settings.tpl_created").replace("{name}", esc(payload.name))}</div>`);
      }
      resetForm();
      await loadAndRender();
    } catch (err) {
      showMsg(`<div class="alert error">${t("settings.tpl_err").replace("{msg}", esc(err.message))}</div>`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  await loadAndRender();
}

function initSystemUpdateSection(container) {
  const fileInput    = container.querySelector("#update-file-input");
  const validateBtn  = container.querySelector("#update-validate-btn");
  const applyBtn     = container.querySelector("#update-apply-btn");
  const restartBtn   = container.querySelector("#update-restart-btn");
  const preview      = container.querySelector("#update-preview");
  const result       = container.querySelector("#update-result");
  const pkgInfo      = container.querySelector("#update-pkg-info");
  const fileListWrap = container.querySelector("#update-file-list-wrap");
  const fileListEl   = container.querySelector("#update-file-list");
  const fileCountEl  = container.querySelector("#update-file-count");
  const blockedWrap  = container.querySelector("#update-blocked-wrap");
  const blockedEl    = container.querySelector("#update-blocked-list");
  const msgEl        = container.querySelector("#update-msg");
  const resultMsg    = container.querySelector("#update-result-msg");

  if (!fileInput) return;

  // Set element texts
  const updateCardH3 = container.querySelector("#update-card-h3");
  if (updateCardH3) updateCardH3.textContent = t("settings.update_card");
  const updatePkgLbl = container.querySelector("#update-pkg-lbl");
  if (updatePkgLbl) updatePkgLbl.textContent = t("settings.update_pkg_lbl");
  if (validateBtn) validateBtn.textContent = t("settings.update_btn_validate");
  if (applyBtn) applyBtn.textContent = t("settings.update_btn_apply");
  const updateRestartH4 = container.querySelector("#update-restart-h4");
  if (updateRestartH4) updateRestartH4.textContent = t("settings.update_restart_h4");
  const updateRestartHint = container.querySelector("#update-restart-hint");
  if (updateRestartHint) updateRestartHint.textContent = t("settings.update_restart_hint");
  if (restartBtn) restartBtn.textContent = t("settings.update_btn_restart");
  const pkgInfoLbl = container.querySelector("#update-pkg-info-lbl");
  if (pkgInfoLbl) pkgInfoLbl.textContent = t("settings.update_pkg_info_lbl");
  const blockedLbl = container.querySelector("#update-blocked-lbl");
  if (blockedLbl) blockedLbl.textContent = t("settings.update_blocked_lbl");

  let validatedFile = null;

  fileInput.addEventListener("change", () => {
    const hasFile = !!fileInput.files.length;
    validateBtn.disabled = !hasFile;
    validatedFile = null;
    applyBtn.disabled = true;
    preview.classList.add("hidden");
    result.classList.add("hidden");
    msgEl.innerHTML = "";
  });

  validateBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    msgEl.innerHTML = `<div class="alert info">${t("settings.update_validating")}</div>`;
    validateBtn.disabled = true;
    try {
      const info = await api.validateUpdate(file);
      msgEl.innerHTML = "";
      preview.classList.remove("hidden");
      result.classList.add("hidden");

      // Pakke-info boks
      const statusIcon = info.ok ? "✅" : "❌";
      const errHtml = info.errors.length
        ? `<span style="color:#b91c1c;">Fejl: ${info.errors.map(e => esc(e)).join("; ")}</span>\n`
        : "";
      pkgInfo.textContent =
        `${statusIcon} Version: ${info.version} build ${info.build}\n` +
        `Filer: ${info.file_count}   Blokerede: ${info.blocked.length}\n` +
        errHtml;

      // Fil-liste
      if (info.files.length) {
        fileListEl.textContent = info.files.join("\n");
        const fileListLbl = container.querySelector("#update-file-list-lbl");
        if (fileListLbl) fileListLbl.textContent = t("settings.update_file_list_lbl").replace("{n}", info.file_count);
        fileListWrap.classList.remove("hidden");
      } else {
        fileListWrap.classList.add("hidden");
      }

      // Blokerede filer
      if (info.blocked.length) {
        blockedEl.textContent = info.blocked.join("\n");
        blockedWrap.classList.remove("hidden");
      } else {
        blockedWrap.classList.add("hidden");
      }

      applyBtn.disabled = !info.ok;
      if (info.ok) validatedFile = file;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.update_validate_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      validateBtn.disabled = false;
    }
  });

  applyBtn.addEventListener("click", async () => {
    if (!validatedFile) return;
    if (!confirm(t("settings.update_apply_confirm"))) return;
    applyBtn.disabled = true;
    msgEl.innerHTML = `<div class="alert info">${t("settings.update_applying")}</div>`;
    try {
      const res = await api.applyUpdate(validatedFile);
      msgEl.innerHTML = "";
      preview.classList.add("hidden");
      result.classList.remove("hidden");
      const errHtml = res.errors.length
        ? `<div class="alert warning" style="margin-top:0.5rem;">⚠ ${res.errors.length} fejl:<br>${res.errors.map(e => esc(e)).join("<br>")}</div>`
        : "";
      resultMsg.innerHTML =
        `<div class="alert success">${t("settings.update_done").replace("{n}", res.applied_count)}</div>` +
        errHtml +
        `<p class="hint" style="margin-top:0.5rem;">${t("settings.update_hint2").replace("\n", "<br>").replace("\n", "<br>")}</p>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.update_fail").replace("{msg}", esc(err.message))}</div>`;
      applyBtn.disabled = false;
    }
  });

  restartBtn.addEventListener("click", async () => {
    if (!confirm(t("settings.update_restart_confirm"))) return;
    restartBtn.disabled = true;
    try {
      await api.restartServer();
      msgEl.innerHTML = `<div class="alert info">${t("settings.update_restarting")}</div>`;
      setTimeout(() => window.location.reload(), 8000);
    } catch {
      // Serveren lukker ned — det er forventet at kaldet fejler
      msgEl.innerHTML = `<div class="alert info">${t("settings.update_restarting")}</div>`;
      setTimeout(() => window.location.reload(), 8000);
    }
  });
}

async function initPortalAuthConfigSection(container) {
  const form = container.querySelector("#auth-cfg-form");
  const msg = container.querySelector("#auth-cfg-msg");
  const authModeSel = container.querySelector("#auth_mode");
  const tacacsFields = container.querySelector("#tacacs-fields");
  const testBtn = container.querySelector("#tacacs-test-btn");
  const testPanel = container.querySelector("#tacacs-test-panel");
  const runTestBtn = container.querySelector("#tacacs-run-test-btn");
  const testResult = container.querySelector("#tacacs-test-result");

  if (!form) return;

  // Set element texts
  const authCardH3 = container.querySelector("#auth-card-h3");
  if (authCardH3) authCardH3.textContent = t("settings.auth_card");
  const authModeLocalOpt = container.querySelector("#auth-mode-local-opt");
  if (authModeLocalOpt) authModeLocalOpt.textContent = t("settings.auth_mode_local");
  const authModeTacacsOpt = container.querySelector("#auth-mode-tacacs-opt");
  if (authModeTacacsOpt) authModeTacacsOpt.textContent = t("settings.auth_mode_tacacs");
  const authTacacsHostLbl = container.querySelector("#auth-tacacs-host-lbl");
  if (authTacacsHostLbl) authTacacsHostLbl.textContent = t("settings.auth_tacacs_host");
  const authTacacsPortLbl = container.querySelector("#auth-tacacs-port-lbl");
  if (authTacacsPortLbl) authTacacsPortLbl.textContent = t("settings.auth_tacacs_port");
  const authTacacsSecretLbl = container.querySelector("#auth-tacacs-secret-lbl");
  if (authTacacsSecretLbl) authTacacsSecretLbl.textContent = t("settings.auth_tacacs_secret");
  const tacacsSecretInput = container.querySelector("#tacacs_secret");
  if (tacacsSecretInput) tacacsSecretInput.placeholder = t("settings.auth_tacacs_secret_ph");
  const authTacacsTimeoutLbl = container.querySelector("#auth-tacacs-timeout-lbl");
  if (authTacacsTimeoutLbl) authTacacsTimeoutLbl.textContent = t("settings.auth_tacacs_timeout");
  const authTacacsFallbackLbl = container.querySelector("#auth-tacacs-fallback-lbl");
  if (authTacacsFallbackLbl) authTacacsFallbackLbl.textContent = t("settings.auth_tacacs_fallback");
  const authAttrMappingLbl = container.querySelector("#auth-attr-mapping-lbl");
  if (authAttrMappingLbl) authAttrMappingLbl.textContent = t("settings.auth_attr_mapping");
  const authProfileAttrLbl = container.querySelector("#auth-profile-attr-lbl");
  if (authProfileAttrLbl) authProfileAttrLbl.textContent = t("settings.auth_profile_attr");
  const authBtnSave = container.querySelector("#auth-btn-save");
  if (authBtnSave) authBtnSave.textContent = t("settings.auth_btn_save");
  if (testBtn) testBtn.textContent = t("settings.auth_btn_test");
  const authTestLegendLbl = container.querySelector("#auth-test-legend-lbl");
  if (authTestLegendLbl) authTestLegendLbl.textContent = t("settings.auth_test_legend");
  const authTestUserLbl = container.querySelector("#auth-test-user-lbl");
  if (authTestUserLbl) authTestUserLbl.textContent = t("settings.auth_test_user");
  const authTestPwLbl = container.querySelector("#auth-test-pw-lbl");
  if (authTestPwLbl) authTestPwLbl.textContent = t("settings.auth_test_pw");
  if (runTestBtn) runTestBtn.textContent = t("settings.auth_test_btn");
  const authOpCardH3 = container.querySelector("#auth-op-card-h3");
  if (authOpCardH3) authOpCardH3.textContent = t("settings.auth_op_card");

  function showMsg(html) { if (msg) msg.innerHTML = html; }
  function clearMsg() { if (msg) msg.innerHTML = ""; }

  function toggleTacacsFields() {
    if (!tacacsFields || !authModeSel) return;
    tacacsFields.style.display = authModeSel.value === "tacacs" ? "" : "none";
  }

  authModeSel?.addEventListener("change", toggleTacacsFields);

  async function loadAuthConfig() {
    try {
      const s = await api.getPortalAuthConfig();
      authModeSel.value = s.auth_mode || "local";
      container.querySelector("#tacacs_host").value = s.tacacs_server_host || "";
      container.querySelector("#tacacs_port").value = s.tacacs_server_port || 49;
      container.querySelector("#tacacs_secret").value = "";
      container.querySelector("#tacacs_timeout").value = s.tacacs_timeout_seconds || 5;
      container.querySelector("#tacacs_fallback").checked = !!s.tacacs_fallback_to_local;
      container.querySelector("#tacacs_profile_attr").value = s.tacacs_operator_profile_attribute || "portal-operator-profile";
      const hint = container.querySelector("#tacacs-secret-hint");
      if (hint) hint.textContent = s.tacacs_secret_set ? t("settings.auth_secret_set") : "";
      toggleTacacsFields();
    } catch (err) {
      showMsg(`<div class="alert error">${t("settings.auth_load_err").replace("{msg}", esc(err.message))}</div>`);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    const payload = {
      auth_mode: authModeSel.value,
      tacacs_server_host: container.querySelector("#tacacs_host").value,
      tacacs_server_port: parseInt(container.querySelector("#tacacs_port").value, 10) || 49,
      tacacs_secret: container.querySelector("#tacacs_secret").value,
      tacacs_timeout_seconds: parseInt(container.querySelector("#tacacs_timeout").value, 10) || 5,
      tacacs_fallback_to_local: container.querySelector("#tacacs_fallback").checked,
      tacacs_operator_profile_attribute: container.querySelector("#tacacs_profile_attr").value || "portal-operator-profile",
    };
    try {
      await api.updatePortalAuthConfig(payload);
      showMsg(`<div class="alert success">${t("settings.auth_saved")}</div>`);
      await loadAuthConfig();
    } catch (err) {
      showMsg(`<div class="alert error">${t("settings.auth_err").replace("{msg}", esc(err.message))}</div>`);
    }
  });

  testBtn?.addEventListener("click", () => {
    if (testPanel) testPanel.style.display = testPanel.style.display === "none" ? "" : "none";
  });

  runTestBtn?.addEventListener("click", async () => {
    if (!testResult) return;
    testResult.innerHTML = `<div class="alert info">${t("settings.auth_testing")}</div>`;
    const testUser = container.querySelector("#test-tacacs-user")?.value || "";
    const testPw = container.querySelector("#test-tacacs-pw")?.value || "";
    if (!testUser || !testPw) {
      testResult.innerHTML = `<div class="alert error">${t("settings.auth_test_err_creds")}</div>`;
      return;
    }
    try {
      const res = await api.testTacacs({ username: testUser, password: testPw });
      if (res.ok) {
        testResult.innerHTML = `
          <div class="alert success">
            ${t("settings.auth_test_ok")}<br>
            ${res.operator_profile
              ? `${t("settings.auth_test_ok_profile").replace("{name}", `<strong>${esc(res.operator_profile)}</strong>`)}<br><span class="hint">${t("settings.auth_test_ok_hint")}</span>`
              : `<span class="hint">${t("settings.auth_test_no_profile")}</span>`}
          </div>`;
      } else {
        testResult.innerHTML = `<div class="alert error">${esc(res.message)}</div>`;
      }
    } catch (err) {
      testResult.innerHTML = `<div class="alert error">${t("settings.auth_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  await loadAuthConfig();
}

function initAdvancedSection(container) {
  const btn    = container.querySelector("#migration-sync-btn");
  const result = container.querySelector("#migration-sync-result");
  if (!btn) return;

  // Set element texts
  const advCardH3 = container.querySelector("#adv-card-h3");
  if (advCardH3) advCardH3.textContent = t("settings.adv_card");
  btn.textContent = t("settings.adv_btn");

  btn.addEventListener("click", async () => {
    if (!confirm(t("settings.adv_confirm"))) return;

    btn.disabled = true;
    result.innerHTML = `<div class="alert" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:0.6rem 1rem;color:#1e40af;">${t("settings.adv_loading")}</div>`;
    try {
      const res = await api.syncCustomAttributes();
      const newCount = Object.values(res.new_values_found || {}).reduce((s, v) => s + (v?.length || 0), 0);
      result.innerHTML = `<div class="alert" style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:0.6rem 1rem;color:#166534;">${t("settings.adv_done").replace("{n}", res.scanned_endpoints).replace("{new}", newCount)}</div>`;
    } catch (err) {
      result.innerHTML = `<div class="alert" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:0.6rem 1rem;color:#991b1b;">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}
