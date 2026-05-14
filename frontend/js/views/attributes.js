import { api } from "../api.js";
import { t } from "../i18n.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function getAttrLabels() {
  return {
    Type:        t("attr.label_type"),
    Owner:       t("attr.label_owner"),
    Lokation:    t("attr.label_lokation"),
    AuthzVlan:   t("attr.label_authzvlan"),
    PlatformType:t("attr.label_platformtype"),
  };
}

// AuthzACL is also a managed attribute, but its values mirror the DACLs in ISE
// rather than a free-text store. It is administered on its own page (ACL).

// Faste raw-værdier som ISE MnT kan rapportere — bruges i mapping-editoren.
const KNOWN_RAW = ["airos", "iosxe", "iossw", "nxos", "meraki"];
function getCoaOptions() {
  return [
    { value: "reauth",     label: t("attr.coa_reauth") },
    { value: "disconnect", label: t("attr.coa_disconnect") },
  ];
}

export async function renderAttributes(container) {
  container.innerHTML = `
    <h2>${t("attr.title")}</h2>
    <p class="hint">${t("attr.hint")}</p>
    <div id="attr-msg"></div>
    <div id="attr-sections"></div>
  `;

  const sections = container.querySelector("#attr-sections");
  const attrMsg = container.querySelector("#attr-msg");

  function renderMappingEditor(localValues, mapping, nasDevices = {}) {
    const localOptions = (selected) => {
      const opts = [`<option value="">${t("attr.mapping_none")}</option>`];
      for (const v of localValues) {
        const sel = v === selected ? " selected" : "";
        opts.push(`<option value="${esc(v)}"${sel}>${esc(v)}</option>`);
      }
      return opts.join("");
    };
    const coaOptions = (selected) =>
      getCoaOptions().map((o) => {
        const sel = o.value === selected ? " selected" : "";
        return `<option value="${o.value}"${sel}>${o.label}</option>`;
      }).join("");
    const nasCell = (raw) => {
      const devs = nasDevices[raw] || [];
      if (!devs.length) return `<span class="hint" style="font-size:0.8em;">—</span>`;
      return devs.map(d =>
        `<span class="nas-device-tag" title="${esc(d.device_type_path || d.ip)}">${esc(d.name || d.ip)}</span>`
      ).join(" ");
    };
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
        <td class="nas-devices-cell">${nasCell(m.raw)}</td>
      </tr>`).join("");
    return `
      <div class="platform-mapping" style="margin-top:0.8rem;">
        <h4 style="margin:0.4rem 0;">${t("attr.mapping_title")}</h4>
        <p class="hint" style="margin:0 0 0.4rem 0;">${t("attr.mapping_hint")}</p>
        <table class="platform-mapping-table" style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:0.3rem;">${t("attr.mapping_col_raw")}</th>
              <th style="text-align:left;padding:0.3rem;">${t("attr.mapping_col_local")}</th>
              <th style="text-align:left;padding:0.3rem;">${t("attr.mapping_col_coa")}</th>
              <th style="text-align:left;padding:0.3rem;">${t("attr.mapping_col_nas")}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;">
          <button class="small platform-mapping-save" type="button">${t("attr.mapping_save")}</button>
          <span class="platform-mapping-result hint"></span>
        </div>
      </div>`;
  }

  async function render() {
    attrMsg.innerHTML = "";
    try {
      const [data, mapping, nasDevices] = await Promise.all([
        api.listCustomAttributes(),
        api.getPlatformMapping().catch(() => ({ mappings: [] })),
        api.getNasDevicesByPlatform().catch(() => ({})),
      ]);
      const attrMap = {};
      for (const a of data.attributes) attrMap[a.name] = a.values;
      const ATTR_LABELS = getAttrLabels();

      sections.innerHTML = Object.entries(ATTR_LABELS).map(([name, label]) => {
        const values = attrMap[name] || [];
        const tags = values.length
          ? values.map((v) => `
              <span class="attr-tag">
                ${esc(v)}
                <button class="attr-del" data-attr="${esc(name)}" data-value="${esc(v)}" title="${t("attr.del_title")}">&times;</button>
              </span>`).join("")
          : `<span class="hint">${t("attr.no_values")}</span>`;
        const addRow = `
            <div class="attr-add-row" style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center;">
              <input type="text" class="attr-new-input" data-attr="${esc(name)}"
                     placeholder="${t("attr.input_placeholder")}" style="padding:0.3rem 0.5rem;border:1px solid #d1d5db;border-radius:3px;flex:1;max-width:250px;" />
              <button class="attr-add-btn small" data-attr="${esc(name)}">${t("attr.btn_add")}</button>
            </div>`;
        let extra = "";
        if (name === "PlatformType") {
          extra = `
            <div class="attr-sync-row" style="margin-top:0.6rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
              <button class="small platform-sync-btn" type="button">${t("attr.sync_btn")}</button>
              <label class="hint" style="display:flex;align-items:center;gap:0.3rem;">
                <input type="checkbox" class="platform-sync-overwrite" />
                ${t("attr.sync_overwrite")}
              </label>
              <span class="hint">${t("attr.sync_hint")}</span>
              <div class="platform-sync-result" style="flex-basis:100%;"></div>
            </div>
            ${renderMappingEditor(values, mapping, nasDevices)}`;
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
          resultDiv.innerHTML = `<div class="alert info">${t("attr.sync_loading")}</div>`;
          try {
            const res = await api.syncPlatformFromMnt(!!overwriteCb?.checked);
            const newVals = (res.new_values_found || []).join(", ") || t("attr.mapping_none").replace(/—\s*/g, "").trim() || "ingen";
            const unmapped = (res.unmapped_raw || []).join(", ");
            const unmappedHtml = unmapped
              ? `<div class="alert warn" style="margin-top:0.3rem;">
                   ${t("attr.sync_unmapped").replace("{vals}", `<code>${esc(unmapped)}</code>`).replace("{n}", res.skipped_unmapped)}
                 </div>`
              : "";
            resultDiv.innerHTML = `<div class="alert success">
              ${res.active_sessions} aktive sessions, ${res.matched_endpoints} matchede endpoints,
              <strong>${res.updated_endpoints}</strong> opdateret,
              ${res.skipped_existing} sprunget over (manuel værdi), ${res.unmatched_macs} MAC uden endpoint.
              Nye værdier: ${esc(newVals)}.
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
          if (resultSpan) resultSpan.textContent = t("attr.mapping_saving");
          try {
            await api.setPlatformMapping(rows);
            if (resultSpan) resultSpan.textContent = t("attr.mapping_saved");
          } catch (err) {
            if (resultSpan) resultSpan.textContent = t("attr.mapping_error").replace("{msg}", err.message);
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
      const msg = t("attr.del_confirm").replace("{v}", value).replace(/{attr}/g, attr);
      if (!confirm(msg)) return;
      attrMsg.innerHTML = `<div class="alert info">${t("attr.del_deleting").replace("{v}", esc(value))}</div>`;
      try {
        const res = await api.removeCustomAttributeValue(attr, value);
        const scanned = res?.scanned_endpoints ?? 0;
        const cleared = res?.cleared_endpoints ?? 0;
        await render();
        attrMsg.innerHTML = `<div class="alert success">
          ${t("attr.del_success").replace("{v}", esc(value)).replace("{attr}", esc(attr)).replace("{scanned}", scanned).replace("{cleared}", cleared)}
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

  sections.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.classList.contains("attr-new-input")) {
      e.preventDefault();
      const btn = sections.querySelector(`.attr-add-btn[data-attr="${e.target.dataset.attr}"]`);
      btn.click();
    }
  });

  await render();
}
