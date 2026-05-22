// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { auth } from "../../auth.js";
import { esc } from "./shared.js";

const BASE = window.location.origin.startsWith("file://") ? "http://localhost:8000" : "";

async function authFetch(path, opts = {}) {
  const token = auth.getToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE}/api${path}`, { ...opts, headers });
}

export function initBackupSection(container) {
  const backupBtn    = container.querySelector("#cfg-backup-btn");
  const restoreInput = container.querySelector("#cfg-restore-input");
  const restoreBtn   = container.querySelector("#cfg-restore-btn");
  const msg          = container.querySelector("#cfg-backup-msg");

  if (!backupBtn) return;

  backupBtn.addEventListener("click", async () => {
    backupBtn.disabled = true;
    backupBtn.textContent = "Henter…";
    msg.innerHTML = "";
    try {
      const res = await authFetch("/config/backup");
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ise_portal_config_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      msg.innerHTML = `<div class="alert success">Backup downloadet — opbevar filen sikkert (indeholder credentials).</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Backup fejlede: ${esc(err.message)}</div>`;
    } finally {
      backupBtn.disabled = false;
      backupBtn.textContent = "Download backup";
    }
  });

  restoreInput.addEventListener("change", () => {
    restoreBtn.disabled = !restoreInput.files.length;
  });

  restoreBtn.addEventListener("click", async () => {
    const file = restoreInput.files[0];
    if (!file) return;

    if (!confirm(
      "Advarsel: Denne handling overskriver portalens konfigurationsfiler.\n\n" +
      "Bekræft kun hvis du har et gyldigt backup fra denne portal.\n\n" +
      "Fortsæt?"
    )) return;

    restoreBtn.disabled = true;
    restoreBtn.textContent = "Gendanner…";
    msg.innerHTML = "";

    try {
      const text = await file.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("Filen er ikke gyldig JSON");
      }

      const res = await authFetch("/config/restore", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.detail || JSON.stringify(data);
        throw new Error(detail);
      }

      const fileList = (data.restored || []).map((f) => `<li>${esc(f)}</li>`).join("");
      msg.innerHTML = `
        <div class="alert success">
          <strong>Konfiguration gendannet.</strong><br>${esc(data.message)}
          ${fileList ? `<ul style="margin:4px 0 0 16px;">${fileList}</ul>` : ""}
        </div>`;
      restoreInput.value = "";
      restoreBtn.disabled = true;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Gendannelse fejlede: ${esc(err.message)}</div>`;
      restoreBtn.disabled = false;
    } finally {
      restoreBtn.textContent = "Gendan backup";
    }
  });
}
