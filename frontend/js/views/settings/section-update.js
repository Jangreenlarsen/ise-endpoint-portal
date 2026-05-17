// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export function initSystemUpdateSection(container) {
  const fileInput        = container.querySelector("#update-file-input");
  const validateBtn      = container.querySelector("#update-validate-btn");
  const applyBtn         = container.querySelector("#update-apply-btn");
  const applyRestartBtn  = container.querySelector("#update-apply-restart-btn");
  const restartBtn       = container.querySelector("#update-restart-btn");
  const preview      = container.querySelector("#update-preview");
  const result       = container.querySelector("#update-result");
  const pkgInfo      = container.querySelector("#update-pkg-info");
  const fileListWrap = container.querySelector("#update-file-list-wrap");
  const fileListEl   = container.querySelector("#update-file-list");
  const fileCountEl  = container.querySelector("#update-file-count");
  const blockedWrap  = container.querySelector("#update-blocked-wrap");
  const blockedEl    = container.querySelector("#update-blocked-list");
  const msgEl        = container.querySelector("#update-msg");
  const resultMsg    = container.querySelector("#update-result-msg");

  if (!fileInput) return;

  // Set element texts
  const updateCardH3 = container.querySelector("#update-card-h3");
  if (updateCardH3) updateCardH3.textContent = t("settings.update_card");
  const updatePkgLbl = container.querySelector("#update-pkg-lbl");
  if (updatePkgLbl) updatePkgLbl.textContent = t("settings.update_pkg_lbl");
  if (validateBtn) validateBtn.textContent = t("settings.update_btn_validate");
  if (applyBtn) applyBtn.textContent = t("settings.update_btn_apply");
  if (applyRestartBtn) applyRestartBtn.textContent = t("settings.update_btn_apply_restart");
  const updateRestartH4 = container.querySelector("#update-restart-h4");
  if (updateRestartH4) updateRestartH4.textContent = t("settings.update_restart_h4");
  const updateRestartHint = container.querySelector("#update-restart-hint");
  if (updateRestartHint) updateRestartHint.textContent = t("settings.update_restart_hint");
  if (restartBtn) restartBtn.textContent = t("settings.update_btn_restart");
  const pkgInfoLbl = container.querySelector("#update-pkg-info-lbl");
  if (pkgInfoLbl) pkgInfoLbl.textContent = t("settings.update_pkg_info_lbl");
  const blockedLbl = container.querySelector("#update-blocked-lbl");
  if (blockedLbl) blockedLbl.textContent = t("settings.update_blocked_lbl");

  let validatedFile = null;

  async function runValidation(file) {
    if (!file) return;
    msgEl.innerHTML = `<div class="alert info">${t("settings.update_validating")}</div>`;
    validateBtn.disabled = true;
    applyBtn.disabled = true;
    preview.classList.add("hidden");
    result.classList.add("hidden");
    try {
      const info = await api.validateUpdate(file);
      msgEl.innerHTML = "";
      preview.classList.remove("hidden");

      // Pakke-info boks
      const statusIcon = info.ok ? "✅" : "❌";
      const errHtml = info.errors.length
        ? `<span style="color:#b91c1c;">Fejl: ${info.errors.map(e => esc(e)).join("; ")}</span>\n`
        : "";
      pkgInfo.textContent =
        `${statusIcon} Version: ${info.version} build ${info.build}\n` +
        `Filer: ${info.file_count}   Blokerede: ${info.blocked.length}\n` +
        errHtml;

      // Fil-liste
      if (info.files.length) {
        fileListEl.textContent = info.files.join("\n");
        const fileListLbl = container.querySelector("#update-file-list-lbl");
        if (fileListLbl) fileListLbl.textContent = t("settings.update_file_list_lbl").replace("{n}", info.file_count);
        fileListWrap.classList.remove("hidden");
      } else {
        fileListWrap.classList.add("hidden");
      }

      // Blokerede filer
      if (info.blocked.length) {
        blockedEl.textContent = info.blocked.join("\n");
        blockedWrap.classList.remove("hidden");
      } else {
        blockedWrap.classList.add("hidden");
      }

      applyBtn.disabled = !info.ok;
      if (applyRestartBtn) applyRestartBtn.disabled = !info.ok;
      if (info.ok) validatedFile = file;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.update_validate_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      validateBtn.disabled = false;
    }
  }

  fileInput.addEventListener("change", () => {
    validatedFile = null;
    applyBtn.disabled = true;
    if (applyRestartBtn) applyRestartBtn.disabled = true;
    preview.classList.add("hidden");
    result.classList.add("hidden");
    msgEl.innerHTML = "";
    if (fileInput.files.length) runValidation(fileInput.files[0]);
    validateBtn.disabled = !fileInput.files.length;
  });

  validateBtn.addEventListener("click", () => runValidation(fileInput.files[0]));

  applyBtn.addEventListener("click", async () => {
    if (!validatedFile) return;
    if (!confirm(t("settings.update_apply_confirm"))) return;
    applyBtn.disabled = true;
    msgEl.innerHTML = `<div class="alert info">${t("settings.update_applying")}</div>`;
    try {
      const res = await api.applyUpdate(validatedFile);
      msgEl.innerHTML = "";
      preview.classList.add("hidden");
      result.classList.remove("hidden");
      const errHtml = res.errors.length
        ? `<div class="alert warning" style="margin-top:0.5rem;">⚠ ${res.errors.length} fejl:<br>${res.errors.map(e => esc(e)).join("<br>")}</div>`
        : "";
      resultMsg.innerHTML =
        `<div class="alert success">${t("settings.update_done").replace("{n}", res.applied_count)}</div>` +
        errHtml +
        `<p class="hint" style="margin-top:0.5rem;">${t("settings.update_hint2").replace("\n", "<br>").replace("\n", "<br>")}</p>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.update_fail").replace("{msg}", esc(err.message))}</div>`;
      applyBtn.disabled = false;
    }
  });

  if (applyRestartBtn) applyRestartBtn.addEventListener("click", async () => {
    if (!validatedFile) return;
    if (!confirm(t("settings.update_apply_restart_confirm"))) return;
    applyBtn.disabled = true;
    applyRestartBtn.disabled = true;
    msgEl.innerHTML = `<div class="alert info">${t("settings.update_applying")}</div>`;
    try {
      const res = await api.applyUpdate(validatedFile);
      msgEl.innerHTML = `<div class="alert info">${t("settings.update_apply_restart_done").replace("{n}", res.applied_count)}</div>`;
      preview.classList.add("hidden");
      result.classList.add("hidden");
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.update_fail").replace("{msg}", esc(err.message))}</div>`;
      applyBtn.disabled = false;
      applyRestartBtn.disabled = false;
      return;
    }
    try {
      await api.restartServer();
    } catch {
      // Serveren lukker ned — forventet at kaldet fejler
    }
    setTimeout(() => window.location.reload(), 8000);
  });

  restartBtn.addEventListener("click", async () => {
    if (!confirm(t("settings.update_restart_confirm"))) return;
    restartBtn.disabled = true;
    try {
      await api.restartServer();
      msgEl.innerHTML = `<div class="alert info">${t("settings.update_restarting")}</div>`;
      setTimeout(() => window.location.reload(), 8000);
    } catch {
      // Serveren lukker ned — det er forventet at kaldet fejler
      msgEl.innerHTML = `<div class="alert info">${t("settings.update_restarting")}</div>`;
      setTimeout(() => window.location.reload(), 8000);
    }
  });
}

export function initGithubUpdateSection(container) {
  const card    = container.querySelector("#gh-update-card");
  if (!card) return;

  const msgEl   = card.querySelector("#gh-msg");
  const checkBtn = card.querySelector("#gh-check-btn");
  const pullBtn  = card.querySelector("#gh-pull-btn");
  const infoEl  = card.querySelector("#gh-info");

  if (card.querySelector("#gh-card-h3")) card.querySelector("#gh-card-h3").textContent = t("settings.gh_card");
  if (card.querySelector("#gh-hint"))    card.querySelector("#gh-hint").textContent    = t("settings.gh_hint");
  if (checkBtn) checkBtn.textContent = t("settings.gh_btn_check");
  if (pullBtn)  pullBtn.textContent  = t("settings.gh_btn_pull");

  function showInfo(data) {
    const cur  = `${data.current_version} build ${data.current_build}`;
    const lat  = data.latest_version ? `${data.latest_version} build ${data.latest_build}` : "–";
    const upd  = data.update_available;
    const git  = data.git_ready;

    infoEl.innerHTML = `
      <table class="gh-version-table">
        <tr><td>${t("settings.gh_current")}</td><td><strong>${esc(cur)}</strong></td></tr>
        <tr><td>${t("settings.gh_latest")}</td><td><strong>${esc(lat)}</strong></td></tr>
      </table>`;

    if (data.error) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.gh_check_err").replace("{msg}", esc(data.error))}</div>`;
      pullBtn.hidden = true;
      return;
    }
    if (!git) {
      msgEl.innerHTML = `<div class="alert warning">${t("settings.gh_not_git")}</div>`;
      pullBtn.hidden = true;
      return;
    }
    if (upd) {
      msgEl.innerHTML = `<div class="alert warning">${t("settings.gh_update_available")}</div>`;
      pullBtn.hidden = false;
    } else {
      msgEl.innerHTML = `<div class="alert success">${t("settings.gh_up_to_date")}</div>`;
      pullBtn.hidden = true;
    }
  }

  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    msgEl.innerHTML = `<div class="alert info">${t("settings.gh_checking")}</div>`;
    infoEl.innerHTML = "";
    pullBtn.hidden = true;
    try {
      const data = await api.githubCheck();
      showInfo(data);
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.gh_check_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      checkBtn.disabled = false;
    }
  });

  pullBtn.addEventListener("click", async () => {
    if (!confirm(t("settings.gh_btn_pull") + "?")) return;
    pullBtn.disabled = true;
    checkBtn.disabled = true;
    msgEl.innerHTML = `<div class="alert info">${t("settings.gh_pulling")}</div>`;
    try {
      const res = await api.githubPull();
      const out = [res.stdout, res.stderr].filter(Boolean).join("\n");
      msgEl.innerHTML = `
        <div class="alert success">${t("settings.gh_pull_ok")}</div>
        ${out ? `<pre class="gh-pull-output">${esc(out)}</pre>` : ""}`;
      pullBtn.hidden = true;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${t("settings.gh_pull_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      pullBtn.disabled = false;
      checkBtn.disabled = false;
    }
  });
}

export function initAdvancedSection(container) {
  const btn    = container.querySelector("#migration-sync-btn");
  const result = container.querySelector("#migration-sync-result");
  const debugCb     = container.querySelector("#debug-pxgrid-sessions-cb");
  const debugResult = container.querySelector("#debug-pxgrid-sessions-result");
  if (!btn) return;

  // Set element texts
  const advCardH3 = container.querySelector("#adv-card-h3");
  if (advCardH3) advCardH3.textContent = t("settings.adv_card");
  btn.textContent = t("settings.adv_btn");
  const debugLbl = container.querySelector("#debug-pxgrid-sessions-lbl");
  if (debugLbl) debugLbl.textContent = t("settings.adv_debug_pxgrid_lbl");
  const debugHint = container.querySelector("#debug-pxgrid-sessions-hint");
  if (debugHint) debugHint.textContent = t("settings.adv_debug_pxgrid_hint");

  // Load current debug setting
  (async () => {
    try {
      const s = await api.getBackendSettings();
      if (debugCb) debugCb.checked = !!s.debug_pxgrid_sessions;
    } catch (_) { /* ignore */ }
  })();

  // Save on toggle
  if (debugCb) {
    debugCb.addEventListener("change", async () => {
      try {
        const current = await api.getBackendSettings();
        await api.updateBackendSettings({ ...current, debug_pxgrid_sessions: debugCb.checked });
        debugResult.innerHTML = `<span style="color:var(--success,#166534);font-size:0.82em;">${t("settings.adv_debug_pxgrid_saved")}</span>`;
        setTimeout(() => { debugResult.innerHTML = ""; }, 3000);
      } catch (err) {
        debugCb.checked = !debugCb.checked;
        debugResult.innerHTML = `<span style="color:var(--danger,#991b1b);font-size:0.82em;">${esc(err.message)}</span>`;
      }
    });
  }

  btn.addEventListener("click", async () => {
    if (!confirm(t("settings.adv_confirm"))) return;

    btn.disabled = true;
    result.innerHTML = `<div class="alert" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:0.6rem 1rem;color:#1e40af;">${t("settings.adv_loading")}</div>`;
    try {
      const res = await api.syncCustomAttributes();
      const newCount = Object.values(res.new_values_found || {}).reduce((s, v) => s + (v?.length || 0), 0);
      result.innerHTML = `<div class="alert" style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:0.6rem 1rem;color:#166534;">${t("settings.adv_done").replace("{n}", res.scanned_endpoints).replace("{new}", newCount)}</div>`;
    } catch (err) {
      result.innerHTML = `<div class="alert" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:0.6rem 1rem;color:#991b1b;">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}
