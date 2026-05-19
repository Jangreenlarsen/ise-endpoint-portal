// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/**
 * Metrics view — viser Prometheus-data fra GET /metrics som et live dashboard.
 * Parser Prometheus text format direkte i browseren uden externe biblioteker.
 */

import { t, getLocale } from "../i18n.js";

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
  if (ratio <= 0.9) return ` <span style="background:#27ae60;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;">&#10003; følger med</span>`;
  if (ratio <= 1.1) return ` <span style="background:#f39c12;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;">&#9888; grænse</span>`;
  return ` <span style="background:#c0392b;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;">&#10007; bagud</span>`;
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

      ${dripActive ? buildStatCard("Cache vedligehold", [
        { label: "Drip-interval",       value: fmtAge(dripSleepS),  sub: dripCycleS ? "Fuld rotation: " + fmtAge(dripCycleS) + capacityBadge(dripCycleS, 1800) : "" },
        { label: "Refreshet (drip)",    value: dripRefreshed !== null ? fmt(dripRefreshed) : "–" },
        { label: "Sprunget over",       value: dripSkipped !== null ? fmt(dripSkipped) : "–",  sub: "entries var friske" },
        { label: "Ældste entry",        value: fmtAge(oldestAgeS) },
        { label: "Gennemsnitlig alder", value: fmtAge(avgAgeS) },
        { label: "Stale entries",       value: staleCount !== null ? fmt(staleCount) : "–",    sub: stalePct !== null ? fmt(stalePct, 1) + "%" : "" },
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

  async function load() {
    try {
      const res = await fetch(`${BASE}/metrics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = parsePrometheus(text);
      body.innerHTML = renderData(parsed);
      const locale = getLocale() === "da" ? "da-DK" : "en-GB";
      tsEl.textContent = t("metrics.last_updated") + new Date().toLocaleTimeString(locale);
    } catch (err) {
      body.innerHTML = `<div class="alert error">${t("metrics.error").replace("{msg}", esc(err.message))}</div>`;
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
}
