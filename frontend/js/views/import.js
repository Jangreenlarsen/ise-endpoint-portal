// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { t } from "../i18n.js";
import { parseCsv } from "../csv.js";
import { esc } from "./browse-utils.js";

export async function renderImport(container) {
  container.innerHTML = `
    <h2>${t("import.title")}</h2>
    <div class="card">
      <p class="hint">
        Understøtter to formater:<br>
        <strong>${t("import.format_ise")}</strong> — CSV eksporteret fra ISE Context Visibility
        (kolonner: <code>MACAddress</code>, <code>IdentityGroup</code>, <code>Description</code>,
        <code>CUSTOM.Owner</code>, <code>CUSTOM.Lokation</code>, <code>CUSTOM.AuthzVlan</code>).<br>
        <strong>${t("import.format_simple")}</strong> — <code>mac,group,description,type,owner,lokation,authz_vlan</code>
        (header valgfri).<br>
        Format detekteres automatisk. Hvis <code>group</code> mangler bruges fallback-gruppen.
      </p>
      <div class="field">
        <label for="csv-file">${t("import.label_file")}</label>
        <input type="file" id="csv-file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="field">
        <label for="csv-text">${t("import.label_paste")}</label>
        <textarea id="csv-text" placeholder="mac,group,description,type,owner,lokation,authz_vlan
AA:BB:CC:DD:EE:01,Unknown,lab device,Printer,IT,kontor1,VLAN100
AA:BB:CC:DD:EE:02,Profiled,printer,Camera,Facilities,,VLAN200"></textarea>
      </div>
      <div class="field">
        <label for="fallback-group">${t("import.label_fallback")}</label>
        <select id="fallback-group"></select>
      </div>
      <div class="field">
        <label>${t("import.label_conflict")}</label>
        <div class="radio-row">
          <label><input type="radio" name="on-conflict" value="skip" checked /> ${t("import.conflict_skip")}</label>
          <label><input type="radio" name="on-conflict" value="overwrite" /> ${t("import.conflict_overwrite")}</label>
        </div>
      </div>
      <div class="actions">
        <button id="preview-btn" type="button">${t("import.btn_preview")}</button>
        <button id="import-btn" type="button" disabled>${t("import.btn_import")}</button>
      </div>
      <div id="msg"></div>
      <div id="preview"></div>
      <div id="result"></div>
    </div>
  `;

  let groups = [];
  let parsed = [];

  const fallback = container.querySelector("#fallback-group");
  const msg = container.querySelector("#msg");
  const preview = container.querySelector("#preview");
  const result = container.querySelector("#result");
  const importBtn = container.querySelector("#import-btn");

  try {
    groups = await api.listGroups();
    fallback.innerHTML = groups
      .map((g) => `<option value="${g.id}">${g.name}</option>`)
      .join("");
  } catch (err) {
    msg.innerHTML = `<div class="alert error">${t("import.err_groups").replace("{msg}", esc(err.message))}</div>`;
  }

  container.querySelector("#csv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    container.querySelector("#csv-text").value = text;
  });

  container.querySelector("#preview-btn").addEventListener("click", () => {
    const text = container.querySelector("#csv-text").value;
    const { format, items } = parseCsv(text);
    parsed = items;
    result.innerHTML = "";
    if (!parsed.length) {
      preview.innerHTML = `<div class="alert info">${t("import.no_rows")}</div>`;
      importBtn.disabled = true;
      return;
    }
    const valid = parsed.filter((p) => p.valid).length;
    const invalid = parsed.length - valid;
    const hasCA = parsed.some((p) => p.endpointType || p.owner || p.lokation || p.authzVlan || p.authzAcl || p.platformType);
    const fmtLabel = format === "ise" ? t("import.format_ise") : t("import.format_simple");
    preview.innerHTML = `
      <div class="alert info">
        Detekteret format: <strong>${fmtLabel}</strong> —
        ${parsed.length} rækker, <strong>${valid}</strong> gyldige, <strong>${invalid}</strong> ugyldige.
      </div>
      <div class="preview-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>MAC</th><th>Group</th><th>Description</th>
              ${hasCA ? "<th>Type</th><th>Owner</th><th>Lokation</th><th>AuthzVlan</th><th>AuthzACL</th><th>PlatformType</th>" : ""}
              <th>${t("import.col_status")}</th>
            </tr>
          </thead>
          <tbody>
            ${parsed.map((p, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(p.mac)}</td>
                <td>${p.groupName ? escapeHtml(p.groupName) : "<em>fallback</em>"}</td>
                <td>${escapeHtml(p.description)}</td>
                ${hasCA ? `
                  <td>${escapeHtml(p.endpointType)}</td>
                  <td>${escapeHtml(p.owner)}</td>
                  <td>${escapeHtml(p.lokation)}</td>
                  <td>${escapeHtml(p.authzVlan)}</td>
                  <td>${escapeHtml(p.authzAcl)}</td>
                  <td>${escapeHtml(p.platformType)}</td>
                ` : ""}
                <td>${p.valid ? "✓" : `<span class="invalid">${t("import.invalid_mac")}</span>`}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
    importBtn.disabled = valid === 0;
  });

  importBtn.addEventListener("click", async () => {
    const fallbackId = fallback.value;
    const groupsByName = new Map(
      groups.map((g) => [g.name.toLowerCase(), g.id]),
    );
    const items = parsed
      .filter((p) => p.valid)
      .map((p) => {
        const item = {
          mac: p.mac.toUpperCase().replace(/-/g, ":"),
          group_id: p.groupName
            ? (groupsByName.get(p.groupName.toLowerCase()) || fallbackId)
            : fallbackId,
          description: p.description,
        };
        if (p.staticGroup !== null && p.staticGroup !== undefined) {
          item.static_group_assignment = p.staticGroup;
        }
        const ca = {};
        let hasCA = false;
        if (p.endpointType) { ca.Type = p.endpointType; hasCA = true; }
        if (p.owner) { ca.Owner = p.owner; hasCA = true; }
        if (p.lokation) { ca.Lokation = p.lokation; hasCA = true; }
        if (p.authzVlan) { ca.AuthzVlan = p.authzVlan; hasCA = true; }
        if (p.authzAcl) { ca.AuthzACL = p.authzAcl; hasCA = true; }
        if (p.platformType) { ca.PlatformType = p.platformType; hasCA = true; }
        if (hasCA) item.custom_attributes = ca;
        return item;
      });

    const onConflict = container.querySelector("input[name='on-conflict']:checked")?.value || "skip";
    const overwrite = onConflict === "overwrite";
    const modeLabel = overwrite ? t("import.mode_overwrite") : t("import.mode_skip");
    result.innerHTML = `<div class="alert info">${t("import.importing").replace("{n}", items.length).replace("{mode}", modeLabel)}</div>`;
    importBtn.disabled = true;
    const none = t("import.none");
    try {
      const res = await api.bulkCreateEndpoints(items, overwrite);
      const skipped = res.skipped || [];
      const overwritten = res.overwritten || [];
      const alertClass = res.failed.length ? "info" : "success";
      result.innerHTML = `
        <div class="alert ${alertClass}">
          ${t("import.result_created")}: <strong>${res.succeeded.length}</strong> —
          ${t("import.result_overwritten")}: <strong>${overwritten.length}</strong> —
          ${t("import.result_skipped")}: <strong>${skipped.length}</strong> —
          ${t("import.result_failed")}: <strong>${res.failed.length}</strong>
        </div>
        <div class="result-list">
          <div>
            <h4 class="succeeded">Succeeded (${res.succeeded.length})</h4>
            <ul>${res.succeeded.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || `<li>${none}</li>`}</ul>
          </div>
          <div>
            <h4 class="overwritten">Overwritten (${overwritten.length})</h4>
            <ul>${overwritten.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || `<li>${none}</li>`}</ul>
          </div>
          <div>
            <h4 class="skipped">Skipped (${skipped.length})</h4>
            <ul>${skipped.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || `<li>${none}</li>`}</ul>
          </div>
          <div>
            <h4 class="failed">Failed (${res.failed.length})</h4>
            <ul>${res.failed.map((f) => `<li>${escapeHtml(f.mac)}: ${escapeHtml(f.error)}</li>`).join("") || `<li>${none}</li>`}</ul>
          </div>
        </div>
      `;
    } catch (err) {
      result.innerHTML = `<div class="alert error">${t("import.err_bulk").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      importBtn.disabled = false;
    }
  });
}
