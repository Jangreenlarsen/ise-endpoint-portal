// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { auth } from "../auth.js";
import { esc } from "./browse-utils.js";

function fmtAge(s) {
  if (s === null || s === undefined) return "—";
  const days = Math.floor(s / 86400);
  const h    = Math.floor((s % 86400) / 3600);
  const m    = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${h}t`;
  if (h > 0)    return `${h}t ${m}m`;
  return `${m}m`;
}

function fmtFirstSeen(ts) {
  if (!ts) return `<span class="lc-age">—</span>`;
  const d       = new Date(ts * 1000);
  const date    = d.toISOString().slice(0, 10);
  const ageSec  = Date.now() / 1000 - ts;
  const ageDays = Math.floor(ageSec / 86400);
  const ageStr  = ageDays >= 1 ? `${ageDays}d` : `${Math.floor(ageSec / 3600)}t`;
  return `<span style="white-space:nowrap;">${esc(date)} <span class="lc-age">(${ageStr})</span></span>`;
}

export async function renderLifecycle(container) {
  const user = auth.getUser();
  if (!user || user.role !== "admin") {
    container.innerHTML = `<div class="view-section"><p class="error-msg">Kun administrator-adgang.</p></div>`;
    return;
  }

  let days = 90;
  let _retryTimer = null;

  async function load() {
    container.innerHTML = `<div class="view-section"><p class="loading-msg">Indlæser livscyklus-data…</p></div>`;
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

    let data;
    try {
      data = await api.getStaleEndpoints(days);
    } catch (e) {
      container.innerHTML = `<div class="view-section"><p class="error-msg">Fejl ved hentning: ${esc(e.message)}</p></div>`;
      return;
    }

    if (data.cache_loading) {
      container.innerHTML = `
        <div class="view-section">
          <h2>Livscyklus — inaktive endpoints</h2>
          <div class="alert info" style="margin-top:1rem;">
            Endpoint-cachen indlæses fra ISE. Siden opdateres automatisk når data er klar…
          </div>
        </div>`;
      _retryTimer = setTimeout(load, 10000);
      return;
    }

    const rows = data.stale.map((ep) => `
      <tr class="lc-ep-row" data-mac="${esc(ep.mac)}" title="Klik for at åbne i Browse / Edit">
        <td><code class="lc-mac">${esc(ep.mac)}</code></td>
        <td>${esc(ep.group_name)}</td>
        <td>${esc(ep.profile)}</td>
        <td>${esc(ep.owner)}</td>
        <td>${fmtFirstSeen(ep.first_seen_at)}</td>
        <td class="lc-age">${fmtAge(ep.cache_age_s)}</td>
        <td class="lc-browse-link">↗</td>
      </tr>`).join("");

    container.innerHTML = `
      <div class="view-section">
        <h2>Livscyklus — inaktive endpoints</h2>
        <p class="hint" style="margin-bottom:12px;">
          Endpoints der ikke har haft nogen portal-aktivitet (opret / rediger / slet) i det valgte tidsrum.
          Klik på en række for at åbne endpointet direkte i Browse / Edit.
        </p>
        <div class="lc-controls">
          <label>Inaktiv i mere end:
            <select id="lc-days">
              <option value="30"  ${days === 30  ? "selected" : ""}>30 dage</option>
              <option value="60"  ${days === 60  ? "selected" : ""}>60 dage</option>
              <option value="90"  ${days === 90  ? "selected" : ""}>90 dage</option>
              <option value="180" ${days === 180 ? "selected" : ""}>180 dage</option>
              <option value="365" ${days === 365 ? "selected" : ""}>365 dage</option>
            </select>
          </label>
          <button id="lc-refresh" class="btn-secondary">Opdatér</button>
          ${data.stale_count > 0
            ? `<button id="lc-export" class="btn-secondary">Eksportér CSV</button>`
            : ""}
        </div>

        <p class="lc-summary">
          <strong>${data.stale_count}</strong> af <strong>${data.total_cached}</strong>
          endpoints har ikke haft portal-aktivitet i over ${data.threshold_days} dage.
        </p>

        ${data.stale_count === 0
          ? `<p class="lc-empty">Ingen inaktive endpoints fundet for det valgte interval.</p>`
          : `<div class="table-scroll">
               <table class="lc-table">
                 <thead>
                   <tr>
                     <th>MAC-adresse</th>
                     <th>Endpoint-gruppe</th>
                     <th>Profil</th>
                     <th>Ejer</th>
                     <th>Første gang set</th>
                     <th>Cache-alder</th>
                     <th style="width:28px;"></th>
                   </tr>
                 </thead>
                 <tbody>${rows}</tbody>
               </table>
             </div>`
        }
      </div>`;

    document.getElementById("lc-days").addEventListener("change", (e) => {
      days = parseInt(e.target.value, 10);
      load();
    });
    document.getElementById("lc-refresh").addEventListener("click", load);

    const exportBtn = document.getElementById("lc-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportCsv(data.stale, days));
    }

    // Klik på række → gem MAC i sessionStorage og naviger til Browse/Edit
    container.querySelectorAll(".lc-ep-row").forEach((row) => {
      row.addEventListener("click", () => {
        sessionStorage.setItem("browse_open_ep", row.dataset.mac);
        location.hash = "#/browse";
      });
    });
  }

  await load();
}

function exportCsv(rows, days) {
  const header = "MAC-adresse,Endpoint-gruppe,Profil,Ejer,Første gang set,Cache-alder (s)";
  const lines = rows.map((ep) =>
    [ep.mac, ep.group_name, ep.profile, ep.owner,
     ep.first_seen_at ? new Date(ep.first_seen_at * 1000).toISOString().slice(0, 10) : "",
     ep.cache_age_s ?? ""].map(csvCell).join(",")
  );
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `livscyklus_inaktive_${days}dage_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = (v ?? "").toString();
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
