// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { auth } from "../auth.js";
import { t } from "../i18n.js";

export { applyTheme, initTheme } from "./settings/shared.js";
import { initSettingsTabs } from "./settings/tabs.js";
import { initBackendSection } from "./settings/section-backend.js";
import { initCacheSection } from "./settings/section-cache.js";
import { initPxGridSection } from "./settings/section-pxgrid.js";
import { initPurgeProtectSection } from "./settings/section-purge.js";
import { initRolesSection } from "./settings/section-roles.js";
import { initUsersSection } from "./settings/section-users.js";
import { initTemplatesSection } from "./settings/section-templates.js";
import { initPskPolicySection } from "./settings/section-psk.js";
import { initPortalAuthConfigSection, initLocaleSection } from "./settings/section-auth.js";
import { initSystemUpdateSection, initAdvancedSection, initGithubUpdateSection, initGuestRegSection } from "./settings/section-update.js";
import { initAuthzProfilesSection } from "./settings/section-authz-profiles.js";
import { initBackupSection } from "./settings/section-backup.js";
import { initDiagnosticsSection } from "./settings/section-diagnostics.js";

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
      <button class="settings-tab" data-tab="portal-backup">Backup / Restore</button>
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

    <div class="card" data-tab="portal-performance">
      <h3>Systemdiagnostik</h3>
      <p class="hint">
        Kør et komplet sundhedstjek af alle backend-afhængigheder: Python-pakker,
        HTTP/2-understøttelse, ISE-forbindelse, disk plads, cache, circuit breaker,
        pxGrid og git-status.
      </p>
      <div id="diag-result"></div>
      <div class="actions">
        <button type="button" id="diag-run-btn" class="secondary">Kør diagnostik</button>
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
            <strong>Portalens FQDN skal med her</strong> — pxGrid 2.0 / RFC 6125 validerer server-certifikatet mod det hostnavn klienten forbinder til. Angiv ét eller flere FQDN'er komma-separeret (f.eks. <code>portal.company.lan, hypervision.company.lan</code>).
            Tom = kun node-navnet i SAN, hvilket fejler TLS-validering hvis portalens FQDN afviger fra node-name.
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
            <strong>Upload-mode:</strong> upload tre separate PEM-filer. Filer gemmes i <code>backend/pxgrid/</code> med automatisk path-update.<br>
            <strong style="color:var(--danger,#991b1b);">Vigtigt:</strong> klient-certifikatet og CA-certifikatet <em>skal</em> være i separate filer.
            Klient-cert-filen må kun indeholde portalens eget identitets-certifikat (ét <code>BEGIN CERTIFICATE</code> / <code>END CERTIFICATE</code> blok).
            CA-certifikater uploades separat som CA-bundle — bland dem ikke i klient-cert-filen.
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
              <strong>ISE Internal CA</strong>: Administration → pxGrid Services → Certificates → Generate Certificate → "I have a certificate signing request" → upload CSR → download signeret cert.
              <em>Download kun certifikatet — ikke chain-filen.</em>
              CA-bundle hentes separat: Administration → System → Certificates → Certificate Authority Certificates → eksportér rod-CA'en som PEM (ét certifikat).<br>
              <strong>MS certsrv</strong>: <code>https://&lt;ca&gt;/certsrv/</code> → advanced request → submit CSR (Base 64) → vælg template (typisk "pxGrid Client") → "Download certificate" (<em>ikke</em> "Download certificate chain").
              CA-bundle: forsiden → "Download a CA certificate chain" → konvertér p7b til PEM med <code>openssl pkcs7 -print_certs -in certnew.p7b -out ca-bundle.pem</code>.<br>
              <strong style="color:var(--danger,#991b1b);">Husk:</strong> identitets-certifikatet (trin 3) og CA-bundle (trin 4) skal altid være i to separate filer.
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
            <div id="pxgrid-step5-msg" style="margin-top:0.5rem;"></div>
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
      <button class="settings-subtab" data-subtab="pbc-users">${t("settings.subtab_users")}</button>
      <button class="settings-subtab" data-subtab="pbc-roles">${t("settings.subtab_roles")}</button>
      <button class="settings-subtab" data-subtab="pbc-templates">${t("settings.subtab_templates")}</button>
    </nav>
    <nav class="settings-subtab-nav" data-for-tab="portal-config">
      <button class="settings-subtab" data-subtab="pc-psk">${t("settings.subtab_psk")}</button>
      <button class="settings-subtab" data-subtab="pc-locale">${t("settings.subtab_locale")}</button>
      <button class="settings-subtab" data-subtab="pc-ise-config">${t("settings.subtab_ise_purge")}</button>
      <button class="settings-subtab" data-subtab="pc-authz-profiles">${t("settings.subtab_authz_profiles")}</button>
      <button class="settings-subtab" data-subtab="pc-advanced">${t("settings.subtab_advanced")}</button>
      <button class="settings-subtab" data-subtab="pc-update">${t("settings.subtab_update")}</button>
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
            <label class="radio-label"><input type="radio" name="psk-type" id="psk-type-mpsk" value="MPSK" checked /> <b>MPSK</b> — Multi-PSK (Cisco WLC). PSK-nøglen gemmes uændret i ISE — ingen automatisk ændring af nøgleværdien.</label>
            <label class="radio-label"><input type="radio" name="psk-type" id="psk-type-ipsk" value="IPSK" /> <b>IPSK</b> — Identity PSK (Cisco ISE RADIUS). PSK-nøglen ændres automatisk: portalen tilføjer <code>psk=</code>-prefix på nøglen inden gemning i ISE, så ISE kan genkende den som IPSK.</label>
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
        <div class="actions" style="margin-top:1rem;gap:0.5rem;">
          <button type="button" id="update-apply-btn" class="secondary" disabled></button>
          <button type="button" id="update-apply-restart-btn" class="primary" disabled></button>
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

    <div class="card" data-tab="portal-config" data-subtab="pc-update" id="gh-update-card">
      <h3 id="gh-card-h3"></h3>
      <p class="hint" id="gh-hint"></p>
      <div class="actions">
        <button type="button" id="gh-check-btn"></button>
        <button type="button" id="gh-pull-btn" class="primary" hidden></button>
      </div>
      <div id="gh-msg" style="margin-top:0.75rem;"></div>
      <div id="gh-info" style="margin-top:0.5rem;"></div>
      <div id="gh-release-notes" style="display:none;margin-top:0.75rem;"></div>
      <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border,#e2e8f0);">
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.9rem;">
          <input type="checkbox" id="gh-dev-branch-cb">
          <span id="gh-dev-branch-lbl"></span>
        </label>
        <p class="hint" id="gh-dev-branch-hint" style="margin:0.25rem 0 0 1.5rem;font-size:0.8rem;"></p>
        <div id="gh-dev-branch-result" style="margin-top:0.25rem;margin-left:1.5rem;"></div>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-config" data-subtab="pc-authz-profiles">
      <h3>${t("authzp.card_title")}</h3>
      <p class="hint">${t("authzp.hint")}</p>
      <div id="authzp-msg"></div>

      <h4 style="margin-top:1rem;margin-bottom:.5rem">${t("authzp.standard_title")}</h4>
      <table class="authzp-table">
        <thead>
          <tr>
            <th>${t("authzp.col_name")}</th>
            <th>${t("authzp.col_status")}</th>
            <th>${t("authzp.col_config")}</th>
          </tr>
        </thead>
        <tbody id="authzp-table-body">
          <tr><td colspan="3" class="hint">${t("authzp.checking")}</td></tr>
        </tbody>
      </table>

      <div class="actions" style="margin-top:.75rem">
        <button type="button" id="authzp-check-btn" class="secondary">${t("authzp.btn_check")}</button>
        <button type="button" id="authzp-ensure-btn" disabled>${t("authzp.btn_ensure")}</button>
      </div>

      <h4 style="margin-top:1.5rem;margin-bottom:.5rem">${t("authzp.all_title")}</h4>
      <div id="authzp-all-section">
        <div id="authzp-all-list"></div>
        <div class="actions" style="margin-top:.5rem">
          <button type="button" id="authzp-load-all-btn" class="secondary">${t("authzp.btn_load_all")}</button>
        </div>
      </div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-config" data-subtab="pc-advanced">
      <h3 id="adv-card-h3"></h3>
      <div id="ensure-defs-result" style="margin-bottom:0.75rem;"></div>
      <div class="actions">
        <button type="button" id="ensure-defs-btn" class="secondary"></button>
      </div>
      <hr style="margin:1rem 0;border:none;border-top:1px solid var(--border);">
      <label class="settings-row" style="display:flex;align-items:center;gap:0.75rem;cursor:pointer;">
        <input type="checkbox" id="debug-pxgrid-sessions-cb" />
        <span>
          <span id="debug-pxgrid-sessions-lbl" style="font-weight:500;"></span><br>
          <span id="debug-pxgrid-sessions-hint" style="font-size:0.8em;color:var(--text-muted);"></span>
        </span>
      </label>
      <div id="debug-pxgrid-sessions-result" style="margin-top:0.5rem;"></div>
      <hr style="margin:1rem 0;border:none;border-top:1px solid var(--border);">
      <h4 id="adv-decomm-h4" style="margin:0 0 0.25rem;"></h4>
      <p class="hint" id="adv-decomm-hint"></p>
      <form id="adv-decomm-form" onsubmit="return false;">
        <div class="field">
          <label for="adv-decomm-vlan" id="adv-decomm-vlan-lbl"></label>
          <select id="adv-decomm-vlan" style="max-width:14rem;">
            <option value="" id="adv-decomm-vlan-loading">…</option>
          </select>
          <div class="hint" id="adv-decomm-vlan-hint"></div>
        </div>
        <div class="field">
          <label for="adv-decomm-acl" id="adv-decomm-acl-lbl"></label>
          <select id="adv-decomm-acl" style="max-width:28rem;">
            <option value="" id="adv-decomm-acl-loading">…</option>
          </select>
          <div class="hint" id="adv-decomm-acl-hint"></div>
        </div>
        <div class="actions">
          <button type="submit" id="adv-decomm-save-btn"></button>
        </div>
      </form>
      <div id="adv-decomm-msg" style="margin-top:0.5rem;"></div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-config" data-subtab="pc-advanced" id="guest-reg-card">
      <h3 id="guest-reg-h3"></h3>
      <p class="hint" id="guest-reg-hint"></p>
      <form id="guest-reg-form" onsubmit="return false;">
        <div class="field">
          <label>
            <input type="checkbox" id="guest-reg-enabled" />
            <span id="guest-reg-enabled-lbl" style="font-weight:500;"></span>
          </label>
          <div class="hint" id="guest-reg-url-row">
            ${t("settings.guest_reg_url_prefix")} <code id="guest-reg-url-display"></code>
          </div>
        </div>
        <div class="field">
          <label for="guest-reg-group" id="guest-reg-group-lbl"></label>
          <select id="guest-reg-group" style="max-width:28rem;">
            <option value="">— ${t("settings.guest_reg_group_default")} —</option>
          </select>
          <div class="hint" id="guest-reg-group-hint"></div>
        </div>
        <div class="field">
          <label for="guest-reg-intro-text" id="guest-reg-intro-text-lbl"></label>
          <textarea id="guest-reg-intro-text" rows="2" style="width:100%;resize:vertical;"></textarea>
          <div class="hint" id="guest-reg-intro-text-hint"></div>
        </div>
        <div class="field">
          <label for="guest-reg-success-text" id="guest-reg-success-text-lbl"></label>
          <textarea id="guest-reg-success-text" rows="2" style="width:100%;resize:vertical;"></textarea>
          <div class="hint" id="guest-reg-success-text-hint"></div>
        </div>
        <div class="field">
          <label for="guest-reg-vlan" id="guest-reg-vlan-lbl"></label>
          <select id="guest-reg-vlan" style="max-width:14rem;">
            <option value="">…</option>
          </select>
          <div class="hint" id="guest-reg-vlan-hint"></div>
        </div>
        <div class="field">
          <label for="guest-reg-acl" id="guest-reg-acl-lbl"></label>
          <select id="guest-reg-acl" style="max-width:28rem;">
            <option value="">…</option>
          </select>
          <div class="hint" id="guest-reg-acl-hint"></div>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="guest-reg-ipsk" />
            <span id="guest-reg-ipsk-lbl" style="font-weight:500;"></span>
          </label>
          <div class="hint" id="guest-reg-ipsk-hint"></div>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" id="guest-reg-expiry-enabled" />
            <span id="guest-reg-expiry-enabled-lbl" style="font-weight:500;"></span>
          </label>
          <div class="hint" id="guest-reg-expiry-enabled-hint"></div>
        </div>
        <div id="guest-reg-expiry-options" style="display:none;padding-left:1.2rem;border-left:2px solid var(--border);margin-bottom:0.5rem;">
          <div class="field">
            <label for="guest-reg-expiry-mode" id="guest-reg-expiry-mode-lbl"></label>
            <select id="guest-reg-expiry-mode" style="max-width:16rem;">
              <option value="period" id="guest-reg-expiry-opt-period"></option>
              <option value="date" id="guest-reg-expiry-opt-date"></option>
            </select>
          </div>
          <div class="field" id="guest-reg-expiry-period-row">
            <label for="guest-reg-expiry-days" id="guest-reg-expiry-days-lbl"></label>
            <input type="number" id="guest-reg-expiry-days" min="1" max="3650" style="max-width:6rem;" />
            <div class="hint" id="guest-reg-expiry-days-hint"></div>
          </div>
          <div class="field" id="guest-reg-expiry-date-row" style="display:none;">
            <label for="guest-reg-expiry-date" id="guest-reg-expiry-date-lbl"></label>
            <input type="date" id="guest-reg-expiry-date" style="max-width:14rem;" />
            <div class="hint" id="guest-reg-expiry-date-hint"></div>
          </div>
          <div class="field">
            <label id="guest-reg-expiry-time-lbl"></label>
            <div style="display:flex;gap:0.35rem;align-items:center;max-width:10rem;">
              <select id="guest-reg-expiry-hour" class="expiry-time-sel"></select>
              <span style="font-weight:600;">:</span>
              <select id="guest-reg-expiry-min" class="expiry-time-sel"></select>
            </div>
          </div>
          <div class="field">
            <label for="guest-reg-expiry-check-interval" id="guest-reg-expiry-check-interval-lbl"></label>
            <input type="number" id="guest-reg-expiry-check-interval" min="0" max="86400" step="10" style="max-width:8rem;" />
            <div class="hint" id="guest-reg-expiry-check-interval-hint"></div>
          </div>
        </div>
        <div class="field">
          <label for="guest-reg-redirect" id="guest-reg-redirect-lbl"></label>
          <input type="url" id="guest-reg-redirect" placeholder="https://company.com" style="max-width:28rem;" />
          <div class="hint" id="guest-reg-redirect-hint"></div>
        </div>
        <div class="field">
          <label for="guest-reg-terms" id="guest-reg-terms-lbl"></label>
          <input type="text" id="guest-reg-terms" style="width:100%;" />
          <div class="hint" id="guest-reg-terms-hint"></div>
        </div>
        <div class="actions">
          <button type="submit" id="guest-reg-save-btn" disabled></button>
        </div>
      </form>
      <div id="guest-reg-msg" style="margin-top:0.5rem;"></div>
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="card" data-tab="portal-backup">
      <h3>Backup af portalens konfiguration</h3>
      <p class="hint">
        Backup gemmer alle portalens konfigurationsfiler i ét JSON-dokument.
        <strong>Filen indeholder credentials (ISE password, JWT-secret)</strong> — opbevar den sikkert.
      </p>
      <div id="cfg-backup-msg"></div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start;margin-bottom:1.5rem;">
        <div>
          <h4 style="margin:0 0 0.4rem;">Download backup</h4>
          <p class="hint" style="margin:0 0 0.5rem;">Henter aktuelle indstillinger, brugere, skabeloner og mapping.</p>
          <button id="cfg-backup-btn">Download backup</button>
        </div>
      </div>
      <hr style="border:0;border-top:1px solid var(--border);margin:1rem 0;" />
      <h4>Gendan fra backup</h4>
      <p class="hint">
        Vælg en backup-fil for at gendanne konfigurationen.
        Eksisterende filer overskrives straks — ingen fortryd.
        Genstart backend efterfølgende for at ISE-forbindelsesindstillinger træder i kraft.
      </p>
      <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
        <input type="file" id="cfg-restore-input" accept=".json" />
        <button id="cfg-restore-btn" disabled class="danger">Gendan backup</button>
      </div>
    </div>
    ` : ""}

    </div><!-- /settings-panels -->
  `;

  initSettingsTabs(container, isAdmin, isPskEditorUser);

  if (isAdmin) {
    await initBackendSection(container);
    await initCacheSection(container);
    initDiagnosticsSection(container);
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
    initGithubUpdateSection(container);
    await initAuthzProfilesSection(container);
    initAdvancedSection(container);
    await initGuestRegSection(container);
    initBackupSection(container);
  }
}
