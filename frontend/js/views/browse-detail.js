// Detail modal + ANC status/actions for Browse.
// initDetail wires the detail overlay event handlers and returns { openDetail, closeDetail }.

import { auth } from "../auth.js";
import { t } from "../i18n.js";
import { esc, fmtDateTime, optionsHtml } from "./browse-utils.js";

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

      // Refresh caValues after the detail fetch — auto_discover_values may have
      // written new values to the store during the ISE call above. Must be
      // sequential (not parallel) so the JSON write lands before we read it.
      const caData = await api.listCustomAttributes().catch(() => null);
      if (caData && Array.isArray(caData.attributes)) {
        for (const a of caData.attributes) {
          if (a.name in state.caValues) state.caValues[a.name] = a.values;
        }
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
      container.querySelector("#d-platformtype").innerHTML = optionsHtml(state.caValues.PlatformType, d.platform_type);

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
      if (auth.isEditor()) {
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
    // Reset policy section
    const mb = detailOverlay.querySelector("#d-policy-body");
    const mt = detailOverlay.querySelector("#d-policy-toggle");
    const ma = detailOverlay.querySelector("#d-policy-match-area");
    const wa = detailOverlay.querySelector("#d-policy-wizard-area");
    if (mb) mb.classList.add("hidden");
    if (mt) mt.textContent = "▶ Vis";
    if (ma) ma.innerHTML = "";
    if (wa) wa.innerHTML = "";
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

  // ── Policy section (Idé 1 + 2) ───────────────────────────────────────────
  const policySection = container.querySelector("#d-policy-section");
  const policyToggle  = container.querySelector("#d-policy-toggle");
  const policyBody    = container.querySelector("#d-policy-body");
  const matchArea     = container.querySelector("#d-policy-match-area");
  const wizardArea    = container.querySelector("#d-policy-wizard-area");

  // Show/hide the policy accordion
  policyToggle?.addEventListener("click", () => {
    const collapsed = policyBody.classList.toggle("hidden");
    policyToggle.textContent = collapsed ? "▶ Vis" : "▼ Skjul";
    if (!collapsed && matchArea.innerHTML === "") loadPolicyMatchUI();
  });

  async function loadPolicyMatchUI() {
    matchArea.innerHTML = `<div class="alert info">Henter policy sets…</div>`;
    try {
      const res = await api.listPolicySets();
      const sets = res?.policy_sets || [];
      if (!sets.length) {
        matchArea.innerHTML = `<div class="hint">Ingen policy sets fundet i ISE.</div>`;
        return;
      }
      const opts = sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
      matchArea.innerHTML = `
        <div class="policy-match-bar">
          <select id="d-pol-set-sel">${opts}</select>
          <button type="button" id="d-pol-match-btn" class="secondary small">Simuler match</button>
        </div>
        <div id="d-pol-match-result"></div>
        ${auth.isEditor() ? `<button type="button" id="d-pol-wizard-btn" class="secondary small" style="margin-top:.5rem">+ Opret regel baseret på dette endpoint</button>` : ""}
      `;

      matchArea.querySelector("#d-pol-match-btn").addEventListener("click", async () => {
        const setId = matchArea.querySelector("#d-pol-set-sel")?.value;
        if (!setId || !state.detailCurrentId) return;
        const resultEl = matchArea.querySelector("#d-pol-match-result");
        resultEl.innerHTML = `<div class="alert info">Simulerer…</div>`;
        try {
          const ep = collectEndpointAttrs();
          const result = await api.matchPolicyEndpoint(setId, ep);
          resultEl.innerHTML = renderMatchResult(result);
        } catch (err) {
          resultEl.innerHTML = `<div class="alert error">Simulering fejlede: ${esc(err.message)}</div>`;
        }
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
    return {
      owner:          container.querySelector("#d-owner")?.value || "",
      endpoint_type:  container.querySelector("#d-type")?.value || "",
      lokation:       container.querySelector("#d-lokation")?.value || "",
      authz_vlan:     container.querySelector("#d-authzvlan")?.value || "",
      authz_acl:      container.querySelector("#d-authzacl")?.value || "",
      platform_type:  container.querySelector("#d-platformtype")?.value || "",
      psk_mode:       container.querySelector("#d-psk-mode")?.checked ? "true" : "false",
      description:    container.querySelector("#d-description")?.value || "",
      group_name:     container.querySelector("#d-group")?.selectedOptions[0]?.text || "",
    };
  }

  function renderMatchResult(r) {
    if (r.no_rules) return `<div class="hint">Ingen regler i dette policy set.</div>`;
    if (!r.matched_rule_id) {
      return `<div class="alert warning">Ingen regel matchede — endpoint ville ramme Default/Deny.</div>`;
    }
    const profiles = (r.profiles || []).map((p) => `<span class="profile-chip">${esc(p)}</span>`).join(" ");
    const skipped  = r.condition_details?.filter((c) => c.skipped);
    const checked  = r.condition_details?.filter((c) => !c.skipped);
    const detailRows = checked?.map((c) =>
      `<div class="match-cond-row ${c.matched ? "match-ok" : "match-fail"}">
        ${c.matched ? "✓" : "✗"} ${esc(c.attribute)} ${esc(c.operator)} <em>${esc(c.value)}</em>
      </div>`
    ).join("") || "";
    const skippedNote = skipped?.length
      ? `<div class="hint" style="margin-top:.25rem">⚠ ${skipped.length} betingelse(r) ikke evalueret (RADIUS/reference-attributter kræver live session).</div>`
      : "";
    return `
      <div class="match-result-card match-hit">
        <div class="match-rule-name">✓ Matcher regel: <strong>${esc(r.matched_rule_name)}</strong> (rank ${r.matched_rule_rank})</div>
        <div class="match-profiles">Profiler: ${profiles}</div>
        ${detailRows}
        ${skippedNote}
      </div>`;
  }

  // ── Idé 2: Rule wizard pre-filled from endpoint ───────────────────────────
  function showRuleWizard(setId, setName) {
    const owner    = container.querySelector("#d-owner")?.value || "";
    const type     = container.querySelector("#d-type")?.value || "";
    const lokation = container.querySelector("#d-lokation")?.value || "";
    const group    = container.querySelector("#d-group")?.selectedOptions[0]?.text || "";
    const mac      = container.querySelector("#d-mac")?.textContent || "";

    // Build initial conditions from endpoint attributes
    const initConds = [];
    if (owner)    initConds.push({ dict: "EndPoints", attr: "Owner",   op: "equals", val: owner });
    if (type)     initConds.push({ dict: "EndPoints", attr: "Type",    op: "equals", val: type });
    if (lokation) initConds.push({ dict: "EndPoints", attr: "Lokation",op: "equals", val: lokation });
    if (!initConds.length) initConds.push({ dict: "EndPoints", attr: "Owner", op: "equals", val: "" });

    wizardArea.innerHTML = `
      <div class="policy-wizard-card">
        <div class="wizard-header">
          <strong>Ny regel i: ${esc(setName)}</strong>
          <button type="button" id="d-pol-wizard-close" class="secondary small">✕</button>
        </div>
        <div id="d-pol-wizard-msg"></div>
        <p class="hint">Betingelserne er preudfyldt fra ${esc(mac)}. Tilret og gem.</p>

        <label>Regelnavn
          <input type="text" id="wiz-name" value="Regel for ${esc(mac)}" />
        </label>
        <label>Rank
          <input type="number" id="wiz-rank" value="0" min="0" />
        </label>
        <label>Logik
          <select id="wiz-block-type">
            <option value="AND">Alle betingelser matcher (AND)</option>
            <option value="OR">Mindst én betingelse matcher (OR)</option>
          </select>
        </label>

        <div class="editor-section-label">Betingelser</div>
        <div id="wiz-cond-rows">
          ${initConds.map((c, i) => wizCondRowHtml(i, c)).join("")}
        </div>
        <button type="button" id="wiz-add-cond" class="secondary small">+ Tilføj betingelse</button>

        <div class="editor-section-label">Autoriseringsprofiler</div>
        <div id="wiz-profiles-wrap">${wizProfilesHtml([])}</div>

        <div class="detail-actions">
          <button type="button" id="wiz-save-btn">Opret regel i ISE</button>
          <button type="button" id="wiz-cancel-btn" class="secondary">Annullér</button>
        </div>
      </div>`;

    let wizRowIdx = initConds.length - 1;
    const condRows = wizardArea.querySelector("#wiz-cond-rows");

    condRows.addEventListener("change", (e) => {
      if (e.target.classList.contains("wiz-cond-dict")) {
        const idx = e.target.dataset.idx;
        const attrSel = condRows.querySelector(`.wiz-cond-attr[data-idx="${idx}"]`);
        if (attrSel) attrSel.innerHTML = wizAttrOptions(e.target.value);
      }
    });
    condRows.addEventListener("click", (e) => {
      if (e.target.classList.contains("wiz-cond-del")) {
        condRows.querySelector(`.wiz-cond-row[data-idx="${e.target.dataset.idx}"]`)?.remove();
      }
    });
    wizardArea.querySelector("#wiz-add-cond").addEventListener("click", () => {
      wizRowIdx++;
      condRows.insertAdjacentHTML("beforeend", wizCondRowHtml(wizRowIdx));
    });

    // Profile events
    const profWrap = wizardArea.querySelector("#wiz-profiles-wrap");
    profWrap.addEventListener("click", (e) => {
      if (e.target.classList.contains("profile-tag-del")) e.target.closest(".profile-tag")?.remove();
      if (e.target.id === "wiz-profile-add-btn") {
        const name = profWrap.querySelector("#wiz-profile-preset")?.value ||
                     profWrap.querySelector("#wiz-profile-custom")?.value.trim();
        if (!name) return;
        profWrap.querySelector("#profiles-tags").insertAdjacentHTML("beforeend",
          `<span class="profile-tag" data-p="${esc(name)}">${esc(name)}<button type="button" class="profile-tag-del" data-p="${esc(name)}">✕</button></span>`
        );
        const preset = profWrap.querySelector("#wiz-profile-preset"); if (preset) preset.value = "";
        const custom = profWrap.querySelector("#wiz-profile-custom"); if (custom) custom.value = "";
      }
    });

    wizardArea.querySelector("#wiz-save-btn").addEventListener("click", async () => {
      const msgEl  = wizardArea.querySelector("#d-pol-wizard-msg");
      const name   = wizardArea.querySelector("#wiz-name")?.value.trim();
      const rank   = parseInt(wizardArea.querySelector("#wiz-rank")?.value || "0", 10);
      const bt     = wizardArea.querySelector("#wiz-block-type")?.value || "AND";
      const rows   = readWizRows(wizardArea);
      const cond   = buildWizCondition(rows, bt);
      const profs  = [...wizardArea.querySelectorAll(".profile-tag")].map((t) => t.dataset.p).filter(Boolean);

      if (!name) { msgEl.innerHTML = `<div class="alert error">Angiv et regelnavn.</div>`; return; }
      if (!cond) { msgEl.innerHTML = `<div class="alert error">Tilføj mindst én betingelse.</div>`; return; }
      if (!profs.length) { msgEl.innerHTML = `<div class="alert error">Tilføj mindst én profil.</div>`; return; }

      msgEl.innerHTML = `<div class="alert info">Opretter regel i ISE…</div>`;
      const btn = wizardArea.querySelector("#wiz-save-btn");
      btn.disabled = true;
      try {
        await api.createPolicyRule(setId, { policy_set_id: setId, name, rank, state: "enabled", condition: cond, profiles: profs });
        msgEl.innerHTML = `<div class="alert success">Regel '${esc(name)}' oprettet i ISE!</div>`;
        setTimeout(() => { wizardArea.innerHTML = ""; }, 2000);
      } catch (err) {
        msgEl.innerHTML = `<div class="alert error">Fejl: ${esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    });

    wizardArea.querySelector("#wiz-wizard-close, #wiz-cancel-btn, #d-pol-wizard-close")?.addEventListener("click", () => {
      wizardArea.innerHTML = "";
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
      detailMsg.innerHTML = `<div class="alert error">Kunne ikke generere nøgle: ${err.message}</div>`;
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
      detailMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Show policy section for editors + viewers
  if (auth.isEditor() || auth.getUser()?.role === "viewer") {
    policySection?.classList.remove("hidden");
  }

  return { openDetail, closeDetail };
}

// ── Wizard helpers (module-level) ─────────────────────────────────────────────

const _WIZ_DICTS = [
  { name: "EndPoints",     attrs: ["Owner", "Type", "Lokation", "AuthzVlan", "AuthzACL", "PlatformType", "PSK_Mode"] },
  { name: "IdentityGroup", attrs: ["Name"] },
  { name: "Radius",        attrs: ["Called-Station-ID", "NAS-Port-Type", "User-Name"] },
];
const _WIZ_OPS = [
  { value: "equals",      label: "=" },
  { value: "notEquals",   label: "≠" },
  { value: "contains",    label: "indeholder" },
  { value: "startsWith",  label: "starter med" },
  { value: "endsWith",    label: "slutter med" },
];
const _KNOWN_PROFILES = ["PermitAccess", "DenyAccess", "Endpoint_VLAN", "Endpoint_AirSpaceACL", "Endpoint_PSK-KEY", "Permit_TEMP_ACCESS"];

function _esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function wizAttrOptions(dictName, sel = "") {
  const d = _WIZ_DICTS.find((x) => x.name === dictName);
  return (d ? d.attrs : []).map((a) => `<option value="${a}"${a === sel ? " selected" : ""}>${a}</option>`).join("");
}

function wizCondRowHtml(idx, cond = {}) {
  const dn = cond.dict || "EndPoints";
  const an = cond.attr || "";
  const op = cond.op || "equals";
  const av = cond.val || "";
  const dictOpts = _WIZ_DICTS.map((d) => `<option value="${d.name}"${d.name === dn ? " selected" : ""}>${d.name}</option>`).join("");
  const opOpts   = _WIZ_OPS.map((o) => `<option value="${o.value}"${o.value === op ? " selected" : ""}>${o.label}</option>`).join("");
  return `
    <div class="cond-row wiz-cond-row" data-idx="${idx}">
      <select class="cond-dict wiz-cond-dict" data-idx="${idx}">${dictOpts}</select>
      <select class="cond-attr wiz-cond-attr" data-idx="${idx}">${wizAttrOptions(dn, an)}</select>
      <select class="cond-op  wiz-cond-op"   data-idx="${idx}">${opOpts}</select>
      <input  class="cond-val wiz-cond-val"  data-idx="${idx}" type="text" value="${_esc(av)}" placeholder="værdi" />
      <button class="cond-del secondary small wiz-cond-del" data-idx="${idx}" type="button">✕</button>
    </div>`;
}

function readWizRows(editor) {
  return [...editor.querySelectorAll(".wiz-cond-row")].map((row) => {
    const idx = row.dataset.idx;
    return {
      dict: editor.querySelector(`.wiz-cond-dict[data-idx="${idx}"]`)?.value || "EndPoints",
      attr: editor.querySelector(`.wiz-cond-attr[data-idx="${idx}"]`)?.value || "",
      op:   editor.querySelector(`.wiz-cond-op[data-idx="${idx}"]`)?.value || "equals",
      val:  editor.querySelector(`.wiz-cond-val[data-idx="${idx}"]`)?.value || "",
    };
  });
}

function buildWizCondition(rows, blockType) {
  if (!rows.length) return null;
  const makeAttr = (r) => ({
    conditionType: "ConditionAttributes",
    isNegate: false,
    dictionaryName: r.dict,
    attributeName: r.attr,
    operator: r.op,
    attributeValue: r.val,
  });
  if (rows.length === 1) return makeAttr(rows[0]);
  return {
    conditionType: blockType === "OR" ? "ConditionOrBlock" : "ConditionAndBlock",
    isNegate: false,
    children: rows.map(makeAttr),
  };
}

function wizProfilesHtml(existing = []) {
  const tags = existing.map((p) =>
    `<span class="profile-tag" data-p="${_esc(p)}">${_esc(p)}<button type="button" class="profile-tag-del" data-p="${_esc(p)}">✕</button></span>`
  ).join("");
  const opts = _KNOWN_PROFILES.map((p) => `<option value="${p}">${_esc(p)}</option>`).join("");
  return `
    <div id="profiles-tags">${tags}</div>
    <div class="profiles-add-row">
      <select id="wiz-profile-preset"><option value="">+ vælg profil…</option>${opts}</select>
      <input type="text" id="wiz-profile-custom" placeholder="eller skriv navn…" />
      <button type="button" id="wiz-profile-add-btn" class="secondary small">Tilføj</button>
    </div>`;
}
