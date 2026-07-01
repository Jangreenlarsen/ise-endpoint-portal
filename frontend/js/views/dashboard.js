// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/**
 * Dashboard — aggregeret portal-overblik med KPI-kort, mini trend-chart,
 * livscyklus-summary, audit-events og systemlog.
 */

import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
import { esc } from "./browse-utils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(s) {
  if (s === null || s === undefined) return "—";
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return (s / 60).toFixed(1) + "m";
  return (s / 3600).toFixed(1) + "h";
}

function statRow(label, value, sub = "") {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #f9fafb;">
    <span style="color:#6b7280;font-size:.85em;">${label}</span>
    <span style="font-weight:500;font-size:.88em;">${value}${sub ? `<span style="font-size:.8em;color:#9ca3af;margin-left:4px;">${sub}</span>` : ""}</span>
  </div>`;
}

function resBar(label, pct, usedLabel) {
  if (pct === null || pct === undefined) return "";
  const color = pct >= 90 ? "#dc2626" : pct >= 75 ? "#d97706" : "#16a34a";
  return `<div style="padding:4px 0;border-bottom:1px solid #f9fafb;">
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
      <span style="color:#6b7280;font-size:.82em;">${label}</span>
      <span style="font-size:.82em;font-weight:500;color:${color}">${pct.toFixed(0)}%${usedLabel ? `<span style="color:#9ca3af;font-weight:400;margin-left:4px;font-size:.9em;">${usedLabel}</span>` : ""}</span>
    </div>
    <div style="background:#f3f4f6;border-radius:3px;height:5px;overflow:hidden;">
      <div style="width:${Math.min(pct,100)}%;height:100%;background:${color};border-radius:3px;transition:width .4s;"></div>
    </div>
  </div>`;
}

// ── KPI-kort ──────────────────────────────────────────────────────────────────

function kpiCard(label, value, sub = "", accent = "#2563eb") {
  return `<div style="background:#fff;border-radius:12px;padding:1.1rem 1.25rem;
    box-shadow:0 1px 4px rgba(0,0,0,.07);border-top:3px solid ${accent};
    min-width:140px;flex:1;">
    <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
      color:#9ca3af;margin-bottom:.45rem;">${label}</div>
    <div style="font-size:2rem;font-weight:700;color:#111827;line-height:1.1;">${value}</div>
    ${sub ? `<div style="font-size:.77rem;color:#9ca3af;margin-top:.3rem;">${sub}</div>` : ""}
  </div>`;
}

// ── CB-badge ──────────────────────────────────────────────────────────────────

function cbPill(state) {
  const labels = ["CLOSED", "HALF-OPEN", "OPEN"];
  const colors = ["#16a34a", "#d97706", "#dc2626"];
  const i = state ?? 0;
  return `<span style="background:${colors[i] || "#9ca3af"};color:#fff;
    padding:3px 14px;border-radius:20px;font-size:.8em;font-weight:700;
    letter-spacing:.05em;">${labels[i] || "?"}</span>`;
}

// ── Action-badge (audit events) ───────────────────────────────────────────────

function actionBadge(action) {
  if (!action) return "—";
  const a = action.toLowerCase();
  let bg = "#f1f5f9", fg = "#475569";
  if (a.includes("delete"))                     { bg = "#fee2e2"; fg = "#b91c1c"; }
  else if (a.includes("create") || a.includes("import")) { bg = "#dcfce7"; fg = "#15803d"; }
  else if (a.includes("update") || a.includes("edit"))   { bg = "#fef9c3"; fg = "#854d0e"; }
  return `<span style="background:${bg};color:${fg};padding:1px 8px;border-radius:10px;
    font-size:.79em;font-weight:600;white-space:nowrap;">${esc(action)}</span>`;
}

// ── Mini sparkline (ingen tooltip — Trend Analyse har fuld interaktivitet) ────

function sparkline(labels, series, height = 110) {
  const W = 640, H = height;
  const pad = { top: 8, right: 6, bottom: 20, left: 6 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const allVals = series.flatMap((s) => s.data);
  const rawMax = Math.max(...allVals, 1);
  const rawMin = Math.min(0, ...allVals);
  const yMin = rawMin < 0 ? rawMin * 1.15 : 0;
  const yMax = rawMax * 1.15 || 5;
  const yRange = yMax - yMin || 1;
  const n = labels.length - 1;
  const xOf = (i) => pad.left + (i / Math.max(n, 1)) * plotW;
  const yOf = (v) => pad.top + plotH - ((v - yMin) / yRange) * plotH;

  let svg = "";
  for (let i = 1; i <= 3; i++) {
    const y = yOf(yMin + (i / 4) * (yMax - yMin)).toFixed(1);
    svg += `<line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>`;
  }
  if (yMin < 0) {
    const y0 = yOf(0).toFixed(1);
    svg += `<line x1="${pad.left}" y1="${y0}" x2="${pad.left + plotW}" y2="${y0}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>`;
  }
  series.forEach((s) => {
    const pts = s.data.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
    if (s.fill) {
      const y0 = yOf(0).toFixed(1);
      svg += `<polygon points="${xOf(0).toFixed(1)},${y0} ${pts} ${xOf(n).toFixed(1)},${y0}" fill="${s.color}" fill-opacity="0.12"/>`;
    }
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  if (labels.length) {
    svg += `<text x="${pad.left + 2}" y="${H - 3}" font-size="9" fill="#9ca3af">${labels[0].slice(5)}</text>`;
    svg += `<text x="${pad.left + plotW - 2}" y="${H - 3}" font-size="9" fill="#9ca3af" text-anchor="end">${labels[n].slice(5)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">${svg}</svg>`;
}

// ── System health-kort (fra diagnostics/quick) ───────────────────────────────

const DIAG_ICON  = { ok: "✅", warning: "⚠️", error: "❌" };
const DIAG_COLOR = { ok: "#16a34a", warning: "#d97706", error: "#dc2626" };

function healthCard(diag, isAdmin) {
  if (!diag || diag._error) return "";
  const overall      = diag.overall || "ok";
  const checks       = diag.checks  || [];
  const overallColor = DIAG_COLOR[overall] || "#6b7280";
  const overallIcon  = DIAG_ICON[overall]  || "?";
  const warnCount    = checks.filter(c => c.status === "warning").length;
  const errCount     = checks.filter(c => c.status === "error").length;
  const overallLabel = overall === "ok"
    ? "System OK"
    : overall === "error"
      ? `${errCount} fejl${warnCount ? ` · ${warnCount} advarsler` : ""}`
      : `${warnCount} advarsel${warnCount !== 1 ? "er" : ""}`;

  const rows = checks.map(c => `
    <div style="display:flex;align-items:baseline;gap:.4rem;padding:2px 0;">
      <span style="flex:none;font-size:.9em;">${DIAG_ICON[c.status] || "?"}</span>
      <span style="font-size:.8em;color:#374151;flex:1;min-width:0;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;" title="${esc(c.message)}">${esc(c.name)}</span>
      <span style="font-size:.75em;color:${DIAG_COLOR[c.status] || "#6b7280"};
        flex:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${esc(c.message)}">${esc(c.message.split("\n")[0].slice(0, 40))}</span>
    </div>`).join("");

  const diagLink = isAdmin
    ? `<a href="#/settings" style="display:block;text-align:right;font-size:.76rem;
        color:#2563eb;text-decoration:none;margin-top:.5rem;padding-top:.4rem;
        border-top:1px solid #f3f4f6;">Fuld diagnostik →</a>`
    : "";

  return `<div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
    box-shadow:0 1px 4px rgba(0,0,0,.07);border-top:3px solid ${overallColor};">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;">
      <h3 style="margin:0;font-size:.92rem;color:#374151;font-weight:600;">System sundhed</h3>
      <span style="font-size:.8em;font-weight:700;color:${overallColor};">
        ${overallIcon} ${esc(overallLabel)}
      </span>
    </div>
    ${rows}
    ${diagLink}
  </div>`;
}

// ── Log-tabel ─────────────────────────────────────────────────────────────────

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
  if (!entries || !entries.length)
    return `<div class="hint" style="padding:.5rem 0;">${t("dash.log_no_match")}</div>`;
  return `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:.82em;font-family:monospace;">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;white-space:nowrap;">${t("dash.log_col_time")}</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;">${t("dash.log_col_level")}</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;">${t("dash.log_col_logger")}</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-family:sans-serif;">${t("dash.log_col_msg")}</th>
      </tr></thead>
      <tbody>
        ${entries.map((e) => {
          const c = LOG_COLORS[e.level] || { bg: "#fff", fg: "#111" };
          const logger = (e.logger || "").replace(/^app\./, "");
          return `<tr style="background:${c.bg};">
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;white-space:nowrap;color:#6b7280;">${esc(e.timestamp)}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;">${logBadge(e.level)}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;white-space:nowrap;color:#374151;max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${esc(e.logger)}">${esc(logger)}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #f3f4f6;color:${c.fg};word-break:break-all;">${esc(e.message)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

// ── Compose dashboard HTML ─────────────────────────────────────────────────────

function iseAuthBanner(iseAuth) {
  const s = iseAuth?.status;
  if (!s || s === "ok") return "";
  const locked = s === "locked";
  const bg     = locked ? "#fef2f2" : "#fffbeb";
  const border = locked ? "#dc2626" : "#d97706";
  const icon   = locked ? "🔒" : "⚠️";
  const n      = iseAuth.consecutive_401s ?? 0;
  const since  = iseAuth.locked_since
    ? new Date(iseAuth.locked_since * 1000).toLocaleTimeString()
    : null;
  const title  = locked
    ? t("dash.ise_auth_locked_title") || "ISE API-bruger låst ude"
    : t("dash.ise_auth_warn_title")   || "ISE authentication fejler";
  const steps  = locked ? `
    <ol style="margin:.5rem 0 0 1.2rem;padding:0;font-size:.85rem;color:#374151;line-height:1.7;">
      <li>Åbn ISE GUI og gå til <strong>Administration → System → Admin Access → Administrators → Admin Users</strong></li>
      <li>Find API-brugeren (typisk <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;">${esc(t("dash.ise_api_user") || "ers-admin")}</code>) og sæt <strong>Enabled = Yes</strong></li>
      <li>Kontrollér <strong>Administration → System → Admin Access → Authentication → Account Disable Policy</strong> — overvej at sætte "Disable after X days inactivity" til 0 (aldrig)</li>
      <li>Portalen genopretter forbindelsen automatisk når ISE godkender</li>
    </ol>` : `<p style="margin:.4rem 0 0;font-size:.85rem;color:#374151;">
      Kontrollér brugernavn/password: <a href="#/settings" style="color:#2563eb;">${t("dash.ise_auth_settings_link") || "Settings → ISE-forbindelse"}</a>
    </p>`;
  return `<div style="background:${bg};border-left:4px solid ${border};border-radius:8px;
    padding:.85rem 1rem;margin-bottom:.75rem;">
    <div style="display:flex;align-items:baseline;gap:.5rem;">
      <span style="font-size:1.05rem;">${icon}</span>
      <strong style="color:${border};font-size:.92rem;">${esc(title)}</strong>
      <span style="font-size:.8rem;color:#9ca3af;margin-left:auto;">
        401 × ${n}${since ? ` — siden ${since}` : ""}
      </span>
    </div>
    ${steps}
  </div>`;
}

function compose(dash, trends, lifecycle, isAdmin, diagQuick, sysinfo) {
  const cb      = dash.circuit_breaker || {};
  const ep      = dash.endpoints       || {};
  const cache   = dash.cache           || {};
  const prewarm = dash.prewarm         || {};
  const sess    = dash.sessions        || {};
  const events  = dash.recent_events   || [];
  const snap    = trends?.snapshot     || {};

  const cbColors = ["#16a34a", "#d97706", "#dc2626"];
  const cbAccent = cbColors[cb.state ?? 0] || "#9ca3af";

  // ── KPI-rad ──────────────────────────────────────────────────────────────
  const totalEp = snap.total ?? ep.total;
  const hitRate = cache.hit_rate_pct != null ? cache.hit_rate_pct + "%" : "—";

  let kpiRow = `<div style="display:flex;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem;">
    ${kpiCard(t("dash.kpi_endpoints"),
        totalEp != null ? Number(totalEp).toLocaleString() : "—",
        t("dash.kpi_endpoints_sub"), "#2563eb")}
    ${kpiCard(t("dash.kpi_private_macs") || "Private MACs (LAA)",
        snap.laa != null ? snap.laa.toLocaleString() : "—",
        snap.laa_pct != null ? snap.laa_pct + "% " + (t("trend.stat_laa_pct") || "% of total").replace("% ", "") : "",
        "#d97706")}`;

  if (isAdmin && lifecycle && !lifecycle._error) {
    const staleAccent = (lifecycle.stale_count ?? 0) > 0 ? "#dc2626" : "#16a34a";
    kpiRow += kpiCard(
      t("dash.kpi_inactive"),
      lifecycle.stale_count ?? "—",
      t("dash.kpi_inactive_sub").replace("{days}", lifecycle.threshold_days ?? 90),
      staleAccent
    );
  }

  kpiRow += `
    ${kpiCard(t("dash.sys_hit_rate"), hitRate,
        `${cache.hits ?? "—"} hits · ${cache.misses ?? "—"} misses`, "#0891b2")}
    ${kpiCard("Circuit Breaker",
        ["CLOSED","HALF-OPEN","OPEN"][cb.state ?? 0] || "?",
        cb.state_label || "", cbAccent)}
  </div>`;

  // ── Trend mini-chart ──────────────────────────────────────────────────────
  let trendCard = "";
  if (trends && !trends._error) {
    const { labels, added, removed, net } = trends;
    const totalAdded   = added.reduce((s, v) => s + v, 0);
    const totalRemoved = removed.reduce((s, v) => s + v, 0);
    const netChange    = totalAdded - totalRemoved;
    const netColor     = netChange >= 0 ? "#2563eb" : "#dc2626";

    if (snap.cache_loading) {
      trendCard = `<div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
        box-shadow:0 1px 4px rgba(0,0,0,.07);display:flex;align-items:center;
        justify-content:center;min-height:120px;">
        <span style="color:#9ca3af;font-size:.88rem;">${t("dash.cache_loading")}</span>
      </div>`;
    } else {
      trendCard = `<div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
        box-shadow:0 1px 4px rgba(0,0,0,.07);">
        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:.5rem;flex-wrap:wrap;gap:.4rem;">
          <h3 style="margin:0;font-size:.92rem;color:#374151;font-weight:600;">
            ${t("dash.trend_title")}
          </h3>
          <a href="#/trends" style="font-size:.8rem;color:#2563eb;text-decoration:none;
            white-space:nowrap;">${t("dash.trend_link")}</a>
        </div>
        ${sparkline(labels, [
          { name: t("dash.series_added"),   color: "#059669", data: added,   fill: true },
          { name: t("dash.series_removed"), color: "#dc2626", data: removed, fill: true },
          { name: t("dash.series_net"),     color: "#2563eb", data: net },
        ])}
        <div style="display:flex;gap:1.25rem;margin-top:.5rem;flex-wrap:wrap;align-items:center;">
          <span style="font-size:.82rem;"><span style="color:#059669;font-weight:700;">+${totalAdded}</span> <span style="color:#6b7280;">${t("dash.lbl_added")}</span></span>
          <span style="font-size:.82rem;"><span style="color:#dc2626;font-weight:700;">−${totalRemoved}</span> <span style="color:#6b7280;">${t("dash.lbl_removed")}</span></span>
          <span style="font-size:.82rem;"><span style="color:${netColor};font-weight:700;">${netChange >= 0 ? "+" : ""}${netChange}</span> <span style="color:#6b7280;">${t("dash.lbl_net")}</span></span>
          ${snap.laa != null ? `<span style="font-size:.82rem;margin-left:auto;color:#9ca3af;">${t("dash.lbl_laa_now")} <strong style="color:#d97706;">${snap.laa.toLocaleString()}</strong></span>` : ""}
        </div>
      </div>`;
    }
  }

  // ── Systemstatus-kort ─────────────────────────────────────────────────────
  const prewarmRows = prewarm.scan_number ? `
    <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid #f3f4f6;">
      <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
        color:#9ca3af;margin-bottom:.35rem;">${t("dash.prewarm_title")}</div>
      ${statRow("Scan #", prewarm.scan_number)}
      ${statRow("Endpoints", prewarm.total_endpoints ?? "—")}
      ${statRow(t("dash.prewarm_last_scan"), fmtAge(prewarm.last_full_scan_age_s) + t("dash.prewarm_ago"))}
      <div style="font-size:.77rem;color:#9ca3af;margin-top:.3rem;">${prewarm.scanning ? t("dash.prewarm_scanning") : "Idle"}</div>
    </div>` : "";

  const si = sysinfo || {};
  const sysCard = `<div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
    box-shadow:0 1px 4px rgba(0,0,0,.07);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;">
      <h3 style="margin:0;font-size:.92rem;color:#374151;font-weight:600;">${t("dash.sys_title")}</h3>
      ${cbPill(cb.state)}
    </div>
    ${resBar("CPU", si.cpu_pct ?? null, si.cpu_pct != null ? "" : "")}
    ${resBar("RAM", si.ram_pct ?? null, si.ram_used_gb != null ? `${si.ram_used_gb}/${si.ram_total_gb} GB` : "")}
    ${resBar("Disk", si.disk_pct ?? null, si.disk_free_gb != null ? `${si.disk_free_gb} GB fri` : "")}
    ${si.cpu_pct == null ? `<div style="font-size:.75rem;color:#9ca3af;padding:4px 0;border-bottom:1px solid #f9fafb;">psutil ikke installeret — kør OTA-opdatering</div>` : ""}
    ${statRow(t("dash.sys_sessions"), sess.active ?? "—")}
    ${statRow(t("dash.sys_hit_rate"), hitRate)}
    ${statRow("Stale serves", cache.stale_serves ?? "—")}
    ${statRow(t("dash.sys_disk_loaded"), cache.disk_loaded_at_startup ?? "0")}
    ${prewarmRows}
  </div>`;

  // ── Livscyklus-summary (admin) ────────────────────────────────────────────
  let lcCard = "";
  if (isAdmin && lifecycle && !lifecycle._error) {
    const hasStale   = (lifecycle.stale_count ?? 0) > 0;
    const staleColor = hasStale ? "#dc2626" : "#16a34a";
    lcCard = `<div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;">
        <h3 style="margin:0;font-size:.92rem;color:#374151;font-weight:600;">${t("dash.lc_title")}</h3>
        <a href="#/lifecycle" style="font-size:.8rem;color:#2563eb;text-decoration:none;">${t("dash.lc_link")}</a>
      </div>
      <div style="text-align:center;padding:.4rem 0 .6rem;">
        <div style="font-size:2.5rem;font-weight:700;color:${staleColor};line-height:1;">${lifecycle.stale_count ?? "—"}</div>
        <div style="font-size:.8rem;color:#9ca3af;margin-top:.25rem;">${t("dash.lc_inactive_label").replace("{days}", lifecycle.threshold_days ?? 90)}</div>
        <div style="font-size:.77rem;color:#6b7280;margin-top:.2rem;">${t("dash.lc_total_label").replace("{total}", lifecycle.total_cached ?? "—")}</div>
      </div>
      ${hasStale
        ? `<a href="#/lifecycle" style="display:block;text-align:center;padding:.4rem;
            background:#fef2f2;color:#dc2626;border-radius:8px;font-size:.82rem;
            text-decoration:none;font-weight:500;">${t("dash.lc_review_link")}</a>`
        : `<div style="text-align:center;font-size:.82rem;color:#16a34a;font-weight:500;">${t("dash.lc_no_inactive")}</div>`}
    </div>`;
  }

  // ── Audit events ──────────────────────────────────────────────────────────
  let eventsCard = "";
  if (events.length) {
    eventsCard = `<div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);">
      <h3 style="margin:0 0 .75rem;font-size:.92rem;color:#374151;font-weight:600;">${t("dash.events_title")}</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.85em;">
          <thead><tr>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:500;white-space:nowrap;">${t("dash.col_time")}</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:500;">${t("dash.col_user")}</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:500;">${t("dash.col_action")}</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:500;">${t("dash.col_resource")}</th>
          </tr></thead>
          <tbody>
            ${events.map((e) => `<tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f9fafb;color:#9ca3af;font-size:.82em;white-space:nowrap;">${esc((e.ts || "").replace("T", " ").slice(0, 19))}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f9fafb;font-weight:500;">${esc(e.actor_username || "—")}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f9fafb;">${actionBadge(e.action)}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f9fafb;color:#374151;">
                ${esc(e.resource_type || "")}
                ${e.resource_id ? `<span style="font-size:.8em;color:#9ca3af;margin-left:4px;">${esc(e.resource_id.slice(0, 12))}…</span>` : ""}
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // ── Samlet layout ─────────────────────────────────────────────────────────
  const hCard = healthCard(diagQuick, isAdmin);

  // Bundlinje: system stats + lifecycle + audit events side om side
  const bottomItems = [sysCard, lcCard, eventsCard].filter(Boolean);
  const bottomRow = bottomItems.length
    ? `<div style="display:flex;gap:.75rem;align-items:flex-start;flex-wrap:wrap;margin-top:.75rem;">
        ${bottomItems.map(c => `<div style="flex:1;min-width:240px;">${c}</div>`).join("")}
      </div>`
    : "";

  return `
    ${iseAuthBanner(dash.ise_auth)}
    ${kpiRow}
    <div style="display:flex;gap:.75rem;align-items:flex-start;flex-wrap:wrap;">
      <div style="flex:2;min-width:320px;">${trendCard}</div>
      ${hCard ? `<div style="flex:1;min-width:270px;">${hCard}</div>` : ""}
    </div>
    ${bottomRow}
  `;
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function renderDashboard(container) {
  container.innerHTML = `
    <div style="padding:1.25rem;max-width:1100px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
        margin-bottom:1.1rem;flex-wrap:wrap;gap:.5rem;">
        <div>
          <h2 style="margin:0;font-size:1.15rem;font-weight:700;">${t("dash.title")}</h2>
          <p style="margin:.15rem 0 0;font-size:.8rem;color:#9ca3af;">${t("dash.subtitle")}</p>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;">
          <span id="dash-ts" style="font-size:.8rem;color:#9ca3af;"></span>
          <button id="dash-refresh" style="border:1px solid #d1d5db;border-radius:8px;
            padding:5px 14px;font-size:.88rem;background:#fff;cursor:pointer;color:#374151;">${t("dash.btn_refresh")}</button>
        </div>
      </div>

      <div id="dash-alerts"></div>
      <div id="dash-body"><div style="color:#9ca3af;padding:2rem 0;">${t("dash.loading")}</div></div>

      <div id="dash-logs-section" style="margin-top:.75rem;">
        <div style="background:#fff;border-radius:12px;padding:1rem 1.25rem;
          box-shadow:0 1px 4px rgba(0,0,0,.07);">
          <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:.92rem;font-weight:600;color:#374151;flex:none;">${t("dash.log_title")}</h3>
            <label style="display:flex;align-items:center;gap:.3rem;font-size:.85em;color:#6b7280;">
              ${t("dash.log_level_label")}
              <select id="dash-log-level" style="font-size:.9em;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;">
                <option value="WARNING">WARNING+</option>
                <option value="ERROR">ERROR+</option>
                <option value="INFO">INFO+</option>
                <option value="DEBUG">DEBUG (alt)</option>
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:.3rem;font-size:.85em;color:#6b7280;">
              ${t("dash.log_count_label")}
              <select id="dash-log-lines" style="font-size:.9em;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;">
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </label>
            <input id="dash-log-search" type="search" placeholder="${t("dash.log_search_ph")}"
              style="font-size:.85em;padding:3px 8px;border:1px solid #d1d5db;border-radius:4px;
                flex:1;min-width:140px;max-width:280px;">
            <span id="dash-log-ts" style="font-size:.8em;color:#9ca3af;margin-left:auto;"></span>
          </div>
          <div id="dash-logs-body"><div class="hint">${t("dash.log_loading")}</div></div>
        </div>
      </div>
    </div>`;

  const alertsEl   = container.querySelector("#dash-alerts");
  const body        = container.querySelector("#dash-body");
  const tsEl        = container.querySelector("#dash-ts");
  const refreshBtn  = container.querySelector("#dash-refresh");
  const logsBody    = container.querySelector("#dash-logs-body");
  const logLevelSel = container.querySelector("#dash-log-level");
  const logLinesSel = container.querySelector("#dash-log-lines");
  const logSearch   = container.querySelector("#dash-log-search");
  const logTsEl     = container.querySelector("#dash-log-ts");
  const logsSection = container.querySelector("#dash-logs-section");

  const user    = auth.getUser();
  const isAdmin = user?.role === "admin";

  let logsAvailable = true;
  let logSearchTimer = null;
  const LEVEL_ORDER = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

  async function loadLogs() {
    if (!logsAvailable) return;
    const sel    = logLevelSel.value;
    const lines  = parseInt(logLinesSel.value, 10) || 50;
    const search = logSearch.value.trim();
    const minIdx = LEVEL_ORDER.indexOf(sel);
    try {
      const res = await api.getLogs(lines * 4, "", search);
      let entries = res.entries || [];
      if (minIdx >= 0) entries = entries.filter((e) => LEVEL_ORDER.indexOf(e.level) >= minIdx);
      if (entries.length > lines) entries = entries.slice(0, lines);
      logsBody.innerHTML = renderLogsTable(entries);
      logTsEl.textContent = new Date().toLocaleTimeString();
    } catch (err) {
      if (err?.status === 403 || (err?.message || "").includes("403")) {
        logsAvailable = false;
        logsSection.style.display = "none";
      } else {
        logsBody.innerHTML = `<div class="hint">${t("dash.log_error").replace("{msg}", esc(err.message))}</div>`;
      }
    }
  }

  async function load() {
    try {
      const [dash, alertsRes, trendsRes, lifecycleRes, diagQuick, sysinfo] = await Promise.all([
        api.getDashboard(),
        api.getAlerts().catch(() => ({ alerts: [] })),
        api.getTrends("30d").catch((e) => ({ _error: e.message })),
        isAdmin
          ? api.getStaleEndpoints(90).catch((e) => ({ _error: e.message }))
          : Promise.resolve(null),
        api.diagnosticsQuick().catch((e) => ({ _error: e.message })),
        api.sysinfo().catch(() => null),
      ]);

      const alertList = alertsRes?.alerts || [];
      if (alertList.length) {
        alertsEl.innerHTML = `<div style="margin-bottom:.75rem;">` +
          alertList.map((a) => `
            <div style="background:${a.severity === "error" ? "#dc2626" : "#d97706"};
              color:#fff;padding:8px 14px;border-radius:10px;margin-bottom:6px;">
              <strong>${esc(a.title)}</strong>
              <span style="font-size:.9em;margin-left:.5rem;">${esc(a.body)}</span>
            </div>`).join("") +
          "</div>";
      } else {
        alertsEl.innerHTML = "";
      }

      body.innerHTML = compose(dash, trendsRes, lifecycleRes, isAdmin, diagQuick, sysinfo);
      tsEl.textContent = t("dash.updated") + new Date().toLocaleTimeString();
    } catch (err) {
      body.innerHTML = `<div class="alert error">${t("dash.error").replace("{msg}", esc(err.message))}</div>`;
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
