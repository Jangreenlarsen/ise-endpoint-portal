import { api } from "../api.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const ATTR_LABELS = {
  Type: "Type",
  Owner: "Ejer (Owner)",
  Lokation: "Lokation",
  AuthzVlan: "Authz VLAN",
  PlatformType: "Platform-type (lokale labels)",
};
// AuthzACL is also a managed attribute, but its values mirror the DACLs in ISE
// rather than a free-text store. It is administered on its own page (ACL).

// Faste raw-værdier som ISE MnT kan rapportere — bruges i mapping-editoren.
const KNOWN_RAW = ["airos", "iosxe", "iossw", "nxos", "meraki"];
const COA_OPTIONS = [
  { value: "reauth", label: "CoA Reauth" },
  { value: "disconnect", label: "CoA Disconnect" },
];

export async function renderAttributes(container) {
  container.innerHTML = `
    <h2>Attribut-vaerdier</h2>
    <p class="hint">
      Administrer de tilladte vaerdier for hvert custom attribute.
      Vaerdierne bruges i dropdowns ved oprettelse og redigering af endpoints.
    </p>
    <div id="attr-msg"></div>
    <div id="attr-sections"></div>
    <div class="card" style="margin-top:1rem;">
      <button id="sync-btn">Sync fra ISE</button>
      <span class="hint" style="margin-left:0.5rem;">Scanner endpoints i ISE og importerer fundne vaerdier.</span>
      <div id="sync-result"></div>
    </div>
  `;

  const sections = container.querySelector("#attr-sections");
  const attrMsg = container.querySelector("#attr-msg");

  function renderMappingEditor(localValues, mapping) {
    const localOptions = (selected) => {
      const opts = [`<option value="">— ingen —</option>`];
      for (const v of localValues) {
        const sel = v === selected ? " selected" : "";
        opts.push(`<option value="${esc(v)}"${sel}>${esc(v)}</option>`);
      }
      return opts.join("");
    };
    const coaOptions = (selected) =>
      COA_OPTIONS.map((o) => {
        const sel = o.value === selected ? " selected" : "";
        return `<option value="${o.value}"${sel}>${o.label}</option>`;
      }).join("");
    const rows = mapping.mappings.map((m) => `
      <tr data-raw="${esc(m.raw)}">
        <td><code>${esc(m.raw)}</code></td>
        <td>
          <select class="map-local" data-raw="${esc(m.raw)}">
            ${localOptions(m.local)}
          </select>
        </td>
        <td>
          <select class="map-coa" data-raw="${esc(m.raw)}">
            ${coaOptions(m.coa)}
          </select>
        </td>
      </tr>`).join("");
    return `
      <div class="platform-mapping" style="margin-top:0.8rem;">
        <h4 style="margin:0.4rem 0;">Raw → lokal mapping (1-til-1)</h4>
        <p class="hint" style="margin:0 0 0.4rem 0;">
          Hver ISE-raw-vaerdi bindes til ét lokalt label og en CoA-metode.
          MnT-sync skriver det lokale label til endpoint; CoA-on-save bruger den valgte metode.
        </p>
        <table class="platform-mapping-table" style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:0.3rem;">ISE raw</th>
              <th style="text-align:left;padding:0.3rem;">Lokalt label</th>
              <th style="text-align:left;padding:0.3rem;">CoA-metode</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;">
          <button class="small platform-mapping-save" type="button">Gem mapping</button>
          <span class="platform-mapping-result hint"></span>
        </div>
      </div>`;
  }

  async function render() {
    attrMsg.innerHTML = "";
    try {
      const [data, mapping] = await Promise.all([
        api.listCustomAttributes(),
        api.getPlatformMapping().catch(() => ({ mappings: [] })),
      ]);
      const attrMap = {};
      for (const a of data.attributes) attrMap[a.name] = a.values;

      sections.innerHTML = Object.entries(ATTR_LABELS).map(([name, label]) => {
        const values = attrMap[name] || [];
        const tags = values.length
          ? values.map((v) => `
              <span class="attr-tag">
                ${esc(v)}
                <button class="attr-del" data-attr="${esc(name)}" data-value="${esc(v)}" title="Fjern">&times;</button>
              </span>`).join("")
          : '<span class="hint">Ingen vaerdier endnu.</span>';
        const addRow = `
            <div class="attr-add-row" style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center;">
              <input type="text" class="attr-new-input" data-attr="${esc(name)}"
                     placeholder="Ny vaerdi..." style="padding:0.3rem 0.5rem;border:1px solid #d1d5db;border-radius:3px;flex:1;max-width:250px;" />
              <button class="attr-add-btn small" data-attr="${esc(name)}">Tilfoej</button>
            </div>`;
        let extra = "";
        if (name === "PlatformType") {
          extra = `
            <div class="attr-sync-row" style="margin-top:0.6rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
              <button class="small platform-sync-btn" type="button">Sync platform fra MnT</button>
              <label class="hint" style="display:flex;align-items:center;gap:0.3rem;">
                <input type="checkbox" class="platform-sync-overwrite" />
                Overskriv eksisterende
              </label>
              <span class="hint">MnT sender raw-vaerdier (airos, iosxe, ...) som oversaettes til de lokale labels via mapping nedenfor.</span>
              <div class="platform-sync-result" style="flex-basis:100%;"></div>
            </div>
            ${renderMappingEditor(values, mapping)}`;
        }
        return `
          <div class="card" style="margin-bottom:0.75rem;" data-attr-card="${esc(name)}">
            <h3>${esc(label)}</h3>
            <div class="attr-values" data-attr="${esc(name)}">
              ${tags}
            </div>
            ${addRow}
            ${extra}
          </div>`;
      }).join("");

      // MnT sync button
      sections.querySelectorAll(".platform-sync-btn").forEach((btn) => {
        const card = btn.closest(".card");
        const overwriteCb = card?.querySelector(".platform-sync-overwrite");
        const resultDiv = card?.querySelector(".platform-sync-result");
        btn.addEventListener("click", async () => {
          if (!resultDiv) return;
          btn.disabled = true;
          resultDiv.innerHTML = `<div class="alert info">Henter aktive sessions fra MnT og deriverer platform...</div>`;
          try {
            const res = await api.syncPlatformFromMnt(!!overwriteCb?.checked);
            const newVals = (res.new_values_found || []).join(", ") || "ingen";
            const unmapped = (res.unmapped_raw || []).join(", ");
            const unmappedHtml = unmapped
              ? `<div class="alert warn" style="margin-top:0.3rem;">
                   Ikke-mappede raw-vaerdier sprunget over: <code>${esc(unmapped)}</code>
                   (${res.skipped_unmapped} endpoints). Tilfoej dem i mapping nedenfor og koer igen.
                 </div>`
              : "";
            resultDiv.innerHTML = `<div class="alert success">
              ${res.active_sessions} aktive sessions, ${res.matched_endpoints} matchede endpoints,
              <strong>${res.updated_endpoints}</strong> opdateret,
              ${res.skipped_existing} sprunget over (manuel vaerdi), ${res.unmatched_macs} MAC uden endpoint.
              Nye vaerdier: ${esc(newVals)}.
            </div>${unmappedHtml}`;
            await render();
          } catch (err) {
            resultDiv.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
          } finally {
            btn.disabled = false;
          }
        });
      });

      // Mapping save button
      sections.querySelectorAll(".platform-mapping-save").forEach((btn) => {
        const card = btn.closest(".card");
        const resultSpan = card?.querySelector(".platform-mapping-result");
        btn.addEventListener("click", async () => {
          if (!card) return;
          const rows = [];
          card.querySelectorAll(".platform-mapping-table tbody tr").forEach((tr) => {
            const raw = tr.dataset.raw;
            const local = tr.querySelector(".map-local")?.value || "";
            const coa = tr.querySelector(".map-coa")?.value || "reauth";
            rows.push({ raw, local, coa });
          });
          btn.disabled = true;
          if (resultSpan) resultSpan.textContent = "Gemmer...";
          try {
            await api.setPlatformMapping(rows);
            if (resultSpan) resultSpan.textContent = "Gemt.";
          } catch (err) {
            if (resultSpan) resultSpan.textContent = "Fejl: " + err.message;
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      attrMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
    }
  }

  sections.addEventListener("click", async (e) => {
    if (e.target.classList.contains("attr-del")) {
      const attr = e.target.dataset.attr;
      const value = e.target.dataset.value;
      const msg =
        `Fjern "${value}" fra ${attr}?\n\n` +
        `Alle ISE-endpoints der har denne værdi i ${attr} ` +
        `vil også få feltet ryddet (sat til tomt). ` +
        `Dette kan tage et stykke tid ved mange endpoints.`;
      if (!confirm(msg)) return;
      attrMsg.innerHTML = `<div class="alert info">Sletter "${esc(value)}" og rydder feltet på berørte ISE-endpoints...</div>`;
      try {
        const res = await api.removeCustomAttributeValue(attr, value);
        const scanned = res?.scanned_endpoints ?? 0;
        const cleared = res?.cleared_endpoints ?? 0;
        await render();
        attrMsg.innerHTML = `<div class="alert success">
          Fjernet "${esc(value)}" fra ${esc(attr)}.
          Scannet ${scanned} endpoints, ryddet ${cleared} i ISE.
        </div>`;
      } catch (err) {
        attrMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
    if (e.target.classList.contains("attr-add-btn")) {
      const attr = e.target.dataset.attr;
      const input = sections.querySelector(`.attr-new-input[data-attr="${attr}"]`);
      const val = input.value.trim();
      if (!val) return;
      try {
        await api.addCustomAttributeValue(attr, val);
        input.value = "";
        await render();
      } catch (err) {
        attrMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
  });

  // Allow Enter key in input fields
  sections.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.classList.contains("attr-new-input")) {
      e.preventDefault();
      const btn = sections.querySelector(`.attr-add-btn[data-attr="${e.target.dataset.attr}"]`);
      btn.click();
    }
  });

  container.querySelector("#sync-btn").addEventListener("click", async () => {
    const syncResult = container.querySelector("#sync-result");
    syncResult.innerHTML = `<div class="alert info">Synkroniserer...</div>`;
    try {
      const res = await api.syncCustomAttributes();
      const newCount = Object.values(res.new_values_found).reduce((s, v) => s + v.length, 0);
      syncResult.innerHTML = `<div class="alert success">
        Scannet ${res.scanned_endpoints} endpoints. ${newCount} nye vaerdier fundet.
      </div>`;
      await render();
    } catch (err) {
      syncResult.innerHTML = `<div class="alert error">${err.message}</div>`;
    }
  });

  await render();
}
