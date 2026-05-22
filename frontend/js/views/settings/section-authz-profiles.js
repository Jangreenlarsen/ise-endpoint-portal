// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "../browse-utils.js";

export async function initAuthzProfilesSection(container) {
  const msgEl      = container.querySelector("#authzp-msg");
  const tableBody  = container.querySelector("#authzp-table-body");
  const btnCheck   = container.querySelector("#authzp-check-btn");
  const btnEnsure  = container.querySelector("#authzp-ensure-btn");
  const allSection = container.querySelector("#authzp-all-section");
  const allList    = container.querySelector("#authzp-all-list");
  const btnLoadAll = container.querySelector("#authzp-load-all-btn");

  // ── Render standard profile status table ─────────────────────────────────
  function renderStatusRows(profiles) {
    tableBody.innerHTML = profiles.map((p) => `
      <tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td>
          <span class="status-badge ${p.exists ? "badge-ok" : "badge-warn"}">
            ${p.exists ? t("authzp.status_exists") : t("authzp.status_missing")}
          </span>
        </td>
        <td class="authzp-config-cell">${esc(p.description)}</td>
      </tr>`).join("");
  }

  // ── Check status ──────────────────────────────────────────────────────────
  async function checkStatus() {
    msgEl.innerHTML = `<div class="alert info">${t("authzp.checking")}</div>`;
    btnCheck.disabled = true;
    btnEnsure.disabled = true;
    try {
      const profiles = await api.checkStandardAuthzProfiles();
      renderStatusRows(profiles);
      const missing = profiles.filter((p) => !p.exists).length;
      if (missing === 0) {
        msgEl.innerHTML = `<div class="alert success">${t("authzp.ensure_ok")}</div>`;
        btnEnsure.disabled = true;
      } else {
        msgEl.innerHTML = "";
        btnEnsure.disabled = false;
      }
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    } finally {
      btnCheck.disabled = false;
    }
  }

  // ── Ensure (create missing) ───────────────────────────────────────────────
  async function ensureProfiles() {
    msgEl.innerHTML = `<div class="alert info">${t("authzp.ensuring")}</div>`;
    btnCheck.disabled = true;
    btnEnsure.disabled = true;
    try {
      const res = await api.ensureStandardAuthzProfiles();
      const parts = [];
      if (res.created?.length)       parts.push(t("authzp.ensure_created").replace("{names}", res.created.join(", ")));
      if (res.already_existed?.length) parts.push(t("authzp.ensure_existed").replace("{names}", res.already_existed.join(", ")));
      if (res.errors?.length)        parts.push(t("authzp.ensure_errors").replace("{errors}", res.errors.join("; ")));

      const cls = res.ok ? "success" : "error";
      msgEl.innerHTML = `<div class="alert ${cls}">${parts.map(esc).join(" ")}</div>`;

      // Re-check so badges update
      const profiles = await api.checkStandardAuthzProfiles();
      renderStatusRows(profiles);
    } catch (err) {
      msgEl.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    } finally {
      btnCheck.disabled = false;
    }
  }

  // ── Load all ISE profiles ─────────────────────────────────────────────────
  async function loadAllProfiles() {
    allList.innerHTML = `<div class="alert info">${t("authzp.all_loading")}</div>`;
    btnLoadAll.disabled = true;
    try {
      const profiles = await api.listAuthzProfiles();
      if (!profiles?.length) {
        allList.innerHTML = `<div class="hint">${t("authzp.all_empty")}</div>`;
        return;
      }
      allList.innerHTML = `
        <table class="authzp-all-table">
          <thead><tr><th>Name</th><th>ID</th><th>Description</th></tr></thead>
          <tbody>
            ${profiles.map((p) => `
              <tr>
                <td><strong>${esc(p.name)}</strong></td>
                <td class="hint" style="font-size:.8em">${esc(p.id)}</td>
                <td>${esc(p.description)}</td>
              </tr>`).join("")}
          </tbody>
        </table>`;
    } catch (err) {
      allList.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    } finally {
      btnLoadAll.disabled = false;
    }
  }

  btnCheck.addEventListener("click", checkStatus);
  btnEnsure.addEventListener("click", ensureProfiles);
  btnLoadAll.addEventListener("click", loadAllProfiles);

  // Auto-check on section load
  await checkStatus();
}
