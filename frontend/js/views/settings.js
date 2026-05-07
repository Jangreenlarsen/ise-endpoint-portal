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
  const isPskEditorUser = isAdmin || currentUser?.role === "editor-psk";

  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">Settings</h2>
    </div>
    <nav class="settings-tabs" id="settings-tabs">
      ${isAdmin ? `
      <button class="settings-tab" data-tab="connection">Forbindelse</button>
      <button class="settings-tab" data-tab="performance">Performance</button>
      <button class="settings-tab" data-tab="pxgrid">PxGrid</button>
      <button class="settings-tab" data-tab="ise-config">ISE-config</button>
      <button class="settings-tab" data-tab="access">Adgang</button>
      <button class="settings-tab" data-tab="templates">Skabeloner</button>
      <button class="settings-tab" data-tab="system-update">Opdatering</button>
      ` : ""}
      ${isPskEditorUser ? `
      <button class="settings-tab" data-tab="psk-policy">PSK-politik</button>
      ` : ""}
      <button class="settings-tab" data-tab="account">Konto</button>
    </nav>
    <div class="settings-panels" id="settings-panels">

    ${isAdmin ? `
    <div class="card" data-tab="connection">
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
    <div class="card" data-tab="performance">
      <h3>Endpoint-cache</h3>
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
            Cache aktiveret
          </label>
          <div class="hint">Slå fra for at debugge — alle reads rammer så ISE direkte.</div>
        </div>
        <div class="field">
          <label for="cache_ttl_seconds">TTL (sekunder)</label>
          <input type="number" id="cache_ttl_seconds" min="5" max="3600" step="5" />
          <div class="hint">Hvor længe en detail-entry regnes som fresh. Pre-warm workeren erstatter løbende stale entries.</div>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="cache_stale_while_revalidate" />
            Stale-while-revalidate
          </label>
          <div class="hint">Server stale entries straks og hent ny data i baggrunden — undgår ventetid i Browse.</div>
        </div>
        <div class="field">
          <label for="cache_sync_interval_seconds">Reaktiv sync-interval (sekunder)</label>
          <input type="number" id="cache_sync_interval_seconds" min="0" max="3600" step="30" />
          <div class="hint">0 = deaktiveret. Supplerer pre-warm: refresh'er entries der er ældre end halv TTL ud over den planlagte scanning.</div>
        </div>

        <h4 style="margin-top:1.2rem;margin-bottom:0.6rem;">Pre-warm worker</h4>
        <div class="field">
          <label for="cache_prewarm_interval_s">Scanning-interval (sekunder)</label>
          <input type="number" id="cache_prewarm_interval_s" min="60" max="86400" step="60" />
          <div class="hint">Hvor ofte workeren scanner <em>alle</em> ISE-endpoints (default: 1800 = 30 min).</div>
        </div>
        <div class="field">
          <label for="cache_prewarm_concurrency">Parallel ISE-forbindelser</label>
          <input type="number" id="cache_prewarm_concurrency" min="1" max="10" step="1" />
          <div class="hint">Antal samtidige GET-kald mod ISE under scanning. ISE klarer max ~5 (default: 5).</div>
        </div>
        <div class="field">
          <label for="cache_disk_path">Disk-cache sti</label>
          <input type="text" id="cache_disk_path" style="font-family:monospace;width:100%;" />
          <div class="hint">Relativ til backend-mappen. Indeholdet genindlæses ved genstart og markeres med ⏱ i Browse.</div>
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
    <div class="card" data-tab="pxgrid">
      <h3>PxGrid 2.0 (real-time session push)</h3>
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
            PxGrid aktiveret
          </label>
          <div class="hint">Off = portalen falder tilbage til MnT-poll (nuværende adfærd).</div>
        </div>
        <div class="field">
          <label for="pxgrid_node_name">Node-navn (vises i ISE pxGrid Services → Clients)</label>
          <input type="text" id="pxgrid_node_name" placeholder="hypervision-portal" autocomplete="off" />
          <div class="hint">CSR-mode bruger dette som CN + SAN:dNSName i certifikatet.</div>
        </div>
        <div class="field">
          <label for="pxgrid_cert_extra_sans">Ekstra SAN-navne (komma-separeret, valgfri)</label>
          <input type="text" id="pxgrid_cert_extra_sans" placeholder="portal.ll.lan, hypervision-portal.ll.lan" autocomplete="off" />
          <div class="hint">
            Tilføjes som <code>SubjectAlternativeName:dNSName</code> i CSR'en udover node-navnet.
            <strong>Anbefalet:</strong> medtag portalens host-FQDN — pxGrid 2.0 / RFC 6125 best practice.
            Tom = kun node-navnet i SAN (minimum-kravet for ISE 3.4).
            <em>Påvirker kun nye CSR'er — eksisterende cert skal genskabes via Nulstil registrering → Trin 1.</em>
          </div>
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
            <div class="upload-status hint" id="pxgrid-upload-cert-status"></div>
          </div>
          <div class="field">
            <label for="pxgrid-upload-key">Privat key (PEM)</label>
            <input type="file" id="pxgrid-upload-key" accept=".pem,.key" />
            <div class="upload-status hint" id="pxgrid-upload-key-status"></div>
          </div>
          <div class="field">
            <label for="pxgrid-upload-ca">CA-bundle (PEM)</label>
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
            <label for="pxgrid-pfx-file">PKCS#12-bundle</label>
            <input type="file" id="pxgrid-pfx-file" accept=".pfx,.p12" />
          </div>
          <div class="field">
            <label for="pxgrid-pfx-pw">PFX-password</label>
            <input type="password" id="pxgrid-pfx-pw" placeholder="(tom hvis bundlet ikke er password-beskyttet)" autocomplete="off" />
          </div>
          <div class="actions">
            <button type="button" id="pxgrid-pfx-import-btn" class="secondary">Importér PKCS#12</button>
          </div>
        </div>

        <div id="pxgrid-csr-block" hidden>
          <p class="hint">
            <strong>CSR-mode — 5 trin (gør i rækkefølge):</strong>
          </p>
          <div class="field">
            <label><strong>Trin 1 — Generér + download CSR</strong></label>
            <div class="hint">Portalen laver RSA-2048 keypair + CSR med CN=node-navn og auto-downloader CSR-filen til Downloads.</div>
            <div class="actions" style="margin-top:0.25rem;">
              <button type="button" id="pxgrid-csr-btn" class="secondary">Generér CSR + keypair</button>
              <button type="button" id="pxgrid-csr-dl-btn" class="secondary">Download CSR igen</button>
            </div>
          </div>
          <div class="field">
            <label><strong>Trin 2 — Indsend CSR til din CA, hent signeret cert + CA-chain</strong></label>
            <div class="hint">
              <strong>ISE Internal CA</strong>: Administration → pxGrid Services → Certificates → Generate Certificate → "I have a certificate signing request" → upload CSR → download signeret cert. CA-chain hentes fra Administration → System → Certificates → Certificate Authority Certificates.<br>
              <strong>MS certsrv</strong>: <code>https://&lt;ca&gt;/certsrv/</code> → advanced request → submit CSR (Base 64) → vælg template (typisk "pxGrid Client") → "Download certificate" (ikke chain). CA-bundle: forsiden → "Download a CA certificate chain" → konvertér p7b til PEM med <code>openssl pkcs7 -print_certs -in certnew.p7b -out ca.pem</code>.
            </div>
          </div>
          <div class="field">
            <label for="pxgrid-csr-signed-cert"><strong>Trin 3 — Upload signeret klient-cert (PEM/CER)</strong></label>
            <input type="file" id="pxgrid-csr-signed-cert" accept=".pem,.crt,.cer" />
            <div class="upload-status hint" id="pxgrid-csr-signed-cert-status"></div>
            <div class="hint">Filen fra trin 2 (MS certsrv eller ISE internal CA). Parres med den private key portalen genererede i trin 1.</div>
          </div>
          <div class="field">
            <label for="pxgrid-csr-ca-bundle"><strong>Trin 4 — Upload CA-bundle (PEM)</strong></label>
            <input type="file" id="pxgrid-csr-ca-bundle" accept=".pem,.crt,.cer" />
            <div class="upload-status hint" id="pxgrid-csr-ca-bundle-status"></div>
            <div class="hint">CA-chain der har signeret <em>ISE pxGrid-server-certifikatet</em> (bruges til at verificere serveren ved mTLS-handshake). Hvis MS CA også har signeret ISE's pxGrid-cert er det samme chain som klient-cert'et.</div>
          </div>
          <div class="field">
            <label><strong>Trin 5 — Registrér klienten i ISE</strong></label>
            <div class="hint">ISE returnerer accountState=PENDING. ISE-admin approver derefter manuelt i <em>Administration → pxGrid Services → Clients</em>, hvorefter "Test forbindelse"-knappen nedenfor skal være grøn.</div>
            <div class="actions" style="margin-top:0.25rem;">
              <button type="button" id="pxgrid-account-btn" class="secondary">Opret pxGrid-konto</button>
            </div>
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
        <fieldset style="margin-top:0.8rem; padding:0.6rem 0.8rem; border:1px solid var(--border, #ccc); border-radius:6px;">
          <legend style="padding:0 0.4rem; font-weight:600;">Phase 2b — Persistent STOMP-worker</legend>
          <div class="field">
            <label>
              <input type="checkbox" id="pxgrid_worker_enabled" />
              Worker aktiveret (kører subscribe-loop i baggrunden)
            </label>
            <div class="hint">Off = falder tilbage på MnT-poll. Off her uden at slå PxGrid helt fra er nyttigt til fejlsøgning.</div>
          </div>
          <div class="field">
            <label for="pxgrid_session_topic">Session-topic (auth-status)</label>
            <input type="text" id="pxgrid_session_topic" placeholder="/topic/com.cisco.ise.session" autocomplete="off" />
            <div class="hint">Default <code>/topic/com.cisco.ise.session</code>. RADIUS session-events (STARTED/AUTHENTICATED/DISCONNECTED).</div>
          </div>
          <div class="field">
            <label>
              <input type="checkbox" id="pxgrid_endpoint_topic_enabled" />
              Subscribe også til endpoint-topic (Phase 4 — admin-ændringer i ISE)
            </label>
            <div class="hint">Når ON: ISE-admin's endpoint create/update/delete-events invaliderer 2.8.0-cachen og pushes til Browse, så rækken reloader automatisk uden refresh. Off = kun session-topic.</div>
          </div>
          <div class="field">
            <label for="pxgrid_endpoint_service">Endpoint-service navn (ServiceLookup)</label>
            <input type="text" id="pxgrid_endpoint_service" placeholder="com.cisco.ise.endpoint" autocomplete="off" />
            <div class="hint">
              ISE pxGrid-service der ServiceLookup'es for at finde den kanoniske endpoint-topic.
              Hvis events udebliver, prøv: <code>com.cisco.ise.config.profiler</code> eller
              <code>com.cisco.ise.endpoint.asset</code>. Worker-status feltet viser hvilken topic der faktisk blev fundet.
            </div>
          </div>
          <div class="field">
            <label for="pxgrid_endpoint_topic">Endpoint-topic fallback (hvis ServiceLookup ikke har 'topic'-property)</label>
            <input type="text" id="pxgrid_endpoint_topic" placeholder="/topic/com.cisco.ise.endpoint" autocomplete="off" />
            <div class="hint">Bruges kun hvis ServiceLookup på service-navnet ikke returnerer en eksplicit topic.</div>
          </div>
          <div class="field">
            <label for="pxgrid_stomp_heartbeat_ms">Heart-beat interval (ms, server → klient)</label>
            <input type="number" id="pxgrid_stomp_heartbeat_ms" min="0" step="1000" placeholder="30000" />
            <div class="hint">Annonceres som <code>0,N</code> i CONNECT. Tab af heartbeat trigger reconnect efter 2× interval. 0 = ingen heartbeat.</div>
          </div>
          <div class="field" style="display:flex; gap:0.6rem;">
            <div style="flex:1;">
              <label for="pxgrid_stomp_reconnect_min_s">Reconnect backoff min (sek)</label>
              <input type="number" id="pxgrid_stomp_reconnect_min_s" min="0.5" step="0.5" placeholder="1" />
            </div>
            <div style="flex:1;">
              <label for="pxgrid_stomp_reconnect_max_s">Reconnect backoff max (sek)</label>
              <input type="number" id="pxgrid_stomp_reconnect_max_s" min="1" step="1" placeholder="300" />
            </div>
          </div>
          <div class="hint">Eksponentiel backoff: starter ved <em>min</em>, fordobles efter hver fejlet reconnect, capper ved <em>max</em>. 1 → 300s er en god balance.</div>
          <div class="field">
            <label for="pxgrid_session_cache_max_age_s">Session-cache max age (sek)</label>
            <input type="number" id="pxgrid_session_cache_max_age_s" min="0" step="60" placeholder="0" />
            <div class="hint">0 = ingen automatisk udløb (kun DISCONNECTED-events evictor). 86400 = 24t.</div>
          </div>
          <div id="pxgrid-worker-status" class="hint" style="margin-top:0.4rem; padding:0.5rem; background:rgba(0,0,0,0.04); border-radius:4px;">Henter worker-status…</div>
          <div class="actions" style="margin-top:0.4rem;">
            <button type="button" id="pxgrid-worker-refresh-btn" class="secondary">Opdater status</button>
            <button type="button" id="pxgrid-worker-restart-btn" class="secondary">Restart worker</button>
          </div>
        </fieldset>
        <div class="actions">
          <button type="submit">Gem PxGrid settings</button>
          <button type="button" id="pxgrid-test-btn" class="secondary">Test forbindelse</button>
          <button type="button" id="pxgrid-stomp-btn" class="secondary">Test STOMP-subscription (10s)</button>
          <button type="button" id="pxgrid-reset-btn" class="danger" style="margin-left:auto;">Nulstil registrering</button>
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
    <div class="card" data-tab="ise-config">
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
            <li><strong>Rule Name:</strong> <code>HyperVision Portal</code> <button type="button" class="secondary small copy-btn" data-copy="HyperVision Portal">Kopiér</button></li>
            <li><strong>Condition:</strong> <code>CUSTOMATTRIBUTE HypervisionISEPortal EQUALS true</code> <button type="button" class="secondary small copy-btn" data-copy="HypervisionISEPortal">Kopiér attribut-navn</button></li>
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

    <div class="card" data-tab="access">
      <h3>System adm</h3>
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
        <input type="text" id="new-role-name" placeholder="System adm-navn (fx alle-Printer)"
               pattern="[A-Za-z0-9_\\-]{1,64}" maxlength="64" required />
        <input type="text" id="new-role-desc" placeholder="beskrivelse (valgfri)" maxlength="256" />
        <button type="submit">Opret System adm</button>
      </form>
    </div>

    <div class="card" data-tab="access">
      <h3>Brugere &amp; System adm</h3>
      <p class="hint">
        Administrer lokale brugerkonti, system-roller og System adm-tildelinger.
        <b>admin</b> har fuld adgang. <b>editor</b> kan oprette/redigere endpoints. <b>viewer</b> kan kun læse.
        <b>registrar</b> kan registrere endpoints (alle formularfelter). <b>registrar_templet</b> kan KUN vælge skabelon + indtaste MAC og beskrivelse.
        System adm bestemmer hvilke endpoints ikke-admin-brugere kan se (deres username er altid implicit tildelt).
      </p>
      <div id="users-msg"></div>
      <table class="users-table">
        <thead>
          <tr>
            <th>Brugernavn</th>
            <th style="width:9rem;">Rolle</th>
            <th>System adm</th>
            <th>Skabeloner (registrar_templet)</th>
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
          <option value="editor-psk">editor-psk (PSK-redaktør)</option>
          <option value="admin">admin</option>
          <option value="registrar">registrar (opret — alle felter)</option>
          <option value="registrar_templet">registrar_templet (skabelon + MAC + beskrivelse)</option>
        </select>
        <button type="submit">Opret bruger</button>
      </form>
    </div>
    ` : ""}

    ${isPskEditorUser ? `
    <div class="card" data-tab="psk-policy">
      <h3>PSK Pass Key Politik</h3>
      <p class="hint">
        Definerer krav til MPSK/IPSK pass keys. Nøgler valideres mod denne politik
        når de gemmes på endpoints. Politikken anvendes også af nøgle-generatoren.
      </p>
      <div id="psk-policy-msg"></div>
      <form id="psk-policy-form">
        <div class="field">
          <label>PSK Mode-type</label>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="psk-type" id="psk-type-mpsk" value="MPSK" checked /> <b>MPSK</b> — Multi-PSK (Cisco WLC)</label>
            <label class="radio-label"><input type="radio" name="psk-type" id="psk-type-ipsk" value="IPSK" /> <b>IPSK</b> — Identity PSK (Cisco ISE RADIUS). Portalen tilføjer automatisk <code>psk=</code>-prefix i ISE.</label>
          </div>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-show-key" /> Vis PSK Key i klartekst i browse-tabellen (ellers vises ••••••)</label>
        </div>
        <div class="field">
          <label for="psk-min-length">Minimum længde (8–128 tegn)</label>
          <input type="number" id="psk-min-length" min="8" max="128" step="1" value="8" />
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-req-upper" /> Kræver stort bogstav (A-Z)</label>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-req-number" /> Kræver tal (0-9)</label>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" id="psk-req-special" /> Kræver specialtegn (!@#$…)</label>
        </div>
        <div class="actions">
          <button type="submit">Gem PSK-politik</button>
          <button type="button" id="psk-test-gen" class="secondary">Test: Generer nøgle</button>
        </div>
      </form>
      <div id="psk-gen-result" class="hint" style="margin-top:0.5rem;font-family:monospace;"></div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="templates">
      <h3>Endpoint-skabeloner</h3>
      <p class="hint">
        Skabeloner forudfylder registreringsformularen med standardværdier —
        registrar vælger en skabelon og scanner blot MAC-adressen.
      </p>
      <div id="tpl-msg"></div>
      <div id="tpl-list" style="margin-bottom:1rem;"></div>
      <button type="button" id="tpl-new-btn" class="secondary">+ Ny skabelon</button>

      <div id="tpl-form-wrap" class="hidden" style="margin-top:1.5rem;border-top:1px solid var(--border,#e2e8f0);padding-top:1.25rem;">
        <h4 id="tpl-form-title" style="margin:0 0 1.25rem;">Ny skabelon</h4>
        <input type="hidden" id="tpl-edit-id" value="" />
        <form id="tpl-form" onsubmit="return false;" style="max-width:560px;">
          <div class="field">
            <label for="tpl-name">Navn <span style="color:#e11d48;">*</span></label>
            <input type="text" id="tpl-name" placeholder="fx ESP32-Modbus" required />
          </div>
          <div class="field">
            <label for="tpl-desc-field">Beskrivelse af skabelon</label>
            <input type="text" id="tpl-desc-field" placeholder="(valgfri kort beskrivelse af skabelonen)" />
          </div>
          <div class="field">
            <label for="tpl-group">Identity Group</label>
            <select id="tpl-group">
              <option value="">— ingen (ISE default) —</option>
            </select>
          </div>
          <div class="field">
            <label for="tpl-ep-desc">Standard beskrivelse på endpoint</label>
            <input type="text" id="tpl-ep-desc" placeholder="(valgfri — forudfylder endpoint-beskrivelsesfeltet)" />
          </div>
          <div id="tpl-attrs-wrap"></div>
          <div class="field checkbox-field">
            <input type="checkbox" id="tpl-static-group" />
            <label for="tpl-static-group">Static Group Assignment</label>
          </div>
          <div class="field">
            <label>Synlig for roller</label>
            <p class="hint" style="margin:0 0 0.5rem;">Tom = synlig for alle roller. Sæt hak = kun de valgte (admin se alle roller default) kan se skabelonen.</p>
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem 1.5rem;">
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="editor" /> editor</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="editor-psk" /> editor-psk</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="viewer" /> viewer</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="registrar" /> registrar</label>
              <label class="checkbox-label"><input type="checkbox" class="tpl-visible-to" value="registrar_templet" /> registrar_templet</label>
            </div>
          </div>
          <div class="actions" style="margin-top:1.25rem;">
            <button type="button" id="tpl-save-btn" class="primary">Gem skabelon</button>
            <button type="button" id="tpl-cancel-btn" class="secondary">Annuller</button>
          </div>
        </form>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="system-update">
      <h3>Portal system opdatering</h3>
      <p class="hint">
        Upload en opdateringspakke (ZIP) for at opdatere portalen.
        Frontend-ændringer aktiveres øjeblikkeligt. Backend-ændringer kræver genstart.<br>
        <strong>Kun tilgængelig for admin-brugere.</strong>
      </p>
      <div id="update-msg"></div>

      <div class="field">
        <label>Opdateringspakke (.zip)</label>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <input type="file" id="update-file-input" accept=".zip" style="flex:1;min-width:200px;" />
          <button type="button" id="update-validate-btn" class="secondary" disabled>Validér pakke</button>
        </div>
      </div>

      <div id="update-preview" class="hidden" style="margin-top:1rem;">
        <div class="field">
          <label>Pakke-info</label>
          <div id="update-pkg-info" style="font-family:monospace;font-size:0.85rem;background:var(--bg-secondary,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:0.75rem;"></div>
        </div>
        <div id="update-file-list-wrap" class="field hidden">
          <label>Filer der opdateres (<span id="update-file-count">0</span>)</label>
          <div id="update-file-list" style="font-family:monospace;font-size:0.78rem;max-height:180px;overflow-y:auto;background:var(--bg-secondary,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:0.5rem;white-space:pre;"></div>
        </div>
        <div id="update-blocked-wrap" class="field hidden">
          <label style="color:#b45309;">⚠ Blokerede filer (overskrives ikke)</label>
          <div id="update-blocked-list" style="font-family:monospace;font-size:0.78rem;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:0.5rem;white-space:pre;color:#92400e;"></div>
        </div>
        <div class="actions" style="margin-top:1rem;">
          <button type="button" id="update-apply-btn" class="primary" disabled>Anvend opdatering</button>
        </div>
      </div>

      <div id="update-result" class="hidden" style="margin-top:1rem;">
        <div id="update-result-msg"></div>
      </div>

      <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border,#e2e8f0);">
        <h4 style="margin:0 0 0.5rem;">Genstart server</h4>
        <p class="hint" style="margin:0 0 0.75rem;">Genstarter backend-processen. Kræver at START.bat kører i loop-tilstand. Siden genindlæses automatisk.</p>
        <div class="actions">
          <button type="button" id="update-restart-btn" class="secondary">Genstart server</button>
        </div>
      </div>
    </div>
    ` : ""}

    <div class="card" data-tab="account">
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

    <div class="card" data-tab="account">
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

    <div class="card" data-tab="account">
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
  }
  if (isPskEditorUser) {
    await initPskPolicySection(container);
  }
  if (isAdmin) {
    await initTemplatesSection(container);
    initSystemUpdateSection(container);
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

  container.querySelector("#pxgrid-stomp-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.innerHTML = `<div class="alert info">Subscriber til com.cisco.ise.session i 10 sekunder — vent venligst...</div>`;
    try {
      const r = await api.runPxGridStompProbe(10);
      const cls = r.ok ? "success" : "error";
      const samples = r.sample_payloads?.length
        ? `<br><details style="margin-top:0.4rem;"><summary>${r.sample_payloads.length} sample payload(s)</summary><pre style="white-space:pre-wrap;font-size:0.85em;background:#f3f4f6;padding:0.5rem;margin-top:0.3rem;border-radius:4px;">${r.sample_payloads.map(esc).join("\n---\n")}</pre></details>`
        : "";
      const broker = r.peer_node ? ` via ${esc(r.peer_node)}` : "";
      const headline = r.ok
        ? `STOMP OK [${esc(r.step)}] — modtog ${r.messages_received} event(s) på ${r.duration_s}s${broker}`
        : `STOMP fejlede ved [${esc(r.step)}]: ${esc(r.error || "ukendt")}`;
      msg.innerHTML = `<div class="alert ${cls}">${headline}${samples}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">STOMP-probe fejlede: ${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  function fmtAge(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s siden`;
    if (s < 3600) return `${Math.floor(s/60)}m siden`;
    return `${Math.floor(s/3600)}t siden`;
  }

  async function refreshWorkerStatus() {
    const el = container.querySelector("#pxgrid-worker-status");
    if (!el) return;
    try {
      const w = await api.getPxGridWorkerStatus();
      const dot = w.connected ? "🟢" : (w.running ? "🟡" : "🔴");
      const lbl = w.connected ? "connected" : (w.running ? "running, ikke connected" : "stopped");
      const lastErr = w.last_error
        ? `<br><span style="color:#b91c1c;">Sidste fejl: ${esc(w.last_error)}</span>`
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
          : `<em>(ingen properties returneret)</em>`;
        lookupHtml = `<br><strong>Endpoint ServiceLookup:</strong> <code>${esc(w.endpoint_lookup_service)}</code> ${propsLine}`;
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
      el.innerHTML = `<span style="color:#b91c1c;">Kunne ikke hente worker-status: ${esc(err.message)}</span>`;
    }
  }

  container.querySelector("#pxgrid-worker-refresh-btn").addEventListener("click", refreshWorkerStatus);
  container.querySelector("#pxgrid-worker-restart-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.innerHTML = `<div class="alert info">Restarter pxGrid-worker...</div>`;
    try {
      await api.restartPxGridWorker();
      msg.innerHTML = `<div class="alert success">Worker restartet.</div>`;
      await refreshWorkerStatus();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Restart fejlede: ${esc(err.message)}</div>`;
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
        msg.innerHTML = `<div class="alert error">Download af CSR fejlede: ${esc(err.message)}</div>`;
      }
      return null;
    }
  }

  container.querySelector("#pxgrid-csr-btn").addEventListener("click", async () => {
    if (!confirm("Generér nyt RSA-2048 keypair + CSR? Eksisterende key for samme node-navn overskrives.")) return;
    msg.innerHTML = `<div class="alert info">Genererer CSR...</div>`;
    try {
      await autoSaveBeforeAction();
      const s = await api.generatePxGridCsr();
      // Auto-trigger download so admin har CSR-filen i Downloads med det samme.
      const filename = await downloadCsr({ silentOnError: true });
      const dlNote = filename
        ? ` CSR downloadet som <code>${esc(filename)}</code>.`
        : ` (Auto-download fejlede — brug "Download CSR-fil"-knappen.)`;
      msg.innerHTML = `<div class="alert success">CSR genereret. Key gemt på <code>${esc(s.pxgrid_key_path)}</code>.${dlNote} Indsend CSR-filen til ISE internal CA og upload det signerede cert som "Klient-certifikat" herover.</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-csr-dl-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">Henter CSR...</div>`;
    const filename = await downloadCsr();
    if (filename) {
      msg.innerHTML = `<div class="alert success">CSR downloadet som <code>${esc(filename)}</code>.</div>`;
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

  container.querySelector("#pxgrid-reset-btn").addEventListener("click", async () => {
    const ok = window.confirm(
      "Nulstil pxGrid-registrering?\n\n" +
      "Dette sletter:\n" +
      "  • Klient-cert, private key, CA-bundle, CSR\n" +
      "  • Gemt account-password\n\n" +
      "Behold:\n" +
      "  • pxgrid_enabled, node_name, psn_fqdn, cert_mode\n\n" +
      "Du skal selv slette klient-entry'en i ISE → pxGrid Services →\n" +
      "All Clients hvis du vil starte 100% rent.\n\n" +
      "Fortsæt?"
    );
    if (!ok) return;
    msg.innerHTML = `<div class="alert info">Nulstiller pxGrid-registrering...</div>`;
    try {
      const r = await api.resetPxGridRegistration();
      msg.innerHTML = `<div class="alert success">${esc(r.message)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Reset fejlede: ${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-pfx-import-btn").addEventListener("click", async () => {
    const fileEl = container.querySelector("#pxgrid-pfx-file");
    const pwEl = container.querySelector("#pxgrid-pfx-pw");
    const file = fileEl.files?.[0];
    if (!file) {
      msg.innerHTML = `<div class="alert error">Vælg en .pfx/.p12-fil først.</div>`;
      return;
    }
    msg.innerHTML = `<div class="alert info">Importerer PKCS#12...</div>`;
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
      msg.innerHTML = `<div class="alert error">PKCS#12-import fejlede: ${esc(err.message)}</div>`;
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
      msg.innerHTML = `<div class="alert info">Uploader ${esc(filename)}...</div>`;
      if (statusEl) statusEl.innerHTML = `<span style="color:#666;">Uploader ${esc(filename)}...</span>`;
      try {
        await api.uploadPxGridCert(kind, file);
        msg.innerHTML = `<div class="alert success">${esc(kind)} uploadet (${esc(filename)}) — sti opdateret nedenfor.</div>`;
        if (statusEl) statusEl.innerHTML = `<span style="color:#16a34a;">✓ Uploadet: ${esc(filename)}</span>`;
        await loadSettings();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">Upload af ${esc(kind)} fejlede: ${esc(err.message)}</div>`;
        if (statusEl) statusEl.innerHTML = `<span style="color:#c0392b;">✗ Fejl: ${esc(err.message)}</span>`;
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
    prewarmRows = `<tr><td colspan="2" style="color:#888;font-style:italic;">Pre-warm worker ikke tilgængelig</td></tr>`;
  } else {
    const scanPct = pw.total_endpoints > 0 ? Math.round(pw.scanned / pw.total_endpoints * 100) : 0;
    const scanStatus = pw.scanning
      ? `Scanner… ${pw.scanned}/${pw.total_endpoints} (${scanPct}%) — scan #${pw.scan_number}`
      : pw.running ? `Aktiv (afventer næste scan #${pw.scan_number + 1})` : `<span style="color:#c0392b;">Stoppet</span>`;
    const scanAge = pw.last_full_scan_age_s != null
      ? `${fmtAge(pw.last_full_scan_age_s * 1000)} siden` : "—";
    const diskSave = pw.last_disk_save_at
      ? fmtTimestamp(pw.last_disk_save_at) : "—";
    prewarmRows = `
        <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Pre-warm worker</td></tr>
        <tr><td>Status</td><td>${scanStatus}</td></tr>
        <tr><td>Seneste fuld scan</td><td>${scanAge}</td></tr>
        <tr><td>Disk-cache gemt</td><td>${diskSave}</td></tr>
        <tr><td>Disk-indlæste entries</td><td>${pw.disk_loaded}</td></tr>
        <tr><td>Hot-queue</td><td>${pw.hot_queue_size} endpoint(s) prioriteret</td></tr>
        ${pw.last_error ? `<tr><td>Seneste fejl</td><td><span style="color:#c0392b;">${esc(pw.last_error)}</span></td></tr>` : ""}`;
  }

  container.innerHTML = `
    <table class="cache-stats-table">
      <tbody>
        <tr><td>Status</td><td>${stats.enabled ? "Aktiveret" : "Deaktiveret"}</td></tr>
        <tr><td>TTL</td><td>${stats.ttl_seconds}s</td></tr>
        <tr><td>Stale-while-revalidate</td><td>${stats.stale_while_revalidate ? "TIL" : "FRA"}</td></tr>
        <tr><td>Detail-entries (memory)</td><td>${stats.detail_entries}</td></tr>
        <tr><td>Disk-stale entries</td><td>${stats.disk_stale_entries ?? 0}</td></tr>
        <tr><td>Disk-indlæsninger (total)</td><td>${stats.disk_loads ?? 0}</td></tr>
        <tr><td>Groups cached</td><td>${stats.groups_cached ? "Ja" : "Nej"}</td></tr>
        <tr><td>Hit-rate</td><td>${hitRate === "—" ? "—" : hitRate + "%"} (hits: ${hits}, stale: ${staleServes}, misses: ${misses})</td></tr>
        <tr><td>Baggrund-refreshes</td><td>${stats.bg_refreshes || 0} (${stats.inflight_detail_refreshes || 0} inflight)</td></tr>
        <tr><td>Invalideringer</td><td>${stats.invalidations || 0}</td></tr>
        <tr><td>Seneste sync</td><td>${fmtTimestamp(stats.last_sync_at)}</td></tr>
        <tr><td>Sync-fejl</td><td>${stats.last_sync_error ? `<span style="color:#c0392b;">${esc(stats.last_sync_error)}</span>` : "(ingen)"}</td></tr>
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
      cache_prewarm_interval_s: parseFloat(container.querySelector("#cache_prewarm_interval_s").value),
      cache_prewarm_concurrency: parseInt(container.querySelector("#cache_prewarm_concurrency").value, 10),
      cache_disk_path: container.querySelector("#cache_disk_path").value.trim(),
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

async function initPurgeProtectSection(container) {
  // Copy-knapper i vejledning-card'et: lægger den specificerede streng på
  // udklipsholderen så admin hurtigt kan paste ind i ISE-formularen.
  const msg = container.querySelector("#purge-protect-msg");
  container.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
        if (msg) msg.innerHTML = `<span style="color:#166534;">Kopieret: <code>${esc(text)}</code></span>`;
        const original = btn.textContent;
        btn.textContent = "✓ Kopieret";
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (err) {
        if (msg) msg.innerHTML = `<span style="color:#b91c1c;">Kunne ikke kopiere: ${esc(err.message)}</span>`;
      }
    });
  });
}

async function initRolesSection(container) {
  const tbody = container.querySelector("#roles-tbody");
  const msg = container.querySelector("#roles-msg");
  const form = container.querySelector("#role-create-form");
  const state = { roles: [], onChange: null, reload: null };

  async function reload() {
    msg.innerHTML = "";
    try {
      const data = await api.listEndpointRoles();
      state.roles = data.roles || [];
      if (state.roles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="hint" style="text-align:center;padding:1rem;">Ingen System adm endnu — opret den første nedenfor.</td></tr>`;
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
      msg.innerHTML = `<div class="alert error">Kunne ikke hente System adm: ${esc(err.message)}</div>`;
    }
  }

  tbody.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("role-del")) return;
    const row = e.target.closest("tr");
    const name = row.dataset.roleName;
    if (!confirm(`Slet System adm "${name}"? Brugere mister tildelingen, men endpoint-tags ændres ikke.`)) return;
    try {
      await api.deleteEndpointRole(name);
      msg.innerHTML = `<div class="alert success">System adm "${esc(name)}" slettet.</div>`;
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
      msg.innerHTML = `<div class="alert success">System adm oprettet.</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  await reload();
  state.reload = reload;
  return state;
}

async function initUsersSection(container, currentUser, rolesState) {
  const tbody = container.querySelector("#users-tbody");
  const msg = container.querySelector("#users-msg");

  let allTemplates = [];

  function renderEndpointRoleCell(user) {
    const catalog = (rolesState ? rolesState.roles : []).filter((r) => r.name.toLowerCase() !== "admin");
    const assigned = new Set(user.assigned_endpoint_roles || []);
    if (catalog.length === 0) {
      return `<span class="hint">Ingen System adm i kataloget endnu</span>`;
    }
    const checks = catalog
      .map((r) => {
        const checked = assigned.has(r.name) ? " checked" : "";
        return `<label class="role-chip"><input type="checkbox" class="user-role-chip" value="${esc(r.name)}"${checked}/> ${esc(r.name)}</label>`;
      })
      .join("");
    return `<div class="role-chips">${checks}</div>`;
  }

  function renderTemplateCell(user) {
    if (user.role !== "registrar_templet") return `<span style="color:var(--text-secondary,#94a3b8);">—</span>`;
    if (!allTemplates.length) return `<span class="hint">Ingen skabeloner endnu</span>`;
    const assigned = new Set(user.assigned_templates || []);
    const checks = allTemplates
      .map((t) => {
        const checked = assigned.has(t.id) ? " checked" : "";
        return `<label class="role-chip"><input type="checkbox" class="user-tpl-chip" value="${esc(t.id)}"${checked}/> ${esc(t.name)}</label>`;
      })
      .join("");
    return `<div class="role-chips">${checks}</div>`;
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
          const adminCell = `<span class="hint" style="font-style:italic;">Admin — alle System adm implicit</span>`;
          return `
            <tr data-user-id="${esc(u.id)}" data-username="${esc(u.username)}">
              <td>${esc(u.username)}</td>
              <td>
                <select class="user-role-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen rolle her'" : ""}>
                  ${["admin", "editor", "editor-psk", "viewer", "registrar", "registrar_templet"]
                    .map((r) => `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`)
                    .join("")}
                </select>
              </td>
              <td>${isPortalAdmin ? adminCell : renderEndpointRoleCell(u)}</td>
              <td>${renderTemplateCell(u)}</td>
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
        msg.innerHTML = `<div class="alert success">System adm opdateret for ${esc(row.dataset.username)}.</div>`;
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
        msg.innerHTML = `<div class="alert success">Skabeloner opdateret for ${esc(row.dataset.username)}.</div>`;
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
      msg.innerHTML = `<div class="alert success">Bruger oprettet — auto-System adm-rolle med samme navn er tilføjet til kataloget.</div>`;
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

async function initPskPolicySection(container) {
  const msg = container.querySelector("#psk-policy-msg");
  const form = container.querySelector("#psk-policy-form");
  const genResult = container.querySelector("#psk-gen-result");
  if (!form) return;

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
    msg.innerHTML = `<div class="alert error">Kunne ikke hente PSK-politik: ${esc(err.message)}</div>`;
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
      msg.innerHTML = `<div class="alert success">PSK-politik gemt.</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#psk-test-gen").addEventListener("click", async () => {
    genResult.textContent = "Genererer…";
    try {
      const { key } = await api.generatePskKey();
      genResult.textContent = `Eksempel: ${key}`;
    } catch (err) {
      genResult.textContent = `Fejl: ${err.message}`;
    }
  });
}

/* 3.8.3: Settings tab-navigation. Skjul/vis cards baseret på data-tab.
 * Persistér valgt tab i localStorage så bruger lander samme sted ved reload. */
const SETTINGS_TAB_KEY = "ise_portal_settings_tab";
function initSettingsTabs(container, isAdmin, isPskEditorUser = false) {
  const tabs = container.querySelectorAll(".settings-tab");
  const cards = container.querySelectorAll(".settings-panels [data-tab]");
  if (!tabs.length) return;
  const validTabs = Array.from(tabs).map(t => t.dataset.tab);
  const defaultTab = isAdmin ? "connection" : isPskEditorUser ? "psk-policy" : "account";
  let stored = null;
  try { stored = localStorage.getItem(SETTINGS_TAB_KEY); } catch { /* ignore */ }
  const initial = validTabs.includes(stored) ? stored : defaultTab;

  function activate(tabId) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    cards.forEach(c => {
      c.style.display = c.dataset.tab === tabId ? "" : "none";
    });
    try { localStorage.setItem(SETTINGS_TAB_KEY, tabId); } catch { /* ignore */ }
  }

  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.tab)));
  activate(initial);
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
    Type: "Type", Owner: "Ejer", Lokation: "Lokation",
    AuthzVlan: "Authz VLAN", AuthzACL: "Authz ACL", PlatformType: "Platform",
  };

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
    `<option value="">— ingen (ISE default) —</option>` +
    groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");

  attrsWrap.innerHTML = Object.entries(attrLabels).map(([name, label]) => {
    const opts = (attrMap[name] || [])
      .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    return `
      <div class="field">
        <label for="tpl-ca-${name}">${label}</label>
        <select id="tpl-ca-${name}" style="max-width:320px;">
          <option value="">— vælg —</option>${opts}
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
    formTitle.textContent = "Ny skabelon";
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
    formTitle.textContent = `Redigér: ${esc(tpl.name)}`;
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
        listDiv.innerHTML = `<p class="hint">Ingen skabeloner endnu.</p>`;
        return;
      }
      listDiv.innerHTML = `
        <table class="data-table" style="width:100%;">
          <thead><tr>
            <th>Navn</th><th>Beskrivelse</th><th>Gruppe</th><th>Custom attrs</th><th>Synlig for</th><th></th>
          </tr></thead>
          <tbody>
          ${templates.map((t) => {
            const f = t.fields || {};
            const ca = f.custom_attributes || {};
            const caStr = Object.entries(ca).filter(([,v]) => v)
              .map(([k,v]) => `${k}=${v}`).join(", ") || "—";
            const grpName = groups.find((g) => g.id === f.group_id)?.name || f.group_id || "—";
            const vt = (t.visible_to || []);
            const vtStr = vt.length ? vt.join(", ") : "alle";
            return `<tr data-tpl-id="${esc(t.id)}">
              <td><b>${esc(t.name)}</b></td>
              <td>${esc(t.description || "—")}</td>
              <td>${esc(grpName)}</td>
              <td style="font-size:0.82rem;color:var(--text-secondary,#64748b);">${esc(caStr)}</td>
              <td style="font-size:0.82rem;color:var(--text-secondary,#64748b);">${esc(vtStr)}</td>
              <td style="white-space:nowrap;">
                <button type="button" class="secondary tpl-edit-btn" data-id="${esc(t.id)}" style="padding:2px 10px;margin-right:4px;">Redigér</button>
                <button type="button" class="danger tpl-del-btn" data-id="${esc(t.id)}" style="padding:2px 10px;">Slet</button>
              </td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>`;

      listDiv.querySelectorAll(".tpl-edit-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tpl = templates.find((t) => t.id === btn.dataset.id);
          if (tpl) fillForm(tpl);
          formWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
      listDiv.querySelectorAll(".tpl-del-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tpl = templates.find((t) => t.id === btn.dataset.id);
          if (!tpl) return;
          if (!confirm(`Slet skabelonen "${tpl.name}"?`)) return;
          try {
            await api.deleteTemplate(tpl.id);
            showMsg(`<div class="alert success">Skabelon "${esc(tpl.name)}" slettet.</div>`);
            resetForm();
            await loadAndRender();
          } catch (err) {
            showMsg(`<div class="alert error">Fejl: ${esc(err.message)}</div>`);
          }
        });
      });
    } catch (err) {
      listDiv.innerHTML = `<p class="hint" style="color:#e11d48;">Kunne ikke hente skabeloner: ${esc(err.message)}</p>`;
    }
  }

  newBtn.addEventListener("click", () => {
    resetForm();
    formWrap.classList.remove("hidden");
    formTitle.textContent = "Ny skabelon";
    nameInp.focus();
  });
  cancelBtn.addEventListener("click", resetForm);

  saveBtn.addEventListener("click", async () => {
    clearMsg();
    const payload = buildPayload();
    if (!payload.name) {
      showMsg(`<div class="alert error">Navn er påkrævet.</div>`);
      nameInp.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const id = editIdInp.value;
      if (id) {
        await api.updateTemplate(id, payload);
        showMsg(`<div class="alert success">Skabelon "${esc(payload.name)}" opdateret.</div>`);
      } else {
        await api.createTemplate(payload);
        showMsg(`<div class="alert success">Skabelon "${esc(payload.name)}" oprettet.</div>`);
      }
      resetForm();
      await loadAndRender();
    } catch (err) {
      showMsg(`<div class="alert error">Fejl: ${esc(err.message)}</div>`);
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
    msgEl.innerHTML = `<div class="alert info">Validerer pakke...</div>`;
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
        fileCountEl.textContent = info.file_count;
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
      msgEl.innerHTML = `<div class="alert error">Validering fejlede: ${esc(err.message)}</div>`;
    } finally {
      validateBtn.disabled = false;
    }
  });

  applyBtn.addEventListener("click", async () => {
    if (!validatedFile) return;
    if (!confirm("Anvend opdateringen nu?\n\nFrontend-ændringer aktiveres øjeblikkeligt.\nBackend-ændringer kræver genstart.")) return;
    applyBtn.disabled = true;
    msgEl.innerHTML = `<div class="alert info">Anvender opdatering...</div>`;
    try {
      const res = await api.applyUpdate(validatedFile);
      msgEl.innerHTML = "";
      preview.classList.add("hidden");
      result.classList.remove("hidden");
      const errHtml = res.errors.length
        ? `<div class="alert warning" style="margin-top:0.5rem;">⚠ ${res.errors.length} fejl:<br>${res.errors.map(e => esc(e)).join("<br>")}</div>`
        : "";
      resultMsg.innerHTML =
        `<div class="alert success">✅ Opdatering gennemført — ${res.applied_count} filer opdateret.</div>` +
        errHtml +
        `<p class="hint" style="margin-top:0.5rem;">Frontend-ændringer er aktive nu.<br>Klik <strong>Genstart server</strong> for at aktivere backend-ændringer.</p>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">Opdatering fejlede: ${esc(err.message)}</div>`;
      applyBtn.disabled = false;
    }
  });

  restartBtn.addEventListener("click", async () => {
    if (!confirm("Genstart serveren nu?\n\nPortalen vil være utilgængelig i et par sekunder.")) return;
    restartBtn.disabled = true;
    try {
      await api.restartServer();
      msgEl.innerHTML = `<div class="alert info">Server genstarter... siden genindlæses automatisk om 8 sekunder.</div>`;
      setTimeout(() => window.location.reload(), 8000);
    } catch {
      // Serveren lukker ned — det er forventet at kaldet fejler
      msgEl.innerHTML = `<div class="alert info">Server genstarter... siden genindlæses automatisk om 8 sekunder.</div>`;
      setTimeout(() => window.location.reload(), 8000);
    }
  });
}
