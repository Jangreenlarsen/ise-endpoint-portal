// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc } from "./browse-utils.js";

const LEVELS = ["", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
const LINE_OPTIONS = [100, 250, 500, 1000, 2500, 5000];

// ── Hjælper: download via skjult link (cookie-autentisering følger med) ───────

function triggerDownload(url) {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Analyse-rapport-panel ─────────────────────────────────────────────────────

function renderSummaryPanel(s) {
  const m     = s.meta || {};
  const files = (m.files_analyzed || []).map((f) => `${f.name} (${f.size_kb} KB)`).join(", ");
  const lvls  = s.level_counts || {};
  const cb    = s.circuit_breaker || {};
  const te    = s.transport_errors || {};
  const idle  = te.idle_before_s || {};
  const drip  = s.drip_refresh || {};
  const tops  = (s.top_issue_messages || []).slice(0, 10);
  const starts = s.startup_events || [];

  function pill(label, val, color = "#374151") {
    return `<span style="background:#f3f4f6;border-radius:6px;padding:2px 8px;font-size:.8rem;margin-right:.3rem;">
      <span style="color:#9ca3af;">${esc(label)}</span>
      <strong style="color:${color};margin-left:.3rem;">${esc(String(val ?? "—"))}</strong>
    </span>`;
  }

  const levelColors = { ERROR: "#dc2626", CRITICAL: "#9d174d", WARNING: "#d97706", INFO: "#2563eb", DEBUG: "#6b7280" };
  const levelPills = Object.entries(lvls)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => pill(k, v.toLocaleString(), levelColors[k] || "#374151"))
    .join("");

  const cbOpenColor  = (cb.open_count ?? 0) > 0 ? "#dc2626" : "#16a34a";
  const teColor      = (te.total ?? 0)      > 0 ? "#d97706" : "#16a34a";

  const topRows = tops.map((r) =>
    `<tr>
      <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;font-size:.78rem;color:#374151;word-break:break-all;">${esc(r.message)}</td>
      <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;font-size:.78rem;text-align:right;font-weight:600;color:#dc2626;white-space:nowrap;">${r.count}</td>
    </tr>`
  ).join("");

  const startRows = starts.slice(-8).reverse().map((e) =>
    `<tr>
      <td style="padding:2px 8px;font-size:.78rem;color:#6b7280;white-space:nowrap;">${esc(e.ts)}</td>
      <td style="padding:2px 8px;font-size:.78rem;font-weight:600;color:#2563eb;">${esc(e.version)}</td>
    </tr>`
  ).join("");

  const dripEff = drip.efficiency_pct != null
    ? `${drip.efficiency_pct}% effektivitet (${(drip.total_refreshed ?? 0).toLocaleString()} refreshed / ${(drip.total_skipped ?? 0).toLocaleString()} skipped)`
    : "—";

  return `
  <div style="background:#fff;border-radius:10px;padding:1.1rem 1.25rem;border:1px solid #e5e7eb;margin-top:1rem;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.7rem;">
      <h3 style="margin:0;font-size:.95rem;color:#111827;">${t("logs.summary_title")}</h3>
      <span style="font-size:.75rem;color:#9ca3af;">${m.current_version ?? ""} · ${m.url ?? ""}</span>
    </div>

    <div style="font-size:.75rem;color:#6b7280;margin-bottom:.6rem;">
      ${t("logs.summary_meta")}: ${esc(m.time_range?.first ?? "?")} → ${esc(m.time_range?.last ?? "?")}
      · ${(m.total_lines_analyzed ?? 0).toLocaleString()} linjer · ${esc(files)}
    </div>

    <div style="margin-bottom:.7rem;">
      <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:.3rem;">${t("logs.summary_levels")}</div>
      ${levelPills}
    </div>

    <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.7rem;">
      <div>
        <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:.3rem;">${t("logs.summary_cb")}</div>
        ${pill("events", cb.total_events ?? 0)}
        ${pill("OPEN", cb.open_count ?? 0, cbOpenColor)}
        ${pill("CLOSED", cb.close_count ?? 0, "#16a34a")}
      </div>
      <div>
        <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:.3rem;">${t("logs.summary_transport")}</div>
        ${pill("total", te.total ?? 0, teColor)}
        ${Object.entries(te.by_exception_type || {}).map(([k, v]) => pill(k, v, "#d97706")).join("")}
        ${idle.avg != null ? pill("idle avg", idle.avg + "s") : ""}
        ${idle.max != null ? pill("idle max", idle.max + "s", idle.max > 1800 ? "#dc2626" : "#d97706") : ""}
      </div>
      <div>
        <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:.3rem;">Drip</div>
        <span style="font-size:.8rem;color:#374151;">${esc(dripEff)}</span>
      </div>
    </div>

    ${tops.length ? `
    <div style="margin-bottom:.7rem;">
      <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:.3rem;">${t("logs.summary_top_issues")} (top 10)</div>
      <div style="overflow-x:auto;max-height:200px;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${topRows}</tbody>
        </table>
      </div>
    </div>` : ""}

    ${startRows ? `
    <div>
      <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:.3rem;">${t("logs.summary_startup")}</div>
      <table style="border-collapse:collapse;"><tbody>${startRows}</tbody></table>
    </div>` : ""}
  </div>`;
}

// ── Hoved-render ──────────────────────────────────────────────────────────────

export async function renderLogs(container) {
  container.innerHTML = `
    <h2>${t("logs.title")}</h2>
    <p class="hint">${t("logs.hint")}</p>

    <div class="card">
      <div class="logs-toolbar">
        <label>
          ${t("logs.label_level")}
          <select id="log-level">
            ${LEVELS.map((l) => `<option value="${l}">${l || t("logs.all_levels")}</option>`).join("")}
          </select>
        </label>
        <label>
          ${t("logs.label_lines")}
          <select id="log-lines">
            ${LINE_OPTIONS.map((n) => `<option value="${n}"${n === 500 ? " selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <label class="log-search-label">
          ${t("logs.label_search")}
          <input type="text" id="log-search" placeholder="${t("logs.search_placeholder")}" />
        </label>
        <button id="log-refresh">${t("logs.btn_refresh")}</button>
        <span id="log-meta" class="hint"></span>
      </div>

      <div style="display:flex;gap:.5rem;flex-wrap:wrap;padding:.5rem 0 .75rem;border-bottom:1px solid #f3f4f6;margin-bottom:.75rem;align-items:center;">
        <button id="log-export-text" class="btn-secondary" title="${t("logs.export_hint")}">
          ⬇ ${t("logs.btn_export_text")}
        </button>
        <button id="log-export-ndjson" class="btn-secondary" title="${t("logs.export_hint")}">
          ⬇ ${t("logs.btn_export_ndjson")}
        </button>
        <button id="log-summary" class="btn-secondary">
          📊 ${t("logs.btn_summary")}
        </button>
        <span style="font-size:.75rem;color:#9ca3af;">${t("logs.export_hint")}</span>
      </div>

      <div id="log-summary-panel"></div>
      <div id="log-msg"></div>
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>
            <tr>
              <th style="width:11rem;">${t("logs.col_time")}</th>
              <th style="width:5.5rem;">${t("logs.col_level")}</th>
              <th style="width:14rem;">${t("logs.col_logger")}</th>
              <th>${t("logs.col_msg")}</th>
            </tr>
          </thead>
          <tbody id="log-tbody">
            <tr><td colspan="4" class="empty">${t("logs.loading")}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const tbody       = container.querySelector("#log-tbody");
  const msg         = container.querySelector("#log-msg");
  const meta        = container.querySelector("#log-meta");
  const summaryPanel = container.querySelector("#log-summary-panel");
  const levelSel    = container.querySelector("#log-level");
  const linesSel    = container.querySelector("#log-lines");
  const searchInput = container.querySelector("#log-search");

  container.querySelector("#log-refresh").addEventListener("click", load);
  levelSel.addEventListener("change", load);
  linesSel.addEventListener("change", load);

  let debounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 350);
  });

  // ── Download-knapper ────────────────────────────────────────────────────────
  container.querySelector("#log-export-text").addEventListener("click", () => {
    triggerDownload(api.getLogsExportUrl("text"));
  });
  container.querySelector("#log-export-ndjson").addEventListener("click", () => {
    triggerDownload(api.getLogsExportUrl("ndjson"));
  });

  // ── Analyse-rapport-knap (toggle) ──────────────────────────────────────────
  let summaryVisible = false;
  container.querySelector("#log-summary").addEventListener("click", async () => {
    if (summaryVisible) {
      summaryPanel.innerHTML = "";
      summaryVisible = false;
      return;
    }
    summaryPanel.innerHTML = `<div class="hint" style="padding:.5rem 0;">${t("logs.summary_loading")}</div>`;
    try {
      const data = await api.getLogsSummary();
      summaryPanel.innerHTML = renderSummaryPanel(data);
      summaryVisible = true;
    } catch (err) {
      summaryPanel.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  // ── Log-tabel ───────────────────────────────────────────────────────────────
  async function load() {
    msg.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${t("logs.loading")}</td></tr>`;
    try {
      const data = await api.getLogs(
        parseInt(linesSel.value, 10),
        levelSel.value,
        searchInput.value.trim(),
      );
      const entries = data.entries || [];
      if (!entries.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty">${t("logs.no_entries")}</td></tr>`;
        meta.textContent = "0 entries";
        return;
      }
      tbody.innerHTML = entries
        .map((e) => {
          const lvl = (e.level || "").toUpperCase();
          const lvlClass = `log-level log-level-${lvl.toLowerCase()}`;
          return `<tr>
            <td class="mono">${esc(e.timestamp)}</td>
            <td><span class="${lvlClass}">${esc(lvl)}</span></td>
            <td class="mono">${esc(e.logger)}</td>
            <td class="log-msg-cell">${esc(e.message)}</td>
          </tr>`;
        })
        .join("");
      meta.textContent = `${entries.length} entries`;
    } catch (err) {
      tbody.innerHTML = "";
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      meta.textContent = "";
    }
  }

  await load();
}
