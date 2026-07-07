// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { esc } from "./shared.js";
import { t } from "../../i18n.js";

const BASE = window.location.origin.startsWith("file://") ? "http://localhost:8000" : "";

async function authFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  return fetch(`${BASE}/api${path}`, { ...opts, headers, credentials: "include" });
}

export function initBackupSection(container) {
  const backupBtn    = container.querySelector("#cfg-backup-btn");
  const restoreInput = container.querySelector("#cfg-restore-input");
  const restoreBtn   = container.querySelector("#cfg-restore-btn");
  const msg          = container.querySelector("#cfg-backup-msg");

  if (!backupBtn) return;

  const backupPass  = container.querySelector("#cfg-backup-pass");
  const restorePass = container.querySelector("#cfg-restore-pass");

  backupBtn.addEventListener("click", async () => {
    backupBtn.disabled = true;
    backupBtn.textContent = t("settings.backup_btn_loading");
    msg.innerHTML = "";
    const pass = backupPass?.value || "";
    try {
      // Med passphrase: POST → krypteret fuld backup. Uden: GET → plain (redigeret).
      const res = pass
        ? await authFetch("/config/backup", { method: "POST", body: JSON.stringify({ passphrase: pass }) })
        : await authFetch("/config/backup");
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const kind = pass ? "encrypted" : "plain";
      a.download = `ise_portal_config_backup_${kind}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (backupPass) backupPass.value = "";
      msg.innerHTML = `<div class="alert success">${t("settings.backup_success")}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.backup_error").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      backupBtn.disabled = false;
      backupBtn.textContent = t("settings.backup_btn");
    }
  });

  restoreInput.addEventListener("change", () => {
    restoreBtn.disabled = !restoreInput.files.length;
  });

  restoreBtn.addEventListener("click", async () => {
    const file = restoreInput.files[0];
    if (!file) return;

    if (!confirm(t("settings.restore_confirm"))) return;

    restoreBtn.disabled = true;
    restoreBtn.textContent = t("settings.restore_btn_loading");
    msg.innerHTML = "";

    try {
      const text = await file.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(t("settings.restore_invalid_json"));
      }

      const res = await authFetch("/config/restore", {
        method: "POST",
        body: JSON.stringify({ backup: body, passphrase: restorePass?.value || "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.detail || JSON.stringify(data);
        throw new Error(detail);
      }

      const fileList = (data.restored || []).map((f) => `<li>${esc(f)}</li>`).join("");
      msg.innerHTML = `
        <div class="alert success">
          <strong>${t("settings.restore_success")}</strong><br>${esc(data.message)}
          ${fileList ? `<ul style="margin:4px 0 0 16px;">${fileList}</ul>` : ""}
        </div>`;
      restoreInput.value = "";
      if (restorePass) restorePass.value = "";
      restoreBtn.disabled = true;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.restore_error").replace("{msg}", esc(err.message))}</div>`;
      restoreBtn.disabled = false;
    } finally {
      restoreBtn.textContent = t("settings.restore_btn");
    }
  });
}
