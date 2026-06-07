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

// ---------------------------------------------------------------------------
// Simpel markdown-renderer til release notes (subset: ##/###, **bold**,
// *italic*, `code`, - list, --- separator, blanklinje = afsnit).
// ---------------------------------------------------------------------------
function _rnInline(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderReleaseNotesMd(md) {
  const lines = md.split("\n");
  const parts = [];
  let inList = false;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let inTable = false;
  let tableLines = [];

  function flushList() {
    if (inList) { parts.push("</ul>"); inList = false; }
  }
  function flushTable() {
    if (!inTable) return;
    const rows = tableLines.filter(r => !/^\|[-: |]+\|$/.test(r.trim()));
    if (rows.length) {
      let html = '<table class="rn-table">';
      rows.forEach((row, i) => {
        const cells = row.split("|").slice(1, -1).map(c => c.trim());
        const tag = i === 0 ? "th" : "td";
        html += `<tr>${cells.map(c => `<${tag}>${_rnInline(c)}</${tag}>`).join("")}</tr>`;
      });
      html += "</table>";
      parts.push(html);
    }
    inTable = false;
    tableLines = [];
  }

  for (const raw of lines) {
    const l = raw.trimEnd();

    if (l.startsWith("```")) {
      if (!inCode) {
        flushList(); flushTable();
        inCode = true; codeLang = l.slice(3).trim(); codeLines = [];
      } else {
        const langClass = codeLang ? ` class="language-${codeLang}"` : "";
        const escaped = codeLines.map(c => c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("\n");
        parts.push(`<pre class="rn-pre"><code${langClass}>${escaped}</code></pre>`);
        inCode = false; codeLines = [];
      }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }

    if (l.startsWith("|")) {
      flushList();
      inTable = true; tableLines.push(l);
      continue;
    }
    if (inTable) flushTable();

    if (/^# (?!#)/.test(l)) {
      flushList();
      parts.push(`<h3 class="rn-h1">${_rnInline(l.slice(2))}</h3>`);
    } else if (l.startsWith("#### ")) {
      flushList();
      parts.push(`<h6 class="rn-h4">${_rnInline(l.slice(5))}</h6>`);
    } else if (l.startsWith("### ")) {
      flushList();
      parts.push(`<h5 class="rn-h3">${_rnInline(l.slice(4))}</h5>`);
    } else if (l.startsWith("## ")) {
      flushList();
      parts.push(`<h4 class="rn-h2">${_rnInline(l.slice(3))}</h4>`);
    } else if (l === "---") {
      flushList();
      parts.push('<hr class="rn-hr">');
    } else if (l.startsWith("> ")) {
      flushList();
      parts.push(`<blockquote class="rn-bq">${_rnInline(l.slice(2))}</blockquote>`);
    } else if (l.startsWith("- ")) {
      if (!inList) { parts.push('<ul class="rn-list">'); inList = true; }
      parts.push(`<li>${_rnInline(l.slice(2))}</li>`);
    } else if (l === "") {
      flushList();
    } else {
      flushList();
      parts.push(`<p class="rn-p">${_rnInline(l)}</p>`);
    }
  }
  flushList(); flushTable();
  if (inCode && codeLines.length) {
    const escaped = codeLines.map(c => c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("\n");
    parts.push(`<pre class="rn-pre"><code>${escaped}</code></pre>`);
  }
  return parts.join("");
}

export function initGithubUpdateSection(container) {
  const card    = container.querySelector("#gh-update-card");
  if (!card) return;

  const msgEl      = card.querySelector("#gh-msg");
  const checkBtn   = card.querySelector("#gh-check-btn");
  const pullBtn    = card.querySelector("#gh-pull-btn");
  const infoEl     = card.querySelector("#gh-info");
  const notesEl    = card.querySelector("#gh-release-notes");
  const devCb      = card.querySelector("#gh-dev-branch-cb");
  const devResult  = card.querySelector("#gh-dev-branch-result");

  if (card.querySelector("#gh-card-h3")) card.querySelector("#gh-card-h3").textContent = t("settings.gh_card");
  if (card.querySelector("#gh-hint"))    card.querySelector("#gh-hint").textContent    = t("settings.gh_hint");
  if (checkBtn) checkBtn.textContent = t("settings.gh_btn_check");
  if (pullBtn)  pullBtn.textContent  = t("settings.gh_btn_pull");
  const devLbl = card.querySelector("#gh-dev-branch-lbl");
  if (devLbl) devLbl.textContent = t("settings.gh_dev_branch_lbl");
  const devHint = card.querySelector("#gh-dev-branch-hint");
  if (devHint) devHint.textContent = t("settings.gh_dev_branch_hint");

  // Indlæs nuværende branch-indstilling
  (async () => {
    try {
      const s = await api.getBackendSettings();
      if (devCb) devCb.checked = (s.github_branch || "main") === "dev";
    } catch (_) { /* ignore */ }
  })();

  // Gem ved toggle
  if (devCb) {
    devCb.addEventListener("change", async () => {
      const branch = devCb.checked ? "dev" : "main";
      try {
        const current = await api.getBackendSettings();
        await api.updateBackendSettings({ ...current, github_branch: branch });
        if (devResult) {
          devResult.innerHTML = `<span style="color:var(--success,#166534);font-size:0.82em;">${t("settings.gh_dev_branch_saved").replace("{branch}", branch)}</span>`;
          setTimeout(() => { devResult.innerHTML = ""; }, 3000);
        }
        // Ryd info så næste check henter fra ny branch
        infoEl.innerHTML = "";
        msgEl.innerHTML = "";
        if (notesEl) { notesEl.style.display = "none"; notesEl.innerHTML = ""; }
        pullBtn.hidden = true;
      } catch (err) {
        devCb.checked = !devCb.checked;
        if (devResult) devResult.innerHTML = `<span style="color:var(--danger,#991b1b);font-size:0.82em;">${esc(err.message)}</span>`;
      }
    });
  }

  function showInfo(data) {
    const cur    = `${data.current_version} build ${data.current_build}`;
    const lat    = data.latest_version ? `${data.latest_version} build ${data.latest_build}` : "–";
    const upd    = data.update_available;
    const git    = data.git_ready;
    const branch = data.branch || "main";

    infoEl.innerHTML = `
      <table class="gh-version-table">
        <tr><td>${t("settings.gh_current")}</td><td><strong>${esc(cur)}</strong></td></tr>
        <tr><td>${t("settings.gh_latest")}</td><td><strong>${esc(lat)}</strong> <span class="gh-branch-badge gh-branch-${esc(branch)}">${esc(branch)}</span></td></tr>
      </table>`;

    // Release notes — vis altid når de er tilgængelige (uanset om update er tilgængeligt)
    if (notesEl) {
      if (data.release_notes) {
        notesEl.style.display = "";
        const curSemver = (data.current_version || "").replace(/\.\d+$/, "").replace(/\.\d+$/, "").replace(/\.\d+$/, "");
        const curBase   = (data.current_version || "").split(".").slice(0, 3).join(".");
        const latBase   = (data.latest_version  || "").split(".").slice(0, 3).join(".");
        const isRange = data.update_available && curBase && latBase && curBase !== latBase;
        const rangeLabel = isRange
          ? `v${esc(curBase)} → v${esc(latBase)}`
          : `v${esc(latBase || curBase)}`;
        notesEl.innerHTML = `
          <details class="rn-details" open>
            <summary class="rn-summary">${esc(t("settings.gh_release_notes_hdr"))} — ${rangeLabel}</summary>
            <div class="rn-body">${renderReleaseNotesMd(data.release_notes)}</div>
          </details>`;
      } else {
        notesEl.style.display = "none";
        notesEl.innerHTML = "";
      }
    }

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
  const btn         = container.querySelector("#migration-sync-btn");
  const result      = container.querySelector("#migration-sync-result");
  const ensureBtn   = container.querySelector("#ensure-defs-btn");
  const ensureResult = container.querySelector("#ensure-defs-result");
  const debugCb     = container.querySelector("#debug-pxgrid-sessions-cb");
  const debugResult = container.querySelector("#debug-pxgrid-sessions-result");
  if (!btn) return;

  // Set element texts
  const advCardH3 = container.querySelector("#adv-card-h3");
  if (advCardH3) advCardH3.textContent = t("settings.adv_card");
  if (ensureBtn) ensureBtn.textContent = t("settings.adv_ensure_btn");
  btn.textContent = t("settings.adv_btn");
  const debugLbl = container.querySelector("#debug-pxgrid-sessions-lbl");
  if (debugLbl) debugLbl.textContent = t("settings.adv_debug_pxgrid_lbl");
  const debugHint = container.querySelector("#debug-pxgrid-sessions-hint");
  if (debugHint) debugHint.textContent = t("settings.adv_debug_pxgrid_hint");

  // Ensure definitions — light button (no endpoint scan)
  function _renderDefsResult(res, el) {
    const created  = res.definitions_created  || [];
    const existing = res.definitions_existing || [];
    const failed   = res.definitions_failed   || [];
    const total    = created.length + existing.length + failed.length;
    let html = "";
    if (created.length > 0)
      html += `<div style="color:#166534;font-size:0.85em;">${t("settings.adv_defs_created").replace("{attrs}", created.join(", "))}</div>`;
    if (total > 0)
      html += `<div style="font-size:0.85em;">${t("settings.adv_defs_ok").replace("{ok}", existing.length + created.length).replace("{total}", total)}</div>`;
    if (failed.length > 0)
      html += `<div style="color:#991b1b;font-size:0.85em;">${t("settings.adv_defs_fail").replace("{attrs}", failed.join(", "))}</div>`;
    if (el) el.innerHTML = `<div class="alert" style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:0.6rem 1rem;">${html}</div>`;
  }

  if (ensureBtn) {
    ensureBtn.addEventListener("click", async () => {
      ensureBtn.disabled = true;
      if (ensureResult) ensureResult.innerHTML = `<div class="alert" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:0.6rem 1rem;color:#1e40af;">${t("settings.adv_ensure_loading")}</div>`;
      try {
        const res = await api.ensureCustomAttrDefinitions();
        _renderDefsResult(res, ensureResult);
      } catch (err) {
        if (ensureResult) ensureResult.innerHTML = `<div class="alert" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:0.6rem 1rem;color:#991b1b;">${esc(err.message)}</div>`;
      } finally {
        ensureBtn.disabled = false;
      }
    });
  }

  // Decommission defaults
  const decommH4   = container.querySelector("#adv-decomm-h4");
  const decommHint = container.querySelector("#adv-decomm-hint");
  const decommVlanLbl  = container.querySelector("#adv-decomm-vlan-lbl");
  const decommVlanHint = container.querySelector("#adv-decomm-vlan-hint");
  const decommAclLbl   = container.querySelector("#adv-decomm-acl-lbl");
  const decommAclHint  = container.querySelector("#adv-decomm-acl-hint");
  const decommSaveBtn  = container.querySelector("#adv-decomm-save-btn");
  const decommVlanEl   = container.querySelector("#adv-decomm-vlan");
  const decommAclEl    = container.querySelector("#adv-decomm-acl");
  const decommMsg      = container.querySelector("#adv-decomm-msg");
  const decommForm     = container.querySelector("#adv-decomm-form");

  if (decommH4)       decommH4.textContent       = t("settings.adv_decomm_h4");
  if (decommHint)     decommHint.textContent      = t("settings.adv_decomm_hint");
  if (decommVlanLbl)  decommVlanLbl.textContent   = t("settings.adv_decomm_vlan_lbl");
  if (decommVlanHint) decommVlanHint.textContent  = t("settings.adv_decomm_vlan_hint");
  if (decommAclLbl)   decommAclLbl.textContent    = t("settings.adv_decomm_acl_lbl");
  if (decommAclHint)  decommAclHint.textContent   = t("settings.adv_decomm_acl_hint");
  if (decommSaveBtn)  decommSaveBtn.textContent   = t("settings.adv_decomm_save_btn");

  // Populate a <select> with values; pre-select savedValue (add it if missing)
  function _populateSelect(sel, values, savedValue) {
    if (!sel) return;
    sel.innerHTML = "";
    const all = savedValue && !values.includes(savedValue)
      ? [savedValue, ...values]
      : values;
    all.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === savedValue) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!all.length) {
      const opt = document.createElement("option");
      opt.value = savedValue || "";
      opt.textContent = savedValue || "—";
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // Disable save until dropdowns are populated to prevent saving "" on fast click
  if (decommSaveBtn) decommSaveBtn.disabled = true;

  // Load current debug + decommission settings, then populate dropdowns
  (async () => {
    try {
      const [s, caData, daclList] = await Promise.all([
        api.getBackendSettings(),
        api.listCustomAttributes().catch(() => null),
        api.listDacls().catch(() => null),
      ]);

      if (debugCb) debugCb.checked = !!s.debug_pxgrid_sessions;

      const savedVlan = s.decomm_authz_vlan ?? "999";
      const savedAcl  = s.decomm_authz_acl  ?? "deny_all_ipv4_traffic";

      // AuthzVlan values from custom_attr_values.json
      const vlanAttr = caData?.attributes?.find(a => a.name === "AuthzVlan");
      const vlanValues = (vlanAttr?.values ?? []).filter(Boolean);
      _populateSelect(decommVlanEl, vlanValues, savedVlan);

      // AuthzACL names from ISE DACLs
      const aclValues = (daclList ?? []).map(d => d.name).filter(Boolean);
      _populateSelect(decommAclEl, aclValues, savedAcl);
    } catch (_) { /* ignore */ }
    finally {
      if (decommSaveBtn) decommSaveBtn.disabled = false;
    }
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

  // Save decommission defaults
  if (decommForm) {
    decommForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const vlan = (decommVlanEl?.value ?? "").trim();
      const acl  = (decommAclEl?.value ?? "").trim();
      if (!vlan || !acl) return;
      decommSaveBtn.disabled = true;
      try {
        const current = await api.getBackendSettings();
        await api.updateBackendSettings({ ...current, decomm_authz_vlan: vlan, decomm_authz_acl: acl });
        decommMsg.innerHTML = `<span style="color:var(--success,#166534);font-size:0.82em;">${t("settings.adv_decomm_saved")}</span>`;
        setTimeout(() => { decommMsg.innerHTML = ""; }, 3000);
      } catch (err) {
        decommMsg.innerHTML = `<span style="color:var(--danger,#991b1b);font-size:0.82em;">${esc(err.message)}</span>`;
      } finally {
        decommSaveBtn.disabled = false;
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
      _renderDefsResult(res, ensureResult);
    } catch (err) {
      result.innerHTML = `<div class="alert" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:0.6rem 1rem;color:#991b1b;">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}

export async function initGuestRegSection(container) {
  const card    = container.querySelector("#guest-reg-card");
  if (!card) return;

  const form            = card.querySelector("#guest-reg-form");
  const enabledCb       = card.querySelector("#guest-reg-enabled");
  const ipskCb          = card.querySelector("#guest-reg-ipsk");
  const vlanSel         = card.querySelector("#guest-reg-vlan");
  const aclSel          = card.querySelector("#guest-reg-acl");
  const redirectEl      = card.querySelector("#guest-reg-redirect");
  const termsEl         = card.querySelector("#guest-reg-terms");
  const saveBtn         = card.querySelector("#guest-reg-save-btn");
  const msgEl           = card.querySelector("#guest-reg-msg");
  const urlDisplay      = card.querySelector("#guest-reg-url-display");
  const expiryCb        = card.querySelector("#guest-reg-expiry-enabled");
  const expiryOptions   = card.querySelector("#guest-reg-expiry-options");
  const expiryModeSel   = card.querySelector("#guest-reg-expiry-mode");
  const expiryPeriodRow = card.querySelector("#guest-reg-expiry-period-row");
  const expiryDateRow   = card.querySelector("#guest-reg-expiry-date-row");
  const expiryDaysEl    = card.querySelector("#guest-reg-expiry-days");
  const expiryDateEl    = card.querySelector("#guest-reg-expiry-date");
  const expiryTimeEl    = card.querySelector("#guest-reg-expiry-time");

  // Labels
  const h3 = card.querySelector("#guest-reg-h3");
  if (h3) h3.textContent = t("settings.guest_reg_title");
  const hint = card.querySelector("#guest-reg-hint");
  if (hint) hint.textContent = t("settings.guest_reg_hint");
  const enabledLbl = card.querySelector("#guest-reg-enabled-lbl");
  if (enabledLbl) enabledLbl.textContent = t("settings.guest_reg_enabled_lbl");
  const ipskLbl = card.querySelector("#guest-reg-ipsk-lbl");
  if (ipskLbl) ipskLbl.textContent = t("settings.guest_reg_ipsk_lbl");
  const ipskHint = card.querySelector("#guest-reg-ipsk-hint");
  if (ipskHint) ipskHint.textContent = t("settings.guest_reg_ipsk_hint");
  const vlanLbl = card.querySelector("#guest-reg-vlan-lbl");
  if (vlanLbl) vlanLbl.textContent = t("settings.guest_reg_vlan_lbl");
  const vlanHint = card.querySelector("#guest-reg-vlan-hint");
  if (vlanHint) vlanHint.textContent = t("settings.guest_reg_vlan_hint");
  const aclLbl = card.querySelector("#guest-reg-acl-lbl");
  if (aclLbl) aclLbl.textContent = t("settings.guest_reg_acl_lbl");
  const aclHint = card.querySelector("#guest-reg-acl-hint");
  if (aclHint) aclHint.textContent = t("settings.guest_reg_acl_hint");
  const redirectLbl = card.querySelector("#guest-reg-redirect-lbl");
  if (redirectLbl) redirectLbl.textContent = t("settings.guest_reg_redirect_lbl");
  const redirectHint = card.querySelector("#guest-reg-redirect-hint");
  if (redirectHint) redirectHint.textContent = t("settings.guest_reg_redirect_hint");
  const termsLbl = card.querySelector("#guest-reg-terms-lbl");
  if (termsLbl) termsLbl.textContent = t("settings.guest_reg_terms_lbl");
  const termsHint = card.querySelector("#guest-reg-terms-hint");
  if (termsHint) termsHint.textContent = t("settings.guest_reg_terms_hint");
  if (saveBtn) saveBtn.textContent = t("settings.guest_reg_save_btn");

  const expiryEnabledLbl = card.querySelector("#guest-reg-expiry-enabled-lbl");
  if (expiryEnabledLbl) expiryEnabledLbl.textContent = t("settings.guest_reg_expiry_enabled_lbl");
  const expiryEnabledHint = card.querySelector("#guest-reg-expiry-enabled-hint");
  if (expiryEnabledHint) expiryEnabledHint.textContent = t("settings.guest_reg_expiry_enabled_hint");
  const expiryModeLbl = card.querySelector("#guest-reg-expiry-mode-lbl");
  if (expiryModeLbl) expiryModeLbl.textContent = t("settings.guest_reg_expiry_mode_lbl");
  const expiryOptPeriod = card.querySelector("#guest-reg-expiry-opt-period");
  if (expiryOptPeriod) expiryOptPeriod.textContent = t("settings.guest_reg_expiry_period");
  const expiryOptDate = card.querySelector("#guest-reg-expiry-opt-date");
  if (expiryOptDate) expiryOptDate.textContent = t("settings.guest_reg_expiry_date_mode");
  const expiryDaysLbl = card.querySelector("#guest-reg-expiry-days-lbl");
  if (expiryDaysLbl) expiryDaysLbl.textContent = t("settings.guest_reg_expiry_days_lbl");
  const expiryDaysHint = card.querySelector("#guest-reg-expiry-days-hint");
  if (expiryDaysHint) expiryDaysHint.textContent = t("settings.guest_reg_expiry_days_hint");
  const expiryDateLbl = card.querySelector("#guest-reg-expiry-date-lbl");
  if (expiryDateLbl) expiryDateLbl.textContent = t("settings.guest_reg_expiry_date_lbl");
  const expiryDateHint = card.querySelector("#guest-reg-expiry-date-hint");
  if (expiryDateHint) expiryDateHint.textContent = t("settings.guest_reg_expiry_date_hint");
  const expiryTimeLbl = card.querySelector("#guest-reg-expiry-time-lbl");
  if (expiryTimeLbl) expiryTimeLbl.textContent = t("settings.guest_reg_expiry_time_lbl");

  function _updateExpiryVisibility() {
    if (!expiryOptions) return;
    const enabled = expiryCb?.checked ?? false;
    expiryOptions.style.display = enabled ? "" : "none";
    if (enabled && expiryModeSel) {
      const mode = expiryModeSel.value;
      if (expiryPeriodRow) expiryPeriodRow.style.display = mode === "period" ? "" : "none";
      if (expiryDateRow)   expiryDateRow.style.display   = mode === "date"   ? "" : "none";
    }
  }

  if (expiryCb)      expiryCb.addEventListener("change", _updateExpiryVisibility);
  if (expiryModeSel) expiryModeSel.addEventListener("change", _updateExpiryVisibility);

  // Vis URL
  if (urlDisplay) urlDisplay.textContent = window.location.origin + "/selfregister?mac=...";

  function _populateSelect(sel, values, savedValue) {
    if (!sel) return;
    sel.innerHTML = "";
    const emptyOpt = document.createElement("option");
    emptyOpt.value = ""; emptyOpt.textContent = `— ${t("settings.guest_reg_none")} —`;
    sel.appendChild(emptyOpt);
    const all = savedValue && !values.includes(savedValue) ? [savedValue, ...values] : values;
    all.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      if (v === savedValue) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!savedValue) sel.value = "";
  }

  // Load settings + populate dropdowns
  try {
    const [s, caData, daclList] = await Promise.all([
      api.getBackendSettings(),
      api.listCustomAttributes().catch(() => null),
      api.listDacls().catch(() => null),
    ]);

    if (enabledCb) enabledCb.checked = !!s.selfregister_enabled;
    if (ipskCb) ipskCb.checked = !!s.selfregister_ipsk_enabled;
    if (expiryCb) expiryCb.checked = !!s.selfregister_expiry_enabled;
    if (expiryModeSel) expiryModeSel.value = s.selfregister_expiry_mode || "period";
    if (expiryDaysEl) expiryDaysEl.value = s.selfregister_expiry_days ?? 30;
    if (expiryDateEl) expiryDateEl.value = s.selfregister_expiry_date || "";
    if (expiryTimeEl) expiryTimeEl.value = s.selfregister_expiry_time || "23:59";
    _updateExpiryVisibility();
    if (redirectEl) redirectEl.value = s.selfregister_redirect_url || "";
    if (termsEl) termsEl.value = s.selfregister_terms || "";

    const vlanAttr = caData?.attributes?.find(a => a.name === "AuthzVlan");
    _populateSelect(vlanSel, (vlanAttr?.values ?? []).filter(Boolean), s.selfregister_authz_vlan || "");
    _populateSelect(aclSel, (daclList ?? []).map(d => d.name).filter(Boolean), s.selfregister_authz_acl || "");
  } catch (_) { /* ignore */ }
  finally {
    if (saveBtn) saveBtn.disabled = false;
  }

  // Save
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saveBtn) saveBtn.disabled = true;
      try {
        const current = await api.getBackendSettings();
        await api.updateBackendSettings({
          ...current,
          selfregister_enabled:         enabledCb?.checked ?? true,
          selfregister_ipsk_enabled:    ipskCb?.checked ?? false,
          selfregister_expiry_enabled:  expiryCb?.checked ?? false,
          selfregister_expiry_mode:     expiryModeSel?.value || "period",
          selfregister_expiry_days:     parseInt(expiryDaysEl?.value, 10) || 30,
          selfregister_expiry_date:     expiryDateEl?.value || "",
          selfregister_expiry_time:     expiryTimeEl?.value || "23:59",
          selfregister_authz_vlan:      vlanSel?.value || "",
          selfregister_authz_acl:       aclSel?.value || "",
          selfregister_redirect_url:    redirectEl?.value?.trim() || "",
          selfregister_terms:           termsEl?.value?.trim() || current.selfregister_terms,
        });
        msgEl.innerHTML = `<span style="color:var(--success,#166534);font-size:0.82em;">${t("settings.guest_reg_saved")}</span>`;
        setTimeout(() => { msgEl.innerHTML = ""; }, 3000);
      } catch (err) {
        msgEl.innerHTML = `<span style="color:var(--danger,#991b1b);font-size:0.82em;">${esc(err.message)}</span>`;
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }
}
