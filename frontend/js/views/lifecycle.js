// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { auth } from "../auth.js";
import { esc, normalizeMac, addMarkedMacs, loadMarkedMacs, clearMarkedMacs } from "./browse-utils.js";

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

    const currentMarked = loadMarkedMacs();
    const hasMarked     = currentMarked.size > 0;

    const rows = data.stale.map((ep) => {
      const normMac  = normalizeMac(ep.mac);
      const isMarked = currentMarked.has(normMac);
      return `
      <tr class="lc-ep-row${isMarked ? " lc-marked" : ""}" data-mac="${esc(ep.mac)}" data-norm-mac="${esc(normMac)}">
        <td class="lc-select-cell" title="Marker til behandling i Browse">
          <input type="checkbox" class="lc-cb"${isMarked ? " checked" : ""} />
        </td>
        <td><code class="lc-mac">${esc(ep.mac)}${isMarked ? ' <span class="lc-pin" title="Markeret til behandling">📌</span>' : ""}</code></td>
        <td>${esc(ep.group_name)}</td>
        <td>${esc(ep.profile)}</td>
        <td>${esc(ep.owner)}</td>
        <td>${fmtFirstSeen(ep.first_seen_at)}</td>
        <td class="lc-age">${fmtAge(ep.cache_age_s)}</td>
        <td class="lc-browse-link lc-open-btn" title="Åbn i Browse / Edit">↗</td>
      </tr>`;
    }).join("");

    container.innerHTML = `
      <div class="view-section">
        <h2>Livscyklus — inaktive endpoints</h2>
        <p class="hint" style="margin-bottom:12px;">
          Endpoints der ikke har haft nogen portal-aktivitet (opret / rediger / slet) i det valgte tidsrum.
          Afkryds rækker og klik <strong>Marker →</strong> for at fremhæve dem i Browse/Edit til videre behandling.
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
          <button id="lc-mark-btn" class="btn-primary lc-mark-btn" disabled>📌 Marker valgte (0) →</button>
          ${hasMarked
            ? `<button id="lc-clear-marks" class="btn-secondary lc-clear-marks" title="${currentMarked.size} endpoint(s) markeret i Browse">Ryd markeringer (${currentMarked.size})</button>`
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
                     <th class="lc-select-cell">
                       <input type="checkbox" id="lc-select-all" title="Vælg alle" />
                     </th>
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

    // Helpers
    function getCheckedMacs() {
      return Array.from(container.querySelectorAll(".lc-cb:checked"))
        .map((cb) => cb.closest("tr")?.dataset.normMac)
        .filter(Boolean);
    }
    function updateMarkBtn() {
      const n   = getCheckedMacs().length;
      const btn = document.getElementById("lc-mark-btn");
      if (btn) {
        btn.disabled     = n === 0;
        btn.textContent  = `📌 Marker valgte (${n}) →`;
      }
    }

    // Vælg alle
    const selectAllCb = document.getElementById("lc-select-all");
    if (selectAllCb) {
      selectAllCb.addEventListener("change", () => {
        container.querySelectorAll(".lc-cb").forEach((cb) => { cb.checked = selectAllCb.checked; });
        updateMarkBtn();
      });
    }

    container.querySelectorAll(".lc-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        updateMarkBtn();
        if (selectAllCb) {
          const all   = container.querySelectorAll(".lc-cb");
          const checked = container.querySelectorAll(".lc-cb:checked");
          selectAllCb.indeterminate = checked.length > 0 && checked.length < all.length;
          selectAllCb.checked       = checked.length === all.length;
        }
      });
    });

    // Marker valgte → gem i localStorage og gå til Browse med markeret filter aktivt
    document.getElementById("lc-mark-btn")?.addEventListener("click", () => {
      const macs = getCheckedMacs();
      if (!macs.length) return;
      addMarkedMacs(macs);
      sessionStorage.setItem("browse_marked_filter", "1");
      location.hash = "#/browse";
    });

    // Ryd markeringer
    document.getElementById("lc-clear-marks")?.addEventListener("click", () => {
      clearMarkedMacs();
      load();
    });

    document.getElementById("lc-days").addEventListener("change", (e) => {
      days = parseInt(e.target.value, 10);
      load();
    });
    document.getElementById("lc-refresh").addEventListener("click", load);

    const exportBtn = document.getElementById("lc-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportCsv(data.stale, days));
    }

    // Klik på ↗ knap → åbn i Browse
    container.querySelectorAll(".lc-open-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = btn.closest("tr");
        if (row) {
          sessionStorage.setItem("browse_open_ep", row.dataset.mac);
          location.hash = "#/browse";
        }
      });
    });

    // Klik på rækken (ikke checkbox/knap) → åbn i Browse
    container.querySelectorAll(".lc-ep-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".lc-cb, .lc-open-btn, input")) return;
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
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}
