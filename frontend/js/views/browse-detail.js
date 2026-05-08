// Detail modal + ANC status/actions for Browse.
// initDetail wires the detail overlay event handlers and returns { openDetail, closeDetail }.

import { auth } from "../auth.js";
import { esc, fmtDateTime, optionsHtml } from "./browse-utils.js";

export function initDetail(container, state, api, cb) {
  const detailOverlay = container.querySelector("#detail-overlay");
  const detailMsg     = container.querySelector("#detail-msg");
  const msg           = container.querySelector("#msg");

  // ── Open / close ─────────────────────────────────────────────────────────
  async function openDetail(id) {
    state.detailCurrentId = id;
    detailMsg.innerHTML   = `<div class="alert info">Henter detaljer fra ISE...</div>`;
    detailOverlay.classList.remove("hidden");
    try {
      const d = await api.getEndpoint(id);
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
      container.querySelector("#d-psk-show").textContent = "Vis";
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
      badge.textContent = "Fri";
      badge.className   = "anc-badge anc-free";
      quarantineRow.classList.remove("hidden");
      clearRow.classList.add("hidden");
      policySelect.innerHTML = `<option value="">— Vælg ANC policy —</option>` +
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

  container.querySelector("#d-psk-show").addEventListener("click", () => {
    const inp = container.querySelector("#d-psk-key");
    const btn = container.querySelector("#d-psk-show");
    if (inp.type === "password") { inp.type = "text"; btn.textContent = "Skjul"; }
    else { inp.type = "password"; btn.textContent = "Vis"; }
  });

  container.querySelector("#d-psk-gen").addEventListener("click", async () => {
    const btn = container.querySelector("#d-psk-gen");
    btn.disabled = true;
    try {
      const { key } = await api.generatePskKey();
      const inp = container.querySelector("#d-psk-key");
      inp.value = key; inp.type = "text";
      container.querySelector("#d-psk-show").textContent = "Skjul";
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

  return { openDetail, closeDetail };
}
