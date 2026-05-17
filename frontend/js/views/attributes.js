// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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

  function renderMappingEditor(localValues, mapping, nasDevices = {}, nasLoaded = false, nasLoading = false, nasUnmatched = []) {
    const maxMappings = mapping.max_mappings || 20;

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
      if (nasLoading && !nasLoaded) return `<span class="hint" style="font-size:0.8em;">${t("attr.nas_loading")}</span>`;
      const groups = nasDevices[raw] || [];
      if (!groups.length) return `<span class="hint" style="font-size:0.8em;">—</span>`;
      return groups.map(g => {
        const label = g.path || raw;
        const suffix = g.count > 1 ? ` (${g.count})` : "";
        return `<span class="nas-device-tag">${esc(label)}${esc(suffix)}</span>`;
      }).join(" ");
    };
    const nasHeader = nasLoaded
      ? t("attr.mapping_col_nas")
      : nasLoading
        ? `${t("attr.mapping_col_nas")} <span class="hint" style="font-size:0.8em;">(${t("attr.nas_loading")})</span>`
        : `${t("attr.mapping_col_nas")} <span class="hint" style="font-size:0.8em;">(${t("attr.nas_not_loaded")})</span>`;

    // ISE NAS Devices shown first; for new rows it's an editable raw input
    const makeRow = (raw, local, coa, isNew = false) => `
      <tr data-raw="${esc(raw)}" class="${isNew ? "mapping-row-new" : ""}">
        <td class="nas-devices-cell">
          ${isNew
            ? `<input type="text" class="map-raw" placeholder="${esc(t("attr.mapping_raw_placeholder"))}" value="${esc(raw)}" style="width:100%;box-sizing:border-box;" />`
            : `<input type="hidden" class="map-raw" value="${esc(raw)}" />${nasCell(raw)}`
          }
        </td>
        <td>
          <select class="map-local">${localOptions(local)}</select>
        </td>
        <td>
          <select class="map-coa">${coaOptions(coa)}</select>
        </td>
        <td style="width:28px;text-align:center;">
          <button type="button" class="map-row-del" title="${esc(t("attr.mapping_del_title"))}"
            style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;padding:0;line-height:1;">×</button>
        </td>
      </tr>`;

    // Stored mappings
    const mappedRaws = new Set(mapping.mappings.map(m => m.raw.toLowerCase()));
    const rows = mapping.mappings.map((m) => makeRow(m.raw, m.local, m.coa, false)).join("");

    // Unmatched NDG rows not yet in any mapping → suggest as new pre-filled rows
    const newRows = nasUnmatched
      .filter(u => !mappedRaws.has(u.path.toLowerCase()))
      .map(u => makeRow(u.path, "", "reauth", true)).join("");

    const count = mapping.mappings.length;
    const atLimit = count >= maxMappings;
    const emptyNote = count === 0 && nasUnmatched.length === 0
      ? `<tr class="mapping-empty-row"><td colspan="4" style="text-align:center;padding:0.6rem;color:#6b7280;">${t("attr.mapping_empty")}</td></tr>`
      : "";

    return `
      <div class="platform-mapping" style="margin-top:0.8rem;">
        <h4 style="margin:0.4rem 0;">${t("attr.mapping_title")}</h4>
        <p class="hint" style="margin:0 0 0.4rem 0;">${t("attr.mapping_hint")}</p>
        <div class="alert info" style="margin:0 0 0.6rem 0;font-size:0.85em;">
          <strong>${t("attr.mapping_nas_info_title")}</strong><br>
          ${t("attr.mapping_nas_info_body")}
        </div>
        <table class="platform-mapping-table" style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:0.3rem;">${nasHeader}</th>
              <th style="text-align:left;padding:0.3rem;">${t("attr.mapping_col_local")}</th>
              <th style="text-align:left;padding:0.3rem;">${t("attr.mapping_col_coa")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${emptyNote}${rows}${newRows}</tbody>
        </table>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <button class="small platform-mapping-save" type="button">${t("attr.mapping_save")}</button>
          <button class="small platform-mapping-add" type="button" data-max="${maxMappings}"${atLimit ? " disabled" : ""} title="${atLimit ? esc(t("attr.mapping_at_limit").replace("{max}", maxMappings)) : ""}">
            ${t("attr.mapping_add")}
          </button>
          <span class="platform-mapping-count hint">${count} / ${maxMappings} ${t("attr.mapping_limit")}</span>
          <span class="platform-mapping-result hint" style="margin-left:auto;"></span>
        </div>
        <div style="margin-top:0.4rem;display:flex;gap:0.5rem;align-items:center;">
          <button class="small secondary platform-nas-refresh" type="button">${t("attr.mapping_scan_nas")}</button>
          <span class="platform-nas-refresh-result hint"></span>
        </div>
      </div>`;
  }

  function updateMappingCount(card) {
    const tbody = card.querySelector(".platform-mapping-table tbody");
    const countSpan = card.querySelector(".platform-mapping-count");
    const addBtn = card.querySelector(".platform-mapping-add");
    const maxAttr = addBtn?.dataset.max;
    const max = maxAttr ? parseInt(maxAttr, 10) : 20;
    if (!tbody || !countSpan) return;
    const n = tbody.querySelectorAll("tr:not(.mapping-empty-row)").length;
    countSpan.textContent = `${n} / ${max} ${t("attr.mapping_limit")}`;
    if (addBtn) {
      const atLimit = n >= max;
      addBtn.disabled = atLimit;
      addBtn.title = atLimit ? t("attr.mapping_at_limit").replace("{max}", max) : "";
    }
    // Show/hide empty note
    let emptyRow = tbody.querySelector(".mapping-empty-row");
    if (n === 0) {
      if (!emptyRow) {
        emptyRow = document.createElement("tr");
        emptyRow.className = "mapping-empty-row";
        emptyRow.innerHTML = `<td colspan="4" style="text-align:center;padding:0.6rem;color:#6b7280;">${t("attr.mapping_empty")}</td>`;
        tbody.prepend(emptyRow);
      }
    } else if (emptyRow) {
      emptyRow.remove();
    }
  }

  async function render() {
    attrMsg.innerHTML = "";
    try {
      const [data, mapping, nasResp, workerResp] = await Promise.all([
        api.listCustomAttributes(),
        api.getPlatformMapping().catch(() => ({ mappings: [] })),
        api.getNasDevicesByPlatform().catch(() => ({ devices: {}, loaded: false, loading: false })),
        api.getPxGridWorkerStatus().catch(() => ({ connected: false })),
      ]);
      const nasDevices = nasResp.devices || {};
      const nasLoaded = nasResp.loaded;
      const nasLoading = nasResp.loading;
      const nasUnmatched = nasResp.unmatched || [];
      const pxgridConnected = !!(workerResp.connected);
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
          const syncDisabled = pxgridConnected ? " disabled" : "";
          const syncHint = pxgridConnected
            ? `<span class="hint" style="color:#6b7280;">${t("attr.sync_pxgrid_active")}</span>`
            : `<span class="hint">${t("attr.sync_hint")}</span>`;
          extra = `
            <div class="attr-sync-row" style="margin-top:0.6rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
              <button class="small platform-sync-btn" type="button"${syncDisabled}>${t("attr.sync_btn")}</button>
              ${pxgridConnected ? "" : `<label class="hint" style="display:flex;align-items:center;gap:0.3rem;">
                <input type="checkbox" class="platform-sync-overwrite" />
                ${t("attr.sync_overwrite")}
              </label>`}
              ${syncHint}
              <div class="platform-sync-result" style="flex-basis:100%;"></div>
            </div>
            ${renderMappingEditor(values, mapping, nasDevices, nasLoaded, nasLoading, nasUnmatched)}`;
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
          card.querySelectorAll(".platform-mapping-table tbody tr:not(.mapping-empty-row)").forEach((tr) => {
            const rawInput = tr.querySelector(".map-raw");
            const raw = (rawInput?.value || "").trim().toLowerCase();
            const local = tr.querySelector(".map-local")?.value || "";
            const coa = tr.querySelector(".map-coa")?.value || "reauth";
            if (raw) rows.push({ raw, local, coa });
          });
          btn.disabled = true;
          if (resultSpan) resultSpan.textContent = t("attr.mapping_saving");
          try {
            await api.setPlatformMapping(rows);
            if (resultSpan) resultSpan.textContent = t("attr.mapping_saved");
            await render();
          } catch (err) {
            if (resultSpan) resultSpan.textContent = t("attr.mapping_error").replace("{msg}", err.message);
            btn.disabled = false;
          }
        });
      });

      // Mapping add-row button
      sections.querySelectorAll(".platform-mapping-add").forEach((btn) => {
        const card = btn.closest(".card");
        btn.addEventListener("click", () => {
          if (!card) return;
          const tbody = card.querySelector(".platform-mapping-table tbody");
          if (!tbody) return;
          const max = parseInt(btn.dataset.max || "20", 10);
          const n = tbody.querySelectorAll("tr:not(.mapping-empty-row)").length;
          if (n >= max) return;
          const localOpts = [`<option value="">${t("attr.mapping_none")}</option>`];
          for (const v of card.querySelectorAll(".attr-tag") || []) {
            const val = v.querySelector(".attr-del")?.dataset.value || "";
            if (val) localOpts.push(`<option value="${esc(val)}">${esc(val)}</option>`);
          }
          // Build select options from current localValues via DOM (already rendered)
          const existingSelects = card.querySelectorAll(".map-local");
          const firstSelect = existingSelects[0];
          const optsHtml = firstSelect
            ? firstSelect.innerHTML
            : `<option value="">${t("attr.mapping_none")}</option>`;
          const coaOpts = getCoaOptions().map((o) =>
            `<option value="${o.value}">${o.label}</option>`).join("");
          const tr = document.createElement("tr");
          tr.className = "mapping-row-new";
          tr.dataset.raw = "";
          tr.innerHTML = `
            <td class="nas-devices-cell">
              <input type="text" class="map-raw" placeholder="${esc(t("attr.mapping_raw_placeholder"))}"
                style="width:100%;box-sizing:border-box;" />
            </td>
            <td><select class="map-local">${optsHtml}</select></td>
            <td><select class="map-coa">${coaOpts}</select></td>
            <td style="width:28px;text-align:center;">
              <button type="button" class="map-row-del" title="${esc(t("attr.mapping_del_title"))}"
                style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;padding:0;line-height:1;">×</button>
            </td>`;
          tbody.appendChild(tr);
          tr.querySelector(".map-raw")?.focus();
          updateMappingCount(card);
        });
      });

      // Mapping delete-row buttons (delegated on sections)
      // NAS refresh button
      sections.querySelectorAll(".platform-nas-refresh").forEach((btn) => {
        const resultSpan = btn.closest("div")?.querySelector(".platform-nas-refresh-result");
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          if (resultSpan) resultSpan.textContent = t("attr.mapping_scan_nas_running");
          try {
            await api.refreshNasDevices();
            if (resultSpan) resultSpan.textContent = t("attr.mapping_scan_nas_done");
            setTimeout(() => render(), 3000);
          } catch (err) {
            if (resultSpan) resultSpan.textContent = t("attr.mapping_scan_nas_err").replace("{msg}", err.message);
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
    if (e.target.classList.contains("map-row-del")) {
      const tr = e.target.closest("tr");
      const card = e.target.closest(".card");
      if (tr) tr.remove();
      if (card) updateMappingCount(card);
      return;
    }
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
        attrMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
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
        attrMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
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
