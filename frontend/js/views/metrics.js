// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/**
 * Metrics view — viser Prometheus-data fra GET /metrics som et live dashboard.
 * Parser Prometheus text format direkte i browseren uden externe biblioteker.
 */

import { t, getLocale } from "../i18n.js";
import { api } from "../api.js";
import { esc } from "./browse-utils.js";

const BASE = window.location.origin.startsWith("file://")
  ? "http://localhost:8000"
  : "";

// ── Delt cursor-tooltip til historik-grafer ───────────────────────────────
let _mtip = null;
function metricsTip() {
  if (!_mtip) {
    _mtip = document.createElement("div");
    _mtip.style.cssText = [
      "position:fixed", "pointer-events:none", "z-index:9999",
      "background:#1f2937", "color:#f9fafb", "border-radius:8px",
      "padding:.4rem .7rem", "font-size:.8rem", "line-height:1.5",
      "box-shadow:0 4px 16px rgba(0,0,0,.35)", "display:none",
    ].join(";");
    document.body.appendChild(_mtip);
  }
  return _mtip;
}

// ------------------------------------------------------------------ //
// Prometheus text-format parser                                        //
// ------------------------------------------------------------------ //

function parsePrometheus(text) {
  const result = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const spaceIdx = trimmed.lastIndexOf(" ");
    if (spaceIdx === -1) continue;
    const labelPart = trimmed.slice(0, spaceIdx);
    const value = parseFloat(trimmed.slice(spaceIdx + 1));
    if (isNaN(value)) continue;
    const braceIdx = labelPart.indexOf("{");
    const name = braceIdx === -1 ? labelPart : labelPart.slice(0, braceIdx);
    const labels = {};
    if (braceIdx !== -1) {
      const labelStr = labelPart.slice(braceIdx + 1, -1);
      for (const match of labelStr.matchAll(/(\w+)="([^"]*)"/g)) {
        labels[match[1]] = match[2];
      }
    }
    if (!result[name]) result[name] = [];
    result[name].push({ labels, value });
  }
  return result;
}

function getScalar(parsed, name) {
  const series = parsed[name];
  if (!series || !series.length) return null;
  return series[0].value;
}

function getLabeled(parsed, name, labelKey, labelValue) {
  const series = parsed[name];
  if (!series) return 0;
  const match = series.find((s) => s.labels[labelKey] === labelValue);
  return match ? match.value : 0;
}

// ------------------------------------------------------------------ //
// Formatting helpers                                                   //
// ------------------------------------------------------------------ //

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return "–";
  const locale = getLocale() === "da" ? "da-DK" : "en-GB";
  return Number(n).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pct(a, b) {
  const total = a + b;
  if (!total) return "–";
  return fmt((a / total) * 100, 1) + "%";
}

function cbLabel(state) {
  if (state === 0) return { text: t("metrics.cb_closed"),  cls: "cb-closed" };
  if (state === 1) return { text: t("metrics.cb_halfopen"), cls: "cb-halfopen" };
  return { text: t("metrics.cb_open"), cls: "cb-open" };
}

function fmtAge(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return "–";
  if (seconds < 60) return Math.round(seconds) + "s";
  if (seconds < 3600) return (seconds / 60).toFixed(1) + "m";
  return (seconds / 3600).toFixed(1) + "h";
}

function capacityBadge(cycleS, intervalS) {
  if (!cycleS || !intervalS) return "";
  const ratio = cycleS / intervalS;
  if (ratio <= 0.9) return ` <span style="background:#27ae60;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;">${t("metrics.capacity_ok")}</span>`;
  if (ratio <= 1.1) return ` <span style="background:#f39c12;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;">${t("metrics.capacity_warn")}</span>`;
  return ` <span style="background:#c0392b;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;">${t("metrics.capacity_behind")}</span>`;
}

// ------------------------------------------------------------------ //
// Render                                                               //
// ------------------------------------------------------------------ //

function buildStatCard(title, stats) {
  const rows = stats
    .map(
      ({ label, value, sub }) =>
        `<div class="metric-stat">
          <span class="metric-stat-label">${label}</span>
          <span class="metric-stat-value">${value}</span>
          ${sub ? `<span class="metric-stat-sub">${sub}</span>` : ""}
        </div>`,
    )
    .join("");
  return `<div class="card metrics-card"><h3>${title}</h3><div class="metric-stats">${rows}</div></div>`;
}

function renderData(parsed) {
  const cbState = getScalar(parsed, "ise_portal_circuit_breaker_state") ?? 0;
  const { text: cbText, cls: cbCls } = cbLabel(cbState);

  const ise2xx = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "2xx");
  const ise4xx = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "4xx");
  const ise5xx = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "5xx");
  const iseErr = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "error");
  const iseTotal = ise2xx + ise4xx + ise5xx + iseErr;
  const retries = getScalar(parsed, "ise_portal_ise_retries_total") ?? 0;

  const durSum = getScalar(parsed, "ise_portal_ise_request_duration_seconds_sum") ?? 0;
  const durCount = getScalar(parsed, "ise_portal_ise_request_duration_seconds_count") ?? 0;
  const durMean = durCount > 0 ? durSum / durCount : null;

  const cacheEntries = getScalar(parsed, "ise_portal_cache_entries") ?? 0;
  const hits = getScalar(parsed, "ise_portal_cache_hits_total") ?? 0;
  const misses = getScalar(parsed, "ise_portal_cache_misses_total") ?? 0;
  const stale = getScalar(parsed, "ise_portal_cache_stale_serves_total") ?? 0;
  const evictions = getScalar(parsed, "ise_portal_cache_evictions_total") ?? 0;
  const diskStale = getScalar(parsed, "ise_portal_cache_disk_stale_entries") ?? 0;

  const dripRefreshed = getScalar(parsed, "ise_portal_cache_drip_refreshed_total");
  const dripSkipped   = getScalar(parsed, "ise_portal_cache_drip_skipped_total");
  const dripSleepS    = getScalar(parsed, "ise_portal_cache_drip_sleep_seconds");
  const dripCycleS    = getScalar(parsed, "ise_portal_cache_drip_cycle_seconds");
  const oldestAgeS    = getScalar(parsed, "ise_portal_cache_oldest_entry_age_seconds");
  const avgAgeS       = getScalar(parsed, "ise_portal_cache_avg_entry_age_seconds");
  const staleCount    = getScalar(parsed, "ise_portal_cache_stale_entries");
  const stalePct      = getScalar(parsed, "ise_portal_cache_stale_pct");
  const dripActive    = dripRefreshed !== null;

  // Adaptiv styring (6.22.0726 drip-hastighed + 6.24.0728 aktivitets-TTL)
  const adaptiveSpeed = getScalar(parsed, "ise_portal_cache_adaptive_speed_factor");
  const effectiveTtl  = getScalar(parsed, "ise_portal_cache_effective_ttl_seconds");
  const portalIdle    = getScalar(parsed, "ise_portal_portal_idle_seconds");
  const scanIntervalS = getScalar(parsed, "ise_portal_cache_scan_interval_seconds");
  const adaptiveActive = adaptiveSpeed !== null || effectiveTtl !== null;

  const blocked = getScalar(parsed, "ise_portal_rate_limit_blocked_total") ?? 0;

  const bulkOk = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "succeeded");
  const bulkFail = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "failed");
  const bulkSkip = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "skipped");
  const bulkOver = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "overwritten");

  return `
    <div class="metrics-hero">
      <div class="cb-badge ${cbCls}">
        <span class="cb-dot"></span>
        <span>${t("metrics.card_cb")}: <strong>${cbText}</strong></span>
      </div>
    </div>

    <div class="metrics-grid">
      ${buildStatCard(t("metrics.card_ise"), [
        { label: t("metrics.total_requests"),  value: fmt(iseTotal) },
        { label: t("metrics.successful_2xx"),  value: fmt(ise2xx), sub: pct(ise2xx, iseTotal - ise2xx) + " " + t("metrics.hit_rate") },
        { label: t("metrics.errors_4xx"),      value: fmt(ise4xx) },
        { label: t("metrics.errors_5xx"),      value: fmt(ise5xx) },
        { label: t("metrics.transport_errors"),value: fmt(iseErr) },
        { label: t("metrics.retries"),         value: fmt(retries) },
        { label: t("metrics.avg_response"),    value: durMean !== null ? fmt(durMean * 1000, 1) + " ms" : "–" },
      ])}

      ${buildStatCard(t("metrics.card_cache"), [
        { label: t("metrics.cache_entries"),   value: fmt(cacheEntries) },
        { label: t("metrics.cache_hits"),      value: fmt(hits), sub: pct(hits, misses) + " " + t("metrics.hit_rate") },
        { label: t("metrics.cache_misses"),    value: fmt(misses) },
        { label: t("metrics.cache_stale"),     value: fmt(stale) },
        { label: t("metrics.cache_evictions"), value: fmt(evictions) },
        { label: t("metrics.cache_disk_stale"),value: fmt(diskStale) },
      ])}

      ${dripActive ? buildStatCard(t("metrics.card_drip"), [
        { label: t("metrics.drip_interval"),    value: fmtAge(dripSleepS),  sub: dripCycleS ? t("metrics.drip_full_rotation") + fmtAge(dripCycleS) + capacityBadge(dripCycleS, 1800) : "" },
        { label: t("metrics.drip_refreshed"),   value: dripRefreshed !== null ? fmt(dripRefreshed) : "–" },
        { label: t("metrics.drip_skipped"),     value: dripSkipped !== null ? fmt(dripSkipped) : "–",  sub: t("metrics.drip_skipped_sub") },
        { label: t("metrics.drip_oldest"),      value: fmtAge(oldestAgeS) },
        { label: t("metrics.drip_avg_age"),     value: fmtAge(avgAgeS) },
        { label: t("metrics.drip_stale"),       value: staleCount !== null ? fmt(staleCount) : "–",    sub: stalePct !== null ? fmt(stalePct, 1) + "%" : "" },
      ]) : ""}

      ${adaptiveActive ? buildStatCard(t("metrics.card_adaptive"), [
        { label: t("metrics.adaptive_speed"), value: adaptiveSpeed !== null ? fmt(adaptiveSpeed, 2) + "×" : "–", sub: t("metrics.adaptive_speed_sub") },
        { label: t("metrics.effective_ttl"),  value: fmtAge(effectiveTtl) },
        { label: t("metrics.portal_idle"),    value: fmtAge(portalIdle) },
        { label: t("metrics.scan_interval"),  value: fmtAge(scanIntervalS) },
      ]) : ""}

      ${buildStatCard(t("metrics.card_rate"), [
        { label: t("metrics.rate_blocked"), value: fmt(blocked) },
      ])}

      ${buildStatCard(t("metrics.card_bulk"), [
        { label: t("metrics.bulk_created"),    value: fmt(bulkOk) },
        { label: t("metrics.bulk_overwritten"),value: fmt(bulkOver) },
        { label: t("metrics.bulk_skipped"),    value: fmt(bulkSkip) },
        { label: t("metrics.bulk_failed"),     value: fmt(bulkFail) },
      ])}
    </div>
  `;
}

// ------------------------------------------------------------------ //
// Main export                                                          //
// ------------------------------------------------------------------ //

export async function renderMetrics(container) {
  container.innerHTML = `
    <h2>${t("metrics.title")}</h2>
    <p class="hint">${t("metrics.hint")}</p>
    <div class="metrics-toolbar">
      <button id="metrics-refresh">${t("metrics.btn_refresh")}</button>
      <span id="metrics-ts" class="hint"></span>
    </div>
    <div id="metrics-body"><div class="alert info">${t("metrics.loading")}</div></div>
  `;

  const body = container.querySelector("#metrics-body");
  const tsEl = container.querySelector("#metrics-ts");
  const refreshBtn = container.querySelector("#metrics-refresh");
  let timer = null;
  let histLimit = 120;  // periodevælger i historik-kortet (120=2h … 1440=24h)
  const HIST_NAMES = [
    "cache_entries", "cache_stale_pct", "ise_requests_total", "circuit_state",
    "adaptive_speed_factor", "effective_ttl_s", "portal_idle_s", "scan_interval_s",
  ];

  function renderNodesCard(nodes) {
    if (!nodes || !nodes.length) return "";
    const rows = nodes.map((n) => {
      const reachable = n.reachable !== false;
      const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${reachable ? "#27ae60" : "#c0392b"};margin-right:5px;"></span>`;
      return `<div class="metric-stat">
        <span class="metric-stat-label">${dot}${esc(n.name || n.hostname || n.id)}</span>
        <span class="metric-stat-value" style="font-size:.8em;">${esc(n.roles?.join(", ") || "—")}</span>
        ${n.version ? `<span class="metric-stat-sub">v${esc(n.version)}</span>` : ""}
      </div>`;
    }).join("");
    return `<div class="card metrics-card"><h3>${t("metrics.psn_nodes")}</h3><div class="metric-stats">${rows}</div></div>`;
  }

  // ── SVG Linjediagram med tids-sektioner + cursor-tooltip ─────────────────
  function renderLineChart(points, opts = {}) {
    if (!points || points.length < 2) {
      return `<span class="hint" style="font-size:.8em;">${t("metrics.history_no_data")}</span>`;
    }
    const W = opts.width || 340;
    const H = opts.height || 96;
    const pad = { top: 8, right: 10, bottom: 24, left: 42 };
    const iW = W - pad.left - pad.right;
    const iH = H - pad.top - pad.bottom;

    const vals = points.map((p) => p.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const n = points.length - 1;
    const color = opts.color || "#3b82f6";
    const fmtV = opts.fmtV || ((v) => Number(v).toFixed(opts.decimals ?? 1));
    const key = opts.key || "0";

    const xOf = (i) => pad.left + (i / n) * iW;
    const yOf = (v) => pad.top + iH - ((v - minV) / range) * iH;

    // Vandrette gridlinjer (min / midt / max) + y-labels
    let grid = "";
    for (let g = 0; g <= 2; g++) {
      const v = minV + (g / 2) * range;
      const y = yOf(v).toFixed(1);
      grid += `<line x1="${pad.left}" y1="${y}" x2="${pad.left + iW}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>`;
      grid += `<text x="${pad.left - 4}" y="${(+y) + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${fmtV(v)}</text>`;
    }

    // Lodrette tids-sektioner med HH:MM-labels
    const ticks = Math.min(6, n);
    let xgrid = "";
    for (let k = 0; k <= ticks; k++) {
      const i = Math.round((k / ticks) * n);
      const x = xOf(i).toFixed(1);
      xgrid += `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + iH}" stroke="#f4f7fa" stroke-width="1"/>`;
      xgrid += `<text x="${x}" y="${pad.top + iH + 13}" text-anchor="middle" font-size="8.5" fill="#94a3b8">${points[i].ts.slice(11, 16)}</text>`;
    }

    const polyline = points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
    const fillPath = `M${xOf(0).toFixed(1)},${(pad.top + iH).toFixed(1)} `
      + points.map((p, i) => `L${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ")
      + ` L${xOf(n).toFixed(1)},${(pad.top + iH).toFixed(1)} Z`;

    // Metadata til cursor-tooltip (præ-beregnede positioner + formaterede værdier)
    const mpts = points.map((p, i) => ({
      x: +xOf(i).toFixed(1), y: +yOf(p.value).toFixed(1),
      ts: p.ts, label: fmtV(p.value),
    }));
    const mchart = JSON.stringify({ pts: mpts });

    return `<svg viewBox="0 0 ${W} ${H}" data-mchart='${mchart}'
      style="width:100%;max-width:${W}px;height:auto;display:block;cursor:crosshair;overflow:visible;">
      <defs>
        <linearGradient id="grad_${key}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity=".22"/>
          <stop offset="100%" stop-color="${color}" stop-opacity=".02"/>
        </linearGradient>
      </defs>
      ${grid}${xgrid}
      <path d="${fillPath}" fill="url(#grad_${key})" />
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
      <line class="mch-v" x1="0" y1="${pad.top}" x2="0" y2="${pad.top + iH}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" style="display:none;pointer-events:none"/>
      <circle class="mch-dot" cx="0" cy="0" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.5" style="display:none;pointer-events:none"/>
    </svg>`;
  }

  function attachMetricsChartTooltips(root) {
    root.querySelectorAll("svg[data-mchart]").forEach((svg) => {
      let cd;
      try { cd = JSON.parse(svg.getAttribute("data-mchart")); } catch { return; }
      const pts = cd.pts;
      if (!pts || !pts.length) return;
      const vline = svg.querySelector(".mch-v");
      const dot   = svg.querySelector(".mch-dot");
      const vbW   = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || 340;

      svg.addEventListener("mousemove", (e) => {
        const rect = svg.getBoundingClientRect();
        const svgX = ((e.clientX - rect.left) / rect.width) * vbW;
        let best = 0, bestD = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].x - svgX);
          if (d < bestD) { bestD = d; best = i; }
        }
        const p = pts[best];
        if (vline) { vline.setAttribute("x1", p.x); vline.setAttribute("x2", p.x); vline.style.display = ""; }
        if (dot)   { dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.style.display = ""; }
        const tip = metricsTip();
        tip.innerHTML = `<div style="color:#9ca3af;font-size:.72rem;margin-bottom:.15rem;">${esc((p.ts || "").slice(5, 16).replace("T", " "))}</div>`
          + `<div style="font-weight:600;">${esc(p.label)}</div>`;
        tip.style.display = "block";
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let tx = e.clientX + 14, ty = e.clientY - 10;
        if (tx + tw > window.innerWidth - 8)  tx = e.clientX - tw - 14;
        if (ty + th > window.innerHeight - 8) ty = e.clientY - th + 10;
        tip.style.left = tx + "px";
        tip.style.top  = ty + "px";
      });
      svg.addEventListener("mouseleave", () => {
        if (vline) vline.style.display = "none";
        if (dot)   dot.style.display = "none";
        metricsTip().style.display = "none";
      });
    });
  }

  function renderHistoryCard(histData, limit) {
    const series = [
      { key: "cache_entries",   label: t("metrics.hist_cache_entries"),   color: "#3b82f6", fmtV: (v) => Math.round(v).toString() },
      { key: "cache_stale_pct", label: t("metrics.hist_stale_pct"),       color: "#f59e0b", fmtV: (v) => Number(v).toFixed(1) + "%" },
      { key: "ise_requests_total", label: t("metrics.hist_ise_requests"), color: "#10b981", fmtV: (v) => Math.round(v).toString() },
      { key: "circuit_state",   label: t("metrics.hist_circuit_state"),   color: "#ef4444", fmtV: (v) => v === 0 ? "closed" : v === 1 ? "half" : "open" },
      // Adaptiv styring (6.22.0726 + 6.24.0728)
      { key: "adaptive_speed_factor", label: t("metrics.hist_speed_factor"), color: "#8b5cf6", fmtV: (v) => Number(v).toFixed(2) + "×" },
      { key: "effective_ttl_s", label: t("metrics.hist_effective_ttl"),   color: "#0891b2", fmtV: (v) => fmtAge(v) },
      { key: "portal_idle_s",   label: t("metrics.portal_idle"),          color: "#64748b", fmtV: (v) => fmtAge(v) },
      { key: "scan_interval_s", label: t("metrics.scan_interval"),        color: "#16a34a", fmtV: (v) => fmtAge(v) },
    ];
    const charts = series.map(({ key, label, color, fmtV }) => {
      const pts = histData[key] || [];
      return `<div style="margin-bottom:14px;">
        <div style="font-size:.8em;color:#64748b;margin-bottom:4px;">${label}</div>
        ${renderLineChart(pts, { key, color, fmtV, width: 320, height: 80 })}
      </div>`;
    }).join("");
    const ranges = [[120, "2h"], [360, "6h"], [720, "12h"], [1440, "24h"]];
    return `<div class="card metrics-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;">${t("metrics.history_title")}</h3>
        <label style="font-size:.82em;color:#64748b;">${t("metrics.hist_range")}
          <select id="metrics-hist-range" style="font-size:.95em;padding:2px 6px;margin-left:4px;border:1px solid #d1d5db;border-radius:4px;">
            ${ranges.map(([v, l]) => `<option value="${v}"${v === limit ? " selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:24px;margin-top:10px;">${charts}</div>
    </div>`;
  }

  async function load() {
    try {
      const [metricsRes, nodesRes, histRes] = await Promise.allSettled([
        fetch(`${BASE}/metrics`),
        api.getIseNodes().catch(() => null),
        api.getMetricsHistory(HIST_NAMES, histLimit).catch(() => null),
      ]);
      if (metricsRes.status === "rejected" || !metricsRes.value.ok) {
        throw new Error(metricsRes.reason?.message || `HTTP ${metricsRes.value?.status}`);
      }
      const text = await metricsRes.value.text();
      const parsed = parsePrometheus(text);
      const nodes = nodesRes.status === "fulfilled" ? (nodesRes.value?.nodes || null) : null;
      const histData = histRes.status === "fulfilled" ? histRes.value : null;
      body.innerHTML = renderData(parsed)
        + (histData ? renderHistoryCard(histData, histLimit) : "")
        + (nodes ? renderNodesCard(nodes) : "");
      attachMetricsChartTooltips(container);
      const rangeSel = container.querySelector("#metrics-hist-range");
      if (rangeSel) {
        rangeSel.addEventListener("change", () => {
          histLimit = parseInt(rangeSel.value, 10) || 120;
          load();
        });
      }
      const locale = getLocale() === "da" ? "da-DK" : "en-GB";
      tsEl.textContent = t("metrics.last_updated") + new Date().toLocaleTimeString(locale);
    } catch (err) {
      body.innerHTML = `<div class="alert error">${t("metrics.error").replace("{msg}", String(err.message || "").replace(/&/g,"&amp;").replace(/</g,"&lt;"))}</div>`;
    }
  }

  refreshBtn.addEventListener("click", load);

  function startTimer() {
    timer = setInterval(() => {
      if (!container.isConnected) {
        clearInterval(timer);
        return;
      }
      load();
    }, 15000);
  }

  await load();
  startTimer();

  return function cleanup() {
    if (timer) { clearInterval(timer); timer = null; }
  };
}
