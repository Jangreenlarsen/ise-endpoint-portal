// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { getCsvTemplate, setCsvTemplate, resetCsvTemplate, parseTemplateHeader, extendTemplateWithPortalColumns } from "../csv.js";
import { t } from "../i18n.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function renderCsvTemplate(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">${t("csv_tpl.title")}</h2>
    </div>

    <div class="card">
      <h3>${t("csv_tpl.title")}</h3>
      <p class="hint">${t("csv_tpl.hint")}</p>
      <div id="csv-tpl-msg"></div>
      <div class="field">
        <label>${t("csv_tpl.active_prefix")}<span id="csv-tpl-count">0</span>${t("csv_tpl.active_suffix")}</label>
        <textarea id="csv-tpl-preview" rows="3" readonly
                  style="font-size:0.82rem;background:#f9fafb;"></textarea>
      </div>
      <div class="field">
        <label for="csv-tpl-file">${t("csv_tpl.import_label")}</label>
        <input type="file" id="csv-tpl-file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="actions">
        <button type="button" id="csv-tpl-reset">${t("csv_tpl.btn_reset")}</button>
      </div>
    </div>
  `;

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
      const extra = added
        ? t("csv_tpl.portal_added").replace("{n}", added)
        : "";
      csvTplMsg.innerHTML = `<div class="alert success">${t("csv_tpl.imported").replace("{n}", extended.length).replace("{extra}", extra)}</div>`;
    } catch (err) {
      csvTplMsg.innerHTML = `<div class="alert error">${t("csv_tpl.err_read").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      e.target.value = "";
    }
  });

  container.querySelector("#csv-tpl-reset").addEventListener("click", () => {
    resetCsvTemplate();
    csvTplFile.value = "";
    refreshTplPreview();
    csvTplMsg.innerHTML = `<div class="alert success">${t("csv_tpl.reset_done").replace("{n}", getCsvTemplate().length)}</div>`;
  });
}
