// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/**
 * Dashboard view — aggregeret overblik over portal-sundhed.
 * Viser circuit breaker, endpoints, sessioner, cache, prewarm og seneste events.
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
  `;

  const body = container.querySelector("#dash-body");
  const tsEl = container.querySelector("#dash-ts");
  const refreshBtn = container.querySelector("#dash-refresh");
  let timer = null;

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
  }

  refreshBtn.addEventListener("click", load);

  timer = setInterval(() => {
    if (!container.isConnected) { clearInterval(timer); return; }
    load();
  }, 30_000);

  await load();

  return () => clearInterval(timer);
}
