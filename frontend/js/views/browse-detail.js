// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Detail modal + ANC status/actions for Browse.
// initDetail wires the detail overlay event handlers and returns { openDetail, closeDetail }.

import { auth } from "../auth.js";
import { t } from "../i18n.js";
import { esc, fmtDateTime, optionsHtml, normalizeMac } from "./browse-utils.js";

function loadFrontendPrefs() {
  try { return JSON.parse(localStorage.getItem("ise_portal_prefs") || "{}"); }
  catch { return {}; }
}
import {
  groupEditorHtml, wireGroupEditor, readGroupCondition, buildCondition,
  profilesHtml, readProfiles, wireProfileEvents,
} from "./policy-condition-builder.js";

export function initDetail(container, state, api, cb) {
  const detailOverlay = container.querySelector("#detail-overlay");
  const detailMsg     = container.querySelector("#detail-msg");
  const msg           = container.querySelector("#msg");

  // ── Open / close ─────────────────────────────────────────────────────────
  async function openDetail(id) {
    state.detailCurrentId = id;
    detailMsg.innerHTML   = `<div class="alert info">${t("alert.loading")}</div>`;
    detailOverlay.classList.remove("hidden");
    try {
      const d = await api.getEndpoint(id);

      // Refresh caValues + DACL list after the detail fetch so the dropdowns
      // always reflect the current ISE state (auto_discover may have written
      // new attribute values; DACLs may have been added/removed in ISE).
      const [caData, freshDacls] = await Promise.all([
        api.listCustomAttributes().catch(() => null),
        api.listDacls().catch(() => null),
      ]);
      if (caData && Array.isArray(caData.attributes)) {
        for (const a of caData.attributes) {
          if (a.name in state.caValues) state.caValues[a.name] = a.values;
        }
      }
      if (freshDacls && Array.isArray(freshDacls)) {
        state.caValues.AuthzACL = freshDacls.map((d) => d.name).filter(Boolean).sort();
      }

      state.detailOriginalGroupId = d.group_id || "";
      container.querySelector("#d-mac").textContent    = d.mac || d.name || "";
      container.querySelector("#d-vendor").textContent = d.vendor || "—";
      container.querySelector("#d-name").textContent   = d.name || "";
      container.querySelector("#d-id").textContent     = d.id || "";
      container.querySelector("#d-group").innerHTML    = cb.groupOptionsHtml(d.group_id);
      container.querySelector("#d-static-group").checked  = !!d.static_group;
      container.querySelector("#d-description").value     = d.description || "";
      container.querySelector("#d-type").innerHTML        = optionsHtml(state.caValues.Type, d.endpoint_type);
      container.querySelector("#d-owner").innerHTML       = optionsHtml(state.caValues.Owner, d.owner);
      container.querySelector("#d-lokation").innerHTML    = optionsHtml(state.caValues.Lokation, d.lokation);
      container.querySelector("#d-authzvlan").innerHTML   = optionsHtml(state.caValues.AuthzVlan, d.authz_vlan);
      container.querySelector("#d-authzacl").innerHTML    = optionsHtml(state.caValues.AuthzACL, d.authz_acl);
      const detailNasPt = state.pxgridSessionData
        ? (state.pxgridSessionData.get(normalizeMac(d.mac || d.name))?.nas_device_type || "")
        : "";
      const detailPtEl = container.querySelector("#d-platformtype");
      detailPtEl.innerHTML = optionsHtml(state.caValues.PlatformType, d.platform_type || detailNasPt);
      detailPtEl.disabled = !!detailNasPt;
      const existingPtBadge = container.querySelector("#d-platformtype-auto-badge");
      if (existingPtBadge) existingPtBadge.remove();
      if (detailNasPt) {
        const badge = document.createElement("span");
        badge.id = "d-platformtype-auto-badge";
        badge.className = "platform-auto-badge";
        badge.title = t("browse.platform_auto_title");
        badge.innerHTML = "&#9889;";
        detailPtEl.parentElement.appendChild(badge);
      }

      const pskModeEl  = container.querySelector("#d-psk-mode");
      const pskKeyEl   = container.querySelector("#d-psk-key");
      const pskKeyLbl  = container.querySelector("#d-psk-key-label");
      const pskKeyWrap = container.querySelector("#d-psk-key-wrap");
      pskModeEl.checked  = !!d.psk_mode;
      pskModeEl.disabled = !state.isPskEditor;
      pskKeyEl.value     = d.psk_key || "";
      pskKeyEl.type      = "password";
      pskKeyEl.disabled  = !state.isPskEditor;
      container.querySelector("#d-psk-show").textContent = t("detail.btn_show");
      const showPskKey = state.isPskEditor || !!d.psk_mode;
      pskKeyLbl.classList.toggle("hidden",  !showPskKey);
      pskKeyWrap.classList.toggle("hidden", !showPskKey);
      container.querySelector("#d-psk-show").classList.toggle("hidden", !state.isPskEditor);
      container.querySelector("#d-psk-gen").classList.toggle("hidden",  !state.isPskEditor);

      const rolesEl = container.querySelector("#d-roles");
      rolesEl.innerHTML       = cb.rolesChipsHtml(d.roles);
      rolesEl.dataset.original = JSON.stringify(d.roles || []);

      container.querySelector("#d-hypervision").textContent  = d.hypervision || "—";
      container.querySelector("#d-profile-id").textContent   = d.profile_id || "—";
      const profilerEl = container.querySelector("#d-profiler-name");
      if (profilerEl) profilerEl.textContent = d.profiler_name || "—";
      container.querySelector("#d-static-profile").textContent = d.static_profile ? "Ja" : "Nej";
      container.querySelector("#d-portal-user").textContent    = d.portal_user || "—";
      const store = [d.identity_store, d.identity_store_id].filter(Boolean).join(" / ");
      container.querySelector("#d-identity-store").textContent = store || "—";
      const createEl = container.querySelector("#d-create-time");
      if (createEl) createEl.textContent = fmtDateTime(d.create_time) || "—";
      const updateEl = container.querySelector("#d-update-time");
      if (updateEl) updateEl.textContent = fmtDateTime(d.update_time) || "—";

      detailMsg.innerHTML = "";

      const ancSection = container.querySelector("#d-anc-section");
      const hideAnc = loadFrontendPrefs().hideAnc === true;
      if (!hideAnc && auth.isEditor()) {
        ancSection.classList.remove("hidden");
        loadAncStatus(id);
      } else {
        ancSection.classList.add("hidden");
      }

    } catch (err) {
      const httpStatus = parseInt(err.message?.split(":")[0], 10) || 0;
      if (httpStatus === 503) {
        detailMsg.innerHTML = `
          <div class="alert warning">
            ISE er midlertidigt utilgængelig — data kan ikke hentes lige nu.<br>
            <button type="button" class="secondary" style="margin-top:.5rem" id="detail-retry-btn">Prøv igen</button>
          </div>`;
        detailMsg.querySelector("#detail-retry-btn")?.addEventListener("click", () => openDetail(id), { once: true });
      } else if (httpStatus === 404) {
        detailMsg.innerHTML = `<div class="alert error">Endpoint ikke fundet i ISE.</div>`;
      } else {
        detailMsg.innerHTML = `<div class="alert error">Fejl ved hentning af endpoint-detaljer — prøv igen eller kontakt administrator.</div>`;
      }
    }
  }

  function closeDetail() {
    detailOverlay.classList.add("hidden");
    state.detailCurrentId = null;
    detailMsg.innerHTML   = "";
    // Reset to Endpoint tab
    _switchTab("endpoint");
    // Clear dynamic content so next open reloads fresh
    const ma = detailOverlay.querySelector("#d-policy-match-area");
    const wa = detailOverlay.querySelector("#d-policy-wizard-area");
    const pc = detailOverlay.querySelector("#d-profiling-content");
    const ic = detailOverlay.querySelector("#d-iseids-content");
    const hc = detailOverlay.querySelector("#d-historik-content");
    if (ma) ma.innerHTML = "";
    if (wa) wa.innerHTML = "";
    if (pc) pc.innerHTML = "";
    if (ic) ic.innerHTML = "";
    if (hc) hc.innerHTML = `<span class="hint">Klik på fanen for at indlæse historik.</span>`;
    const sc = detailOverlay.querySelector("#d-session-debug-content");
    if (sc) sc.innerHTML = `<span class="hint">Klik på fanen for at se session-data.</span>`;
  }

  // ── ANC ──────────────────────────────────────────────────────────────────
  async function ensureAncPolicies() {
    if (!state.ancPoliciesCache) {
      try {
        const res = await api.listAncPolicies();
        state.ancPoliciesCache = res?.policies || [];
      } catch { state.ancPoliciesCache = []; }
    }
    return state.ancPoliciesCache;
  }

  async function loadAncStatus(id) {
    const badge         = container.querySelector("#d-anc-badge");
    const loading       = container.querySelector("#d-anc-loading");
    const quarantineRow = container.querySelector("#d-anc-quarantine-row");
    const clearRow      = container.querySelector("#d-anc-clear-row");
    const policySelect  = container.querySelector("#d-anc-policy");

    loading.classList.remove("hidden");
    badge.classList.add("hidden");

    const [statusRes, policies] = await Promise.all([
      api.ancStatus(id).catch(() => null),
      ensureAncPolicies(),
    ]);

    loading.classList.add("hidden");
    badge.classList.remove("hidden");

    if (statusRes?.quarantined) {
      badge.textContent = `Karantæne: ${statusRes.policy}`;
      badge.className   = "anc-badge anc-quarantined";
      quarantineRow.classList.add("hidden");
      clearRow.classList.remove("hidden");
    } else {
      badge.textContent = t("detail.anc_free");
      badge.className   = "anc-badge anc-free";
      quarantineRow.classList.remove("hidden");
      clearRow.classList.add("hidden");
      policySelect.innerHTML = `<option value="">${t("detail.anc_select")}</option>` +
        policies.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    }
  }

  // ── Event handlers ───────────────────────────────────────────────────────
  container.querySelector("#d-anc-apply").addEventListener("click", async () => {
    if (!state.detailCurrentId) return;
    const policyName = container.querySelector("#d-anc-policy").value;
    if (!policyName) { detailMsg.innerHTML = `<div class="alert error">Vælg en ANC policy først.</div>`; return; }
    const mac = container.querySelector("#d-mac").textContent || "";
    if (!confirm(`Sæt ${mac} i karantæne med ANC policy '${policyName}'?\n\nISE vil sende CoA til klienten.`)) return;
    const btn = container.querySelector("#d-anc-apply");
    btn.disabled = true;
    detailMsg.innerHTML = `<div class="alert info">Sætter i karantæne…</div>`;
    try {
      const res = await api.ancQuarantine(state.detailCurrentId, policyName);
      if (res?.ok) {
        detailMsg.innerHTML = `<div class="alert success">ANC karantæne sat: ${esc(res.message || "OK")}</div>`;
        await loadAncStatus(state.detailCurrentId);
      } else {
        detailMsg.innerHTML = `<div class="alert error">Karantæne fejlede: ${esc(res?.message || "ukendt fejl")}</div>`;
      }
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Karantæne fejlede: ${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
  });

  container.querySelector("#d-anc-clear").addEventListener("click", async () => {
    if (!state.detailCurrentId) return;
    const mac = container.querySelector("#d-mac").textContent || "";
    if (!confirm(`Fjern ANC karantæne fra ${mac}?`)) return;
    const btn = container.querySelector("#d-anc-clear");
    btn.disabled = true;
    detailMsg.innerHTML = `<div class="alert info">Fjerner karantæne…</div>`;
    try {
      const res = await api.ancClear(state.detailCurrentId);
      if (res?.ok) {
        detailMsg.innerHTML = `<div class="alert success">ANC karantæne fjernet: ${esc(res.message || "OK")}</div>`;
        await loadAncStatus(state.detailCurrentId);
      } else {
        detailMsg.innerHTML = `<div class="alert error">Fjern karantæne fejlede: ${esc(res?.message || "ukendt fejl")}</div>`;
      }
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Fjern karantæne fejlede: ${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
  });

  container.querySelector("#d-close").addEventListener("click", closeDetail);
  detailOverlay.addEventListener("click", (e) => { if (e.target === detailOverlay) closeDetail(); });

  // ── Tab switching ─────────────────────────────────────────────────────────
  const tabBtns   = Array.from(container.querySelectorAll(".detail-tab-btn"));
  const tabPanels = Array.from(container.querySelectorAll(".detail-tab-panel"));

  function _switchTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    tabPanels.forEach((p) => p.classList.toggle("hidden", p.id !== `detail-tab-${name}`));
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      _switchTab(tab);
      if (tab === "radius" && matchArea.innerHTML === "") loadPolicyMatchUI();
      if (tab === "profil") _lazyLoadProfil();
      if (tab === "historik") _lazyLoadHistorik();
      if (tab === "session") _lazyLoadSession();
    });
  });

  function _describeAction(e) {
    const LABELS = {
      group_name: "Gruppe", description: "Beskrivelse", endpoint_type: "Type",
      owner: "Owner", lokation: "Lokation", authz_vlan: "VLAN", authz_acl: "ACL",
      platform_type: "Platform", static_group: "Statisk", psk_mode: "PSK",
      psk_key: "PSK-nøgle", profiler_name: "Profil", hypervision: "Portal",
    };
    if (e.action !== "updated" || !e.before || !e.after) return e.action || "";
    const parts = [];
    for (const [k, label] of Object.entries(LABELS)) {
      const bv = e.before[k], av = e.after[k];
      if (JSON.stringify(bv) !== JSON.stringify(av)) {
        const val = String(av ?? "").slice(0, 14);
        parts.push(`${label}:${val}`);
      }
    }
    if (!parts.length) return e.action;
    const s = parts.join(", ");
    return s.length > 32 ? s.slice(0, 31) + "…" : s;
  }

  async function _lazyLoadHistorik() {
    const panel = container.querySelector("#d-historik-content");
    const id = state.detailCurrentId || container.querySelector("#d-id")?.textContent?.trim();
    if (!panel || !id) return;
    panel.innerHTML = `<div class="alert info">Henter historik…</div>`;
    try {
      const res = await api.getEndpointHistory(id, 50);
      const events = res?.events || [];
      if (!events.length) {
        panel.innerHTML = `<div class="hint">Ingen audit-hændelser registreret for dette endpoint.</div>`;
        return;
      }
      panel.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:.85em;">
          <thead><tr>
            <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e5e7eb;">Tidspunkt</th>
            <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e5e7eb;">Bruger</th>
            <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e5e7eb;">Handling</th>
          </tr></thead>
          <tbody>
            ${events.map((e) => `
              <tr style="border-bottom:1px solid #f3f4f6;">
                <td style="padding:4px 6px;white-space:nowrap;">${esc(e.ts?.replace("T", " ").slice(0, 19) || "")}</td>
                <td style="padding:4px 6px;">${esc(e.actor_username || "—")}</td>
                <td style="padding:4px 6px;">${esc(_describeAction(e))}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <p class="hint" style="margin-top:.5rem;">Viser de seneste ${events.length} hændelser.</p>
      `;
    } catch (err) {
      panel.innerHTML = `<div class="alert error">Kunne ikke hente historik: ${esc(err.message)}</div>`;
    }
  }

  // ── ISE Session Debug tab ─────────────────────────────────────────────────
  async function _lazyLoadSession() {
    const panel = container.querySelector("#d-session-debug-content");
    const mac = container.querySelector("#d-mac")?.textContent?.trim();
    if (!panel) return;
    if (!mac || mac === "—") {
      panel.innerHTML = `<span class="hint">Ingen MAC tilgængelig.</span>`;
      return;
    }
    panel.innerHTML = `<div class="alert info">Henter session-data…</div>`;

    function _row(label, value, highlight) {
      const style = highlight ? " style=\"color:#e67e22;font-weight:600;\"" : "";
      return `<tr>
        <td style="padding:3px 8px;color:#6b7280;white-space:nowrap;">${esc(label)}</td>
        <td style="padding:3px 8px;font-family:monospace;"${style}>${esc(String(value ?? "—"))}</td>
      </tr>`;
    }

    // Hent cached session
    let cached = null;
    try { cached = await api.getPxGridSession(mac); } catch (_) { /* ingen session */ }

    const tableStyle = `style="width:100%;border-collapse:collapse;font-size:.85em;margin-bottom:.75rem;"`;
    let html = "";

    if (!cached) {
      html += `<div class="alert warning">Ingen aktiv session i cache for ${esc(mac)}.</div>`;
    } else {
      html += `<h4 style="margin:.5rem 0 .25rem;font-size:.9em;color:#374151;">Cache (hvad frontend ser)</h4>
        <table ${tableStyle}><tbody>
          ${_row("MAC", cached.mac)}
          ${_row("State", cached.state)}
          ${_row("Auth method", cached.auth_method)}
          ${_row("Authz profiles", (cached.authz_profiles||[]).join(", "))}
          ${_row("VLAN", cached.vlan)}
          ${_row("DACL", cached.dacl)}
          ${_row("Policy set", cached.policy_set_name)}
          ${_row("Authz rule", cached.authz_rule_name)}
          ${_row("NAS IP", cached.nas_ip)}
          ${_row("NAS name", cached.nas_name)}
          ${_row("Identity group", cached.identity_group)}
          ${_row("Endpoint policy", cached.endpoint_policy)}
          ${_row("Audit session ID", (cached.audit_session_id||"").slice(0,40))}
          ${_row("Last event", cached.last_event_at)}
        </tbody></table>`;
    }

    html += `<button id="d-session-probe-btn" class="secondary small" style="margin-bottom:.5rem;">Probe MnT (admin)</button>
      <div id="d-session-probe-result"></div>`;

    panel.innerHTML = html;

    panel.querySelector("#d-session-probe-btn")?.addEventListener("click", async () => {
      const resEl = panel.querySelector("#d-session-probe-result");
      resEl.innerHTML = `<div class="alert info">Kalder MnT…</div>`;
      try {
        const dbg = await api.debugPxGridSession(mac);
        const mnt = dbg.mnt_enrichment_result || {};
        const probe = dbg.mnt_probe || {};
        const c = dbg.cached || {};

        const vlanCached = c.vlan || "";
        const vlanMnt = mnt.vlan || "";
        // Mismatch: kun relevant hvis MnT har en ANDEN ikke-tom VLAN end cachen.
        // pxGrid real-time (cache) er altid mere aktuelt end MnT — MnT kan ligge
        // mange minutter bagud efter en re-auth. Cache-værdien er autoritativ.
        const vlanMismatch = vlanCached && vlanMnt && vlanCached !== vlanMnt;

        resEl.innerHTML = `
          <h4 style="margin:.5rem 0 .25rem;font-size:.9em;color:#374151;">MnT enrichment (hvad backend henter)</h4>
          <p style="font-size:.8em;color:#6b7280;margin:0 0 .4rem;">
            pxGrid real-time data (cache) er autoritativ. MnT kan ligge minutter bagud efter re-auth.
          </p>
          <table ${tableStyle}><tbody>
            ${_row("VLAN (cache / pxGrid ✓)", vlanCached)}
            ${_row("VLAN (MnT — kan være forældet)", vlanMnt, vlanMismatch)}
            ${vlanMismatch ? `<tr><td colspan="2" style="padding:3px 8px;color:#e67e22;font-size:.85em;">ℹ MnT er forældet for denne session — pxGrid real-time data foretrækkes. Normal ISE-adfærd.</td></tr>` : ""}
            ${_row("Authz profiles (cache)", (c.authz_profiles||[]).join(", "))}
            ${_row("Authz profiles MnT", mnt.authz_profiles_mnt||"")}
            ${_row("Auth method (MnT)", mnt.auth_method||"")}
            ${_row("Policy set (MnT)", mnt.policy_set_name||"")}
            ${_row("Authz rule (MnT)", mnt.authz_rule_name||"")}
            ${_row("Identity group (MnT)", mnt.identity_group||"")}
            ${_row("Endpoint policy (MnT)", mnt.endpoint_policy||"")}
            ${_row("DACL (MnT)", mnt.dacl||"")}
          </tbody></table>
          <details style="margin-top:.5rem;">
            <summary style="cursor:pointer;font-size:.8em;color:#6b7280;">Raw pxGrid payload</summary>
            <pre style="font-size:.75em;overflow:auto;background:#f9fafb;padding:.5rem;border-radius:4px;max-height:200px;">${esc(JSON.stringify(dbg.pxgrid_raw_all_fields||{}, null, 2))}</pre>
          </details>
          <details style="margin-top:.25rem;">
            <summary style="cursor:pointer;font-size:.8em;color:#6b7280;">Raw MnT probe</summary>
            <pre style="font-size:.75em;overflow:auto;background:#f9fafb;padding:.5rem;border-radius:4px;max-height:200px;">${esc(JSON.stringify(probe, null, 2))}</pre>
          </details>`;
      } catch (err) {
        resEl.innerHTML = `<div class="alert error">Debug fejlede: ${esc(err.message)} (kræver admin-rolle)</div>`;
      }
    });
  }

  // ── Policy areas ──────────────────────────────────────────────────────────
  const matchArea  = container.querySelector("#d-policy-match-area");
  const wizardArea = container.querySelector("#d-policy-wizard-area");

  async function loadPolicyMatchUI() {
    matchArea.innerHTML = `<div class="alert info">${t("detail.policy_loading")}</div>`;
    try {
      const res = await api.listPolicySets();
      const sets = res?.policy_sets || [];
      if (!sets.length) {
        matchArea.innerHTML = `<div class="hint">${t("detail.policy_none")}</div>`;
        return;
      }
      const opts = sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
      matchArea.innerHTML = `
        <datalist id="d-radius-attrs-list">
          <option value="Called-Station-ID">
          <option value="NAS-Port-Type">
          <option value="NAS-Identifier">
          <option value="NAS-IP-Address">
          <option value="User-Name">
          <option value="Framed-IP-Address">
          <option value="Service-Type">
          <option value="Calling-Station-Id">
          <option value="EAP-Type">
          <option value="AuthenticationMethod">
        </datalist>
        <div class="policy-match-bar">
          <select id="d-pol-set-sel">${opts}</select>
          <button type="button" id="d-pol-match-btn" class="secondary small">${t("detail.policy_simulate")}</button>
        </div>
        <div class="radius-section">
          <div class="radius-section-header">
            <span class="radius-prompt-title">RADIUS-parametre (præciser match):</span>
            <button type="button" id="d-pol-radius-add" class="secondary small">+ Tilføj parameter</button>
          </div>
          <div class="radius-section-hint">Én attribut = én enkelt værdi — som i en rigtig RADIUS-pakke. For at matche <em>contains "hus"</em> OG <em>contains "802"</em> i samme regel: skriv én value der indeholder begge, fx <code>hus-802</code>.</div>
          <div id="d-pol-radius-rows"></div>
        </div>
        <div id="d-pol-match-result"></div>
        ${auth.isEditor() ? `<button type="button" id="d-pol-wizard-btn" class="secondary small" style="margin-top:.5rem">${t("detail.policy_create_rule")}</button>` : ""}
      `;

      function addRadiusRow(key = "", val = "") {
        const rowsEl = matchArea.querySelector("#d-pol-radius-rows");
        const row = document.createElement("div");
        row.className = "radius-attr-row";
        row.innerHTML = `
          <input type="text" class="radius-attr-key" list="d-radius-attrs-list" placeholder="Attribut (fx NAS-Port-Type)" value="${esc(key)}" />
          <input type="text" class="radius-attr-val" placeholder="Værdi" value="${esc(val)}" />
          <button type="button" class="radius-row-remove secondary small" title="Fjern">✕</button>
        `;
        row.querySelector(".radius-row-remove").addEventListener("click", () => row.remove());
        rowsEl.appendChild(row);
      }

      function readRadiusAttrs() {
        const attrs = {};
        matchArea.querySelectorAll(".radius-attr-row").forEach((row) => {
          const k = row.querySelector(".radius-attr-key")?.value.trim();
          const v = row.querySelector(".radius-attr-val")?.value.trim();
          if (k && v) attrs[k] = v;
        });
        return attrs;
      }

      function mergeNeededRadiusAttrs(needed) {
        const existingKeys = new Set(
          Array.from(matchArea.querySelectorAll(".radius-attr-key"))
            .map((el) => el.value.trim())
            .filter(Boolean)
        );
        for (const attr of (needed || [])) {
          if (!existingKeys.has(attr)) addRadiusRow(attr, "");
        }
      }

      async function runSimulate(setId) {
        const resultEl = matchArea.querySelector("#d-pol-match-result");

        // Detect duplicate attribute keys before simulating
        const keyCount = {};
        matchArea.querySelectorAll(".radius-attr-row").forEach((row) => {
          const k = row.querySelector(".radius-attr-key")?.value.trim();
          if (k) keyCount[k] = (keyCount[k] || 0) + 1;
        });
        const duplicates = Object.keys(keyCount).filter((k) => keyCount[k] > 1);
        matchArea.querySelectorAll(".radius-attr-row").forEach((row) => {
          const k = row.querySelector(".radius-attr-key")?.value.trim();
          row.classList.toggle("radius-row-duplicate", duplicates.includes(k));
        });
        if (duplicates.length) {
          resultEl.innerHTML = `<div class="alert warning">
            ⚠ Duplikerede RADIUS-nøgler: <strong>${esc(duplicates.join(", "))}</strong><br>
            En RADIUS-pakke har én enkelt værdi per attribut. Skriv én samlet værdi der matcher alle betingelser i reglen — fx <em>hus-802</em> i stedet for to separate rækker.
          </div>`;
          return;
        }

        resultEl.innerHTML = `<div class="alert info">Simulerer…</div>`;
        try {
          const radiusAttrs = readRadiusAttrs();
          const ep = { ...collectEndpointAttrs(), radius_attrs: radiusAttrs };
          const result = await api.matchPolicyEndpoint(setId, ep);
          resultEl.innerHTML = renderMatchResult(result);
          mergeNeededRadiusAttrs(result.radius_attrs_needed || []);
        } catch (err) {
          resultEl.innerHTML = `<div class="alert error">Simulering fejlede: ${esc(err.message)}</div>`;
        }
      }

      matchArea.querySelector("#d-pol-radius-add").addEventListener("click", () => {
        addRadiusRow();
      });

      matchArea.querySelector("#d-pol-match-btn").addEventListener("click", () => {
        const setId = matchArea.querySelector("#d-pol-set-sel")?.value;
        if (!setId || !state.detailCurrentId) return;
        runSimulate(setId);
      });

      matchArea.querySelector("#d-pol-wizard-btn")?.addEventListener("click", () => {
        const setId = matchArea.querySelector("#d-pol-set-sel")?.value;
        if (!setId) return;
        const setName = sets.find((s) => s.id === setId)?.name || setId;
        showRuleWizard(setId, setName);
      });
    } catch (err) {
      matchArea.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
    }
  }

  function collectEndpointAttrs() {
    const epId = state.detailCurrentId || "";
    if (epId) {
      // Let the backend fetch live attributes directly from ISE so the
      // simulation is always based on current ISE data, not stale form values.
      return { endpoint_id: epId };
    }
    // Fallback for cases where no endpoint ID is available (should not happen in practice)
    return {
      owner:          container.querySelector("#d-owner")?.value || "",
      endpoint_type:  container.querySelector("#d-type")?.value || "",
      lokation:       container.querySelector("#d-lokation")?.value || "",
      authz_vlan:     container.querySelector("#d-authzvlan")?.value || "",
      authz_acl:      container.querySelector("#d-authzacl")?.value || "",
      platform_type:  container.querySelector("#d-platformtype")?.value || "",
      psk_mode:       container.querySelector("#d-psk-mode")?.checked ? "true" : "false",
      description:    container.querySelector("#d-description")?.value || "",
      group_name:     (state.groups || []).find((g) => g.id === (container.querySelector("#d-group")?.value || ""))?.name || "",
    };
  }

  function renderMatchResult(r) {
    if (r.no_rules) return `<div class="hint">${t("detail.policy_no_rules")}</div>`;
    if (!r.matched_rule_id) {
      return `<div class="alert warning">${t("detail.policy_no_match")}</div>`;
    }
    const profiles    = (r.profiles || []).map((p) => `<span class="profile-chip">${esc(p)}</span>`).join(" ");
    const profilesRow = `<div class="match-profiles">${t("detail.policy_profiles")} ${profiles}</div>`;
    const subRules    = r.sub_rules || [];
    const hasSubs     = subRules.length > 1;

    // Renders a single MatchedCondition row
    function condRow(c) {
      if (c.skipped) {
        const isRef = c.operator === "ref";
        const label = isRef
          ? `<span class="match-cond-ref">${esc(c.attribute)}</span>`
          : `${esc(c.attribute)} <span class="match-cond-op">${esc(c.operator)}</span> <em>${esc(c.value)}</em>`;
        return `<div class="match-cond-row match-skip">? ${label}</div>`;
      }
      return `<div class="match-cond-row ${c.matched ? "match-ok" : "match-fail"}">
        ${c.matched ? "✓" : "✗"} ${esc(c.attribute)} ${esc(c.operator)} <em>${esc(c.value)}</em>
      </div>`;
    }

    // Global conditions (outside OR branches)
    const globalRows = (r.condition_details || []).map(condRow).join("");

    if (r.partial_match) {
      const allSkippedCount = (r.condition_details || []).filter(c => c.skipped).length
        + subRules.reduce((n, sr) => n + sr.conditions.filter(c => c.skipped).length, 0);
      const note = allSkippedCount
        ? `<div class="match-partial-note">${t("detail.policy_partial_match").replace("{n}", allSkippedCount)}</div>`
        : "";
      const matchedLine = t("detail.policy_possible_match")
        .replace("{name}", esc(r.matched_rule_name))
        .replace("{rank}", r.matched_rule_rank);

      let body;
      if (hasSubs) {
        const subHtml = subRules.map((sr) => {
          const srRows = sr.conditions.map(condRow).join("");
          return `<div class="match-subrule">
            <div class="match-subrule-label">Sub rule ${sr.index}:</div>
            ${srRows}
            ${profilesRow}
          </div>`;
        }).join("");
        body = `${globalRows}${note}${subHtml}`;
      } else {
        // Flat view (no OR branches or single branch)
        const flatRows = subRules.flatMap(sr => sr.conditions).map(condRow).join("");
        body = `${profilesRow}${globalRows}${flatRows}${note}`;
      }
      return `
        <div class="match-result-card match-possible">
          <div class="match-rule-name"><strong>${matchedLine}</strong></div>
          ${body}
        </div>`;
    }

    // Full match
    const allRows = globalRows + subRules.flatMap(sr => sr.conditions).map(condRow).join("");
    const matchedLine = t("detail.policy_matched")
      .replace("{name}", esc(r.matched_rule_name))
      .replace("{rank}", r.matched_rule_rank);
    return `
      <div class="match-result-card match-hit">
        <div class="match-rule-name"><strong>${matchedLine}</strong></div>
        ${profilesRow}
        ${allRows}
      </div>`;
  }


  // ── Idé 2: Rule wizard pre-filled from endpoint ───────────────────────────
  function showRuleWizard(setId, setName) {
    const mac = container.querySelector("#d-mac")?.textContent || "";

    // Read all endpoint attribute values once.
    const pskActive  = container.querySelector("#d-psk-mode")?.checked === true;
    const authzVlan  = container.querySelector("#d-authzvlan")?.value || "";
    const authzAcl   = container.querySelector("#d-authzacl")?.value  || "";
    const groupSelId = container.querySelector("#d-group")?.value || "";
    const groupName  = (state.groups || []).find((g) => g.id === groupSelId)?.name || "";

    const epAttrs = [
      { attr: "Owner",       val: container.querySelector("#d-owner")?.value || "" },
      { attr: "Type",        val: container.querySelector("#d-type")?.value || "" },
      { attr: "Lokation",    val: container.querySelector("#d-lokation")?.value || "" },
      { attr: "PlatformType",val: container.querySelector("#d-platformtype")?.value || "" },
    ];

    const initConds = epAttrs
      .filter((x) => x.val)
      .map((x) => ({ dict: "EndPoints", attr: x.attr, op: "equals", val: x.val }));

    if (pskActive) {
      initConds.push({ dict: "EndPoints", attr: "PSK_Mode", op: "equals", val: "true" });
    }
    if (groupName && groupName !== "—" && groupName.toLowerCase() !== "unknown") {
      initConds.push({ dict: "IdentityGroup", attr: "Name", op: "equals", val: groupName });
    }
    if (!initConds.length) initConds.push({ dict: "EndPoints", attr: "Owner", op: "equals", val: "" });

    // Extend caValues with group names so the IdentityGroup:Name condition gets a dropdown.
    const wizCaValues = {
      ...state.caValues,
      __IdentityGroup_Name__: (state.groups || []).map((g) => g.name).filter(Boolean),
    };

    // Authorization profiles derived from endpoint's authz attributes.
    // pskActive uses the SAME flag as the condition above — they can never be out of sync.
    const initProfiles = [];
    if (authzVlan) initProfiles.push("Endpoint_VLAN");
    if (authzAcl)  initProfiles.push("Endpoint_DACL");
    if (pskActive) initProfiles.push("Endpoint_PSK-KEY");

    const defaultRuleName = t("detail.wiz_default_name").replace("{mac}", mac.replace(/:/g, "-"));
    wizardArea.innerHTML = `
      <div class="policy-wizard-card">
        <div class="wizard-header">
          <strong>${t("detail.wiz_title").replace("{set}", esc(setName))}</strong>
          <button type="button" id="d-pol-wizard-close" class="secondary small">✕</button>
        </div>
        <div id="d-pol-wizard-msg"></div>
        <p class="hint">${t("detail.wiz_hint").replace("{mac}", esc(mac))}</p>

        <label>${t("detail.wiz_name_label")}
          <input type="text" id="wiz-name" value="${esc(defaultRuleName)}" />
        </label>
        <label>${t("detail.wiz_rank_label")}
          <input type="number" id="wiz-rank" value="0" min="0" />
        </label>
        <div class="editor-section-label">${t("detail.wiz_conds_label")}</div>
        <div id="wiz-cond-editor">${groupEditorHtml(buildCondition(initConds, "AND"), wizCaValues)}</div>

        <div class="editor-section-label">${t("detail.wiz_profiles_label")}</div>
        <div id="wiz-profiles-wrap">${profilesHtml(initProfiles)}</div>

        <div class="detail-actions">
          <button type="button" id="wiz-save-btn">${t("detail.wiz_save_btn")}</button>
          <button type="button" id="wiz-cancel-btn" class="secondary">${t("btn.cancel")}</button>
        </div>
      </div>`;

    const condEditorEl = wizardArea.querySelector("#wiz-cond-editor");
    const profilesWrap = wizardArea.querySelector("#wiz-profiles-wrap");

    wireGroupEditor(condEditorEl, wizCaValues);
    wireProfileEvents(profilesWrap);

    wizardArea.querySelector("#d-pol-wizard-close").addEventListener("click", () => {
      wizardArea.innerHTML = "";
    });
    wizardArea.querySelector("#wiz-cancel-btn").addEventListener("click", () => {
      wizardArea.innerHTML = "";
    });

    wizardArea.querySelector("#wiz-save-btn").addEventListener("click", async () => {
      const msgEl = wizardArea.querySelector("#d-pol-wizard-msg");
      const name  = wizardArea.querySelector("#wiz-name")?.value.trim();
      const rank  = parseInt(wizardArea.querySelector("#wiz-rank")?.value || "0", 10);
      const cond  = readGroupCondition(condEditorEl);
      const profs = readProfiles(profilesWrap);

      if (!name) { msgEl.innerHTML = `<div class="alert error">${t("detail.wiz_err_name")}</div>`; return; }
      if (!cond) { msgEl.innerHTML = `<div class="alert error">${t("detail.wiz_err_cond")}</div>`; return; }
      if (!profs.length) { msgEl.innerHTML = `<div class="alert error">${t("detail.wiz_err_profile")}</div>`; return; }

      msgEl.innerHTML = `<div class="alert info">${t("detail.wiz_saving")}</div>`;
      const btn = wizardArea.querySelector("#wiz-save-btn");
      btn.disabled = true;
      try {
        await api.createPolicyRule(setId, { policy_set_id: setId, name, rank, state: "enabled", condition: cond, profiles: profs });
        msgEl.innerHTML = `<div class="alert success">${t("detail.wiz_saved").replace("{name}", esc(name))}</div>`;
        setTimeout(() => { wizardArea.innerHTML = ""; }, 2000);
      } catch (err) {
        msgEl.innerHTML = `<div class="alert error">${t("alert.error")}: ${esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    });
  }

  container.querySelector("#d-psk-show").addEventListener("click", () => {
    const inp = container.querySelector("#d-psk-key");
    const btn = container.querySelector("#d-psk-show");
    if (inp.type === "password") { inp.type = "text"; btn.textContent = t("detail.btn_hide"); }
    else { inp.type = "password"; btn.textContent = t("detail.btn_show"); }
  });

  container.querySelector("#d-psk-gen").addEventListener("click", async () => {
    const btn = container.querySelector("#d-psk-gen");
    btn.disabled = true;
    try {
      const { key } = await api.generatePskKey();
      const inp = container.querySelector("#d-psk-key");
      inp.value = key; inp.type = "text";
      container.querySelector("#d-psk-show").textContent = t("detail.btn_hide");
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Kunne ikke generere nøgle: ${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
  });

  container.querySelector("#d-disconnect").addEventListener("click", async () => {
    if (!state.detailCurrentId) return;
    const mac = container.querySelector("#d-mac").textContent || "";
    if (!confirm(
      `CoA Disconnect ${mac}?\n\n` +
      `Klienten bliver deautentificeret på WLC/switch og skal gen-associere. ` +
      `Ny IP kun hvis VLAN/subnet er ændret eller DHCP-lease er udløbet.`,
    )) return;
    const btn = container.querySelector("#d-disconnect");
    btn.disabled = true;
    detailMsg.innerHTML = `<div class="alert info">Sender CoA Disconnect...</div>`;
    try {
      const res = await api.coaDisconnect(state.detailCurrentId);
      if (res?.ok) {
        detailMsg.innerHTML = `<div class="alert success">Disconnect sendt: ${esc(res.message || "OK")}</div>`;
      } else {
        detailMsg.innerHTML = `<div class="alert error">Disconnect fejlede: ${esc(res?.message || "ukendt fejl")}</div>`;
      }
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">Disconnect fejlede: ${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
  });

  container.querySelector("#d-save").addEventListener("click", async () => {
    if (!state.detailCurrentId) return;
    const saveBtn = container.querySelector("#d-save");
    saveBtn.disabled = true;
    detailMsg.innerHTML = `<div class="alert info">Gemmer...</div>`;

    const selectedGroupId  = container.querySelector("#d-group").value;
    const staticGroup      = container.querySelector("#d-static-group").checked;
    const groupChanged     = selectedGroupId !== state.detailOriginalGroupId;
    let group_id = null, static_group_assignment = null;
    if (groupChanged) {
      if (!selectedGroupId) {
        const unknownGroup = state.groups.find((g) => g.name.toLowerCase() === "unknown");
        if (unknownGroup) { group_id = unknownGroup.id; static_group_assignment = false; }
      } else { group_id = selectedGroupId; static_group_assignment = staticGroup; }
    } else if (selectedGroupId) {
      static_group_assignment = staticGroup;
    }

    const dRolesEl = container.querySelector("#d-roles");
    const checkedChips = dRolesEl.querySelectorAll(".row-role-chip:checked");
    const selectedCatalogRoles = Array.from(checkedChips).map((cbEl) => cbEl.dataset.role);
    let originalRoles = [];
    try { originalRoles = JSON.parse(dRolesEl.dataset.original || "[]"); } catch { /* ignore */ }
    const catalogLower  = new Set(state.roleCatalog.map((c) => c.name.toLowerCase()));
    const externalRoles = originalRoles.filter((r) => !catalogLower.has((r || "").toLowerCase()));
    const hypervisionRoles = [...externalRoles, ...selectedCatalogRoles].join(",");

    const customAttrs = {
      Type: container.querySelector("#d-type").value,
      Owner: container.querySelector("#d-owner").value,
      Lokation: container.querySelector("#d-lokation").value,
      AuthzVlan: container.querySelector("#d-authzvlan").value,
      AuthzACL: container.querySelector("#d-authzacl").value,
      PlatformType: container.querySelector("#d-platformtype").value,
      HypervisionRoles: hypervisionRoles,
    };
    if (state.isPskEditor) {
      customAttrs.PSK_Mode = container.querySelector("#d-psk-mode").checked ? "true" : "false";
      customAttrs.PSK_Key  = container.querySelector("#d-psk-key").value;
    }

    try {
      await api.updateEndpoint(state.detailCurrentId, {
        description: container.querySelector("#d-description").value,
        group_id, static_group_assignment,
        custom_attributes: customAttrs,
      });
      const savedId    = state.detailCurrentId;
      const platformType = container.querySelector("#d-platformtype").value;
      let coaSummary = "";
      if (state.coaOnSave) {
        const action = state.coaByLocal.get(platformType) === "disconnect" ? "disconnect" : "reauth";
        detailMsg.innerHTML = `<div class="alert info">Gemt — udløser CoA ${action}...</div>`;
        const coa = await cb.runCoaForIds([{ id: savedId, platformType }]);
        coaSummary = coa.ok ? ` CoA ${action} sendt.` : (coa.failures.length ? ` CoA fejlede: ${coa.failures[0].msg}` : "");
      }
      closeDetail();
      await cb.refreshRows([savedId]);
      msg.innerHTML = `<div class="alert success">Endpoint gemt.${coaSummary}</div>`;
    } catch (err) {
      detailMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ── Profil & IDs tab — lazy-load ──────────────────────────────────────────
  const profilingContent = container.querySelector("#d-profiling-content");
  const iseidContent     = container.querySelector("#d-iseids-content");

  function _renderProfilingAttrTable(attributes) {
    const rows = Object.entries(attributes)
      .map(([k, v]) => {
        const valStr = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
        return `<tr><td class="profiling-attr-key">${esc(k)}</td><td class="profiling-attr-val">${esc(valStr)}</td></tr>`;
      })
      .join("");
    return `<table class="profiling-attr-table"><tbody>${rows}</tbody></table>`;
  }

  function _renderProfilingData(data) {
    const sections = data?.sections || [];
    if (!sections.length) {
      return `<div class="hint">${t("detail.profiling_empty")}</div>`;
    }
    return sections
      .map((sec) => `
        <div class="profiling-section">
          <div class="profiling-section-label">${esc(sec.label)}</div>
          ${_renderProfilingAttrTable(sec.attributes)}
        </div>`)
      .join("");
  }

  async function _lazyLoadProfil() {
    if (!state.detailCurrentId) return;
    const promises = [];
    if (profilingContent.innerHTML === "") {
      profilingContent.innerHTML = `<div class="alert info">${t("alert.loading")}</div>`;
      promises.push(
        api.getProfilingData(state.detailCurrentId)
          .then((data) => { profilingContent.innerHTML = _renderProfilingData(data); })
          .catch((err) => { profilingContent.innerHTML = `<div class="alert error">${t("detail.profiling_error")}: ${esc(err.message)}</div>`; })
      );
    }
    if (iseidContent.innerHTML === "") {
      iseidContent.innerHTML = `<div class="alert info">${t("alert.loading")}</div>`;
      promises.push(
        api.getProfilerProfile(state.detailCurrentId)
          .then((data) => { iseidContent.innerHTML = _renderProfilerProfile(state.detailCurrentId, data); })
          .catch((err) => { iseidContent.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; })
      );
    }
    await Promise.all(promises);
  }

  // ── ISE IDs & Profil renderer ─────────────────────────────────────────────
  function _renderProfilerProfile(endpointId, data) {
    const profileId = data?.profile_id;
    const profile   = data?.profile;

    const idRows = `
      <table class="profiling-attr-table">
        <tbody>
          <tr><td class="profiling-attr-key">${t("detail.iseids_endpoint_id")}</td>
              <td class="profiling-attr-val mono">${esc(endpointId || "—")}</td></tr>
          <tr><td class="profiling-attr-key">${t("detail.iseids_profile_id")}</td>
              <td class="profiling-attr-val mono">${esc(profileId || "—")}</td></tr>
        </tbody>
      </table>`;

    if (!profile) {
      return `<div class="profiling-section">
        <div class="profiling-section-label">${t("detail.iseids_ids_label")}</div>
        ${idRows}
        <div class="hint">${t("detail.iseids_no_profile")}</div>
      </div>`;
    }

    const LABEL_MAP = {
      name:               t("detail.iseids_prof_name"),
      description:        t("detail.iseids_prof_desc"),
      minCertaintyFactor: t("detail.iseids_prof_certainty"),
      systemDefined:      t("detail.iseids_prof_system"),
      exceptionAction:    t("detail.iseids_prof_exception"),
    };
    const ORDER = ["name", "description", "minCertaintyFactor", "systemDefined", "exceptionAction"];
    const shown = new Set();

    const mainRows = ORDER
      .filter((k) => k in profile)
      .map((k) => {
        shown.add(k);
        const val = profile[k];
        const valStr = typeof val === "boolean" ? (val ? "Ja" : "Nej") : String(val ?? "—");
        return `<tr><td class="profiling-attr-key">${esc(LABEL_MAP[k] || k)}</td>
                    <td class="profiling-attr-val">${esc(valStr)}</td></tr>`;
      }).join("");

    const extraRows = Object.entries(profile)
      .filter(([k]) => !shown.has(k) && k !== "id")
      .map(([k, v]) => {
        const valStr = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v ?? "—");
        return `<tr><td class="profiling-attr-key">${esc(k)}</td>
                    <td class="profiling-attr-val mono">${esc(valStr)}</td></tr>`;
      }).join("");

    const profileTable = `<table class="profiling-attr-table"><tbody>${mainRows}${extraRows}</tbody></table>`;

    return `
      <div class="profiling-section">
        <div class="profiling-section-label">${t("detail.iseids_ids_label")}</div>
        ${idRows}
      </div>
      <div class="profiling-section">
        <div class="profiling-section-label">${t("detail.iseids_profile_label")}</div>
        ${profileTable}
      </div>`;
  }

  return { openDetail, closeDetail };
}

