// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc, loadFrontendPrefs, saveFrontendPrefs, applyTheme } from "./shared.js";
import { getCsvTemplate, setCsvTemplate, resetCsvTemplate, parseTemplateHeader, extendTemplateWithPortalColumns } from "../../csv.js";

export function initPasswordSection(container) {
  const msg = container.querySelector("#pw-msg");
  container.querySelector("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const current = container.querySelector("#pw-current").value;
    const newPw = container.querySelector("#pw-new").value;
    const newPw2 = container.querySelector("#pw-new2").value;
    if (newPw !== newPw2) {
      msg.innerHTML = `<div class="alert error">${t("prefs.pw_err_match")}</div>`;
      return;
    }
    try {
      await api.changePassword(current, newPw);
      container.querySelector("#pw-form").reset();
      msg.innerHTML = `<div class="alert success">${t("prefs.pw_success")}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

export function initCsvAndPrefsSections(container) {
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
        csvTplMsg.innerHTML = `<div class="alert error">${t("csv_tpl.err_no_cols")}</div>`;
        return;
      }
      const extended = extendTemplateWithPortalColumns(columns);
      setCsvTemplate(extended);
      refreshTplPreview();
      const added = extended.length - columns.length;
      const addedNote = added ? t("csv_tpl.portal_added").replace("{n}", added) : "";
      csvTplMsg.innerHTML = `<div class="alert success">${t("csv_tpl.imported").replace("{n}", extended.length).replace("{extra}", addedNote)}</div>`;
    } catch (err) {
      csvTplMsg.innerHTML = `<div class="alert error">${t("csv_tpl.err_read").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      // Nulstil input så samme fil kan vælges igen efter fejl/reset.
      e.target.value = "";
    }
  });

  container.querySelector("#csv-tpl-reset").addEventListener("click", () => {
    resetCsvTemplate();
    csvTplFile.value = "";
    refreshTplPreview();
    csvTplMsg.innerHTML = `<div class="alert success">${t("csv_tpl.reset_done").replace("{n}", getCsvTemplate().length)}</div>`;
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
    frontendMsg.innerHTML = `<div class="alert success">${t("prefs.success")}</div>`;
  });
}
