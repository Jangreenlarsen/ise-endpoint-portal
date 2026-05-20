// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/**
 * Dashboard view — aggregeret overblik over portal-sundhed.
 * Viser circuit breaker, endpoints, sessioner, cache, prewarm, seneste events og systemlog.
 */

import { api } from "../api.js";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtAge(s) {
  if (s === null || s === undefined) return "—";
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return (s / 60).toFixed(1) + "m";
  return (s / 3600).toFixed(1) + "h";
}

function severityColor(sev) {
  if (sev === "error")   return "#c0392b";
  if (sev === "warning") return "#e67e22";
  return "#2980b9";
}

function renderAlerts(alerts) {
  if (!alerts || !alerts.length) return "";
  return alerts.map((a) => `
    <div style="background:${severityColor(a.severity)};color:#fff;padding:8px 12px;border-radius:6px;margin-bottom:6px;">
      <strong>${esc(a.title)}</strong><br>
      <span style="font-size:.9em;">${esc(a.body)}</span>
    </div>`).join("");
}

function cbBadge(state) {
  const labels = ["CLOSED", "HALF-OPEN", "OPEN"];
  const colors = ["#27ae60", "#e67e22", "#c0392b"];
  const i = state ?? 0;
  const color = colors[i] || "#999";
  const label = labels[i] || "UNKNOWN";
  return `<span style="background:${color};color:#fff;padding:3px 10px;border-radius:12px;font-size:.85em;font-weight:600;">${label}</span>`;
}

function statRow(label, value, sub = "") {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid #f3f4f6;">
    <span style="color:#6b7280;font-size:.9em;">${label}</span>
    <span style="font-weight:500;">${value}${sub ? `<span style="font-size:.8em;color:#9ca3af;margin-left:4px;">${sub}</span>` : ""}</span>
  </div>`;
}

function card(title, body) {
  return `<div class="card" style="min-width:220px;flex:1;">
    <h3 style="margin-top:0;margin-bottom:.75rem;font-size:1rem;">${title}</h3>
    ${body}
  </div>`;
}

// ── Log-niveau farver ────────────────────────────────────────────────────────
const LOG_COLORS = {
  DEBUG:    { bg: "#f3f4f6", fg: "#6b7280" },
  INFO:     { bg: "#eff6ff", fg: "#2563eb" },
  WARNING:  { bg: "#fffbeb", fg: "#d97706" },
  ERROR:    { bg: "#fef2f2", fg: "#dc2626" },
  CRITICAL: { bg: "#fdf2f8", fg: "#9d174d" },
};

function logBadge(level) {
  const c = LOG_COLORS[level] || { bg: "#f3f4f6", fg: "#6b7280" };
  return `<span style="background:${c.bg};color:${c.fg};padding:1px 7px;border-radius:10px;font-size:.78em;font-weight:700;white-space:nowrap;">${esc(level)}</span>`;
}

function renderLogsTable(entries) {
  if (!entries || !entries.length) {
    return `<div class="hint" style="padding:.5rem 0;">Ingen log-linjer matcher filteret.</div>`;
  }
  return `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:.82em;font-family:monospace;">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;white-space:nowrap;">Tidspunkt</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;">Niveau</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;">Logger</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;">Besked</th>
      </tr></thead>
      <tbody>
        ${entries.map((e) => {
          const c = LOG_COLORS[e.level] || { bg: "#fff", fg: "#111" };
          const logger = (e.logger || "").replace(/^app\./, "");
          return `<tr style="background:${c.bg};">
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;white-space:nowrap;color:#6b7280;">${esc(e.timestamp)}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;">${logBadge(e.level)}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;white-space:nowrap;color:#374151;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(e.logger)}">${esc(logger)}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;color:${c.fg};word-break:break-all;">${esc(e.message)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderDashboardData(dash, alerts) {
  const cb = dash.circuit_breaker || {};
  const ep = dash.endpoints || {};
  const sl = ep.staleness || {};
  const cache = dash.cache || {};
  const prewarm = dash.prewarm || {};
  const sess = dash.sessions || {};
  const events = dash.recent_events || [];
  const alertList = alerts?.alerts || [];

  const alertsHtml = alertList.length ? `
    <div style="margin-bottom:1rem;">
      ${renderAlerts(alertList)}
    </div>` : "";

  const cbCard = card(
    "Circuit Breaker",
    `<div style="text-align:center;padding:.5rem 0;">${cbBadge(cb.state)}</div>` +
    statRow("Status", cb.state_label || "—"),
  );

  const epCard = card(
    "Endpoints",
    statRow("Totalt i cache", ep.total ?? "—") +
    statRow("Friske", sl.fresh_count ?? "—") +
    statRow("Stale", sl.stale_count ?? "—", sl.stale_pct != null ? `(${sl.stale_pct}%)` : "") +
    statRow("Meget stale", sl.very_stale_count ?? "—") +
    statRow("Ældste entry", fmtAge(sl.oldest_entry_age_s)) +
    statRow("Gnsn. alder", fmtAge(sl.average_entry_age_s)),
  );

  const sessCard = card(
    "Sessioner (pxGrid)",
    statRow("Aktive sessioner", sess.active ?? "—"),
  );

  const cacheCard = card(
    "Cache-statistik",
    statRow("Hit rate", cache.hit_rate_pct != null ? cache.hit_rate_pct + "%" : "—") +
    statRow("Hits", cache.hits ?? "—") +
    statRow("Misses", cache.misses ?? "—") +
    statRow("Stale serves", cache.stale_serves ?? "—") +
    statRow("Disk stale", cache.disk_stale ?? "—"),
  );

  const prewarmCard = prewarm.scan_number ? card(
    "Cache Prewarm",
    statRow("Scan #", prewarm.scan_number) +
    statRow("Endpoints", prewarm.total_endpoints ?? "—") +
    statRow("Sidst fuld scan", fmtAge(prewarm.last_full_scan_age_s) + " siden") +
    statRow("Drip rotation", fmtAge(prewarm.drip_cycle_s)) +
    statRow("Refreshet (drip)", prewarm.drip_refreshed_total ?? "—") +
    `<div style="margin-top:.5rem;font-size:.8em;color:#6b7280;">${prewarm.scanning ? "Scanning nu…" : "Idle"}</div>`,
  ) : "";

  const eventsHtml = events.length ? `
    <div class="card" style="grid-column:1/-1;">
      <h3 style="margin-top:0;margin-bottom:.75rem;font-size:1rem;">Seneste audit-hændelser</h3>
      <table style="width:100%;border-collapse:collapse;font-size:.85em;">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Tidspunkt</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Bruger</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Handling</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Ressource</th>
        </tr></thead>
        <tbody>
          ${events.map((e) => `<tr>
            <td style="padding:4px 8px;white-space:nowrap;border-bottom:1px solid #f3f4f6;">${esc((e.ts || "").replace("T", " ").slice(0, 19))}</td>
            <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;">${esc(e.actor_username || "—")}</td>
            <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;">${esc(e.action || "")}</td>
            <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;">${esc(e.resource_type || "")}${e.resource_id ? ` <span style="font-size:.8em;color:#9ca3af;">${esc(e.resource_id.slice(0, 12))}…</span>` : ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  return `
    ${alertsHtml}
    <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;">
      ${cbCard}
      ${epCard}
      ${sessCard}
      ${cacheCard}
      ${prewarmCard}
    </div>
    <div style="margin-top:1rem;">
      ${eventsHtml}
    </div>
  `;
}

export async function renderDashboard(container) {
  container.innerHTML = `
    <h2 style="margin-bottom:.5rem;">Dashboard</h2>
    <p class="hint" style="margin-bottom:1rem;">Aggregeret portal-sundhed — opdateres automatisk hvert 30. sekund.</p>
    <div class="metrics-toolbar" style="margin-bottom:1rem;">
      <button id="dash-refresh">Opdatér nu</button>
      <span id="dash-ts" class="hint" style="margin-left:.75rem;"></span>
    </div>
    <div id="dash-body"><div class="alert info">Henter dashboard…</div></div>

    <div id="dash-logs-section" style="margin-top:1.25rem;">
      <div class="card">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:1rem;flex:none;">Systemlog</h3>
          <label style="display:flex;align-items:center;gap:.3rem;font-size:.85em;color:#6b7280;">
            Niveau
            <select id="dash-log-level" style="font-size:.9em;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;">
              <option value="WARNING">WARNING+</option>
              <option value="ERROR">ERROR+</option>
              <option value="INFO">INFO+</option>
              <option value="DEBUG">DEBUG (alt)</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:.3rem;font-size:.85em;color:#6b7280;">
            Antal
            <select id="dash-log-lines" style="font-size:.9em;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;">
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
          <input id="dash-log-search" type="search" placeholder="Søg i log…"
            style="font-size:.85em;padding:3px 8px;border:1px solid #d1d5db;border-radius:4px;flex:1;min-width:140px;max-width:280px;">
          <span id="dash-log-ts" class="hint" style="font-size:.8em;margin-left:auto;"></span>
        </div>
        <div id="dash-logs-body"><div class="hint">Henter logs…</div></div>
      </div>
    </div>
  `;

  const body        = container.querySelector("#dash-body");
  const tsEl        = container.querySelector("#dash-ts");
  const refreshBtn  = container.querySelector("#dash-refresh");
  const logsBody    = container.querySelector("#dash-logs-body");
  const logLevelSel = container.querySelector("#dash-log-level");
  const logLinesSel = container.querySelector("#dash-log-lines");
  const logSearch   = container.querySelector("#dash-log-search");
  const logTsEl     = container.querySelector("#dash-log-ts");
  const logsSection = container.querySelector("#dash-logs-section");

  // Logs er admin-only — skjul sektionen stille ved 403
  let logsAvailable = true;
  let logSearchTimer = null;

  // Niveau-filter: prioritet DEBUG < INFO < WARNING < ERROR < CRITICAL
  const LEVEL_ORDER = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

  async function loadLogs() {
    if (!logsAvailable) return;
    const sel    = logLevelSel.value;
    const lines  = parseInt(logLinesSel.value, 10) || 50;
    const search = logSearch.value.trim();
    // Backend level-param er exact match — vi henter altid uden filter og
    // post-filtrerer client-side så "WARNING+" inkluderer ERROR og CRITICAL.
    const minIdx = LEVEL_ORDER.indexOf(sel);
    try {
      const res = await api.getLogs(lines * 4, "", search);
      let entries = res.entries || [];
      if (minIdx >= 0) {
        entries = entries.filter((e) => LEVEL_ORDER.indexOf(e.level) >= minIdx);
      }
      if (entries.length > lines) entries = entries.slice(0, lines);
      logsBody.innerHTML = renderLogsTable(entries);
      logTsEl.textContent = new Date().toLocaleTimeString();
    } catch (err) {
      if (err?.status === 403 || (err?.message || "").includes("403")) {
        logsAvailable = false;
        logsSection.style.display = "none";
      } else {
        logsBody.innerHTML = `<div class="hint">Kunne ikke hente log: ${esc(err.message)}</div>`;
      }
    }
  }

  async function load() {
    try {
      const [dash, alertsRes] = await Promise.all([
        api.getDashboard(),
        api.getAlerts().catch(() => ({ alerts: [] })),
      ]);
      body.innerHTML = renderDashboardData(dash, alertsRes);
      tsEl.textContent = "Opdateret: " + new Date().toLocaleTimeString();
    } catch (err) {
      body.innerHTML = `<div class="alert error">Kunne ikke hente dashboard: ${esc(err.message)}</div>`;
    }
    await loadLogs();
  }

  refreshBtn.addEventListener("click", load);

  logLevelSel.addEventListener("change", loadLogs);
  logLinesSel.addEventListener("change", loadLogs);
  logSearch.addEventListener("input", () => {
    clearTimeout(logSearchTimer);
    logSearchTimer = setTimeout(loadLogs, 400);
  });

  const timer = setInterval(() => {
    if (!container.isConnected) { clearInterval(timer); return; }
    load();
  }, 30_000);

  await load();

  return () => {
    clearInterval(timer);
    clearTimeout(logSearchTimer);
  };
}
