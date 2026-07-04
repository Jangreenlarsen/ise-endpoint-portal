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
    "adaptive_speed_factor", "effective_ttl_s", "portal_idle_s",
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

  // ── SVG Linjediagram ─────────────────────────────────────────────────────
  function renderLineChart(points, opts = {}) {
    if (!points || points.length < 2) {
      return `<span class="hint" style="font-size:.8em;">${t("metrics.history_no_data")}</span>`;
    }
    const W = opts.width || 320;
    const H = opts.height || 80;
    const pad = { top: 6, right: 8, bottom: 18, left: 36 };
    const iW = W - pad.left - pad.right;
    const iH = H - pad.top - pad.bottom;

    const vals = points.map((p) => p.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;

    const xs = points.map((_, i) => pad.left + (i / (points.length - 1)) * iW);
    const ys = points.map((p) => pad.top + iH - ((p.value - minV) / range) * iH);

    const polyline = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const fillPath = `M${xs[0].toFixed(1)},${(pad.top + iH).toFixed(1)} `
      + xs.map((x, i) => `L${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ")
      + ` L${xs[xs.length - 1].toFixed(1)},${(pad.top + iH).toFixed(1)} Z`;

    const color = opts.color || "#3b82f6";
    const fmtV = opts.fmtV || ((v) => Number(v).toFixed(opts.decimals ?? 1));

    const firstTs = points[0].ts.slice(11, 16);
    const lastTs  = points[points.length - 1].ts.slice(11, 16);

    return `<svg width="${W}" height="${H}" style="overflow:visible;display:block;">
      <defs>
        <linearGradient id="grad_${opts.key || "0"}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity=".25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity=".02"/>
        </linearGradient>
      </defs>
      <path d="${fillPath}" fill="url(#grad_${opts.key || "0"})" />
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
      <text x="${pad.left}" y="${pad.top + iH + 14}" font-size="10" fill="#94a3b8" text-anchor="start">${firstTs}</text>
      <text x="${pad.left + iW}" y="${pad.top + iH + 14}" font-size="10" fill="#94a3b8" text-anchor="end">${lastTs}</text>
      <text x="${(pad.left - 2)}" y="${(pad.top + 4).toFixed(0)}" font-size="9" fill="#94a3b8" text-anchor="end">${fmtV(maxV)}</text>
      <text x="${(pad.left - 2)}" y="${(pad.top + iH).toFixed(0)}" font-size="9" fill="#94a3b8" text-anchor="end">${fmtV(minV)}</text>
    </svg>`;
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
