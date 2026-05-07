/**
 * Metrics view — viser Prometheus-data fra GET /metrics som et live dashboard.
 * Parser Prometheus text format direkte i browseren uden externe biblioteker.
 */

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

function sumSeries(parsed, name) {
  const series = parsed[name];
  if (!series) return 0;
  return series.reduce((acc, s) => acc + s.value, 0);
}

// ------------------------------------------------------------------ //
// Formatting helpers                                                   //
// ------------------------------------------------------------------ //

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return "–";
  return Number(n).toLocaleString("da-DK", {
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
  if (state === 0) return { text: "CLOSED", cls: "cb-closed" };
  if (state === 1) return { text: "HALF-OPEN", cls: "cb-halfopen" };
  return { text: "OPEN", cls: "cb-open" };
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
  // Circuit breaker
  const cbState = getScalar(parsed, "ise_portal_circuit_breaker_state") ?? 0;
  const { text: cbText, cls: cbCls } = cbLabel(cbState);

  // ISE requests
  const ise2xx = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "2xx");
  const ise4xx = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "4xx");
  const ise5xx = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "5xx");
  const iseErr = getLabeled(parsed, "ise_portal_ise_requests_total", "outcome", "error");
  const iseTotal = ise2xx + ise4xx + ise5xx + iseErr;
  const retries = getScalar(parsed, "ise_portal_ise_retries_total") ?? 0;

  // Duration: sum(bucket) gives nothing useful, use _sum/_count for mean
  const durSum = getScalar(parsed, "ise_portal_ise_request_duration_seconds_sum") ?? 0;
  const durCount = getScalar(parsed, "ise_portal_ise_request_duration_seconds_count") ?? 0;
  const durMean = durCount > 0 ? durSum / durCount : null;

  // Cache
  const cacheEntries = getScalar(parsed, "ise_portal_cache_entries") ?? 0;
  const hits = getScalar(parsed, "ise_portal_cache_hits_total") ?? 0;
  const misses = getScalar(parsed, "ise_portal_cache_misses_total") ?? 0;
  const stale = getScalar(parsed, "ise_portal_cache_stale_serves_total") ?? 0;
  const evictions = getScalar(parsed, "ise_portal_cache_evictions_total") ?? 0;
  const diskStale = getScalar(parsed, "ise_portal_cache_disk_stale_entries") ?? 0;

  // Rate limiter
  const blocked = getScalar(parsed, "ise_portal_rate_limit_blocked_total") ?? 0;

  // Bulk
  const bulkOk = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "succeeded");
  const bulkFail = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "failed");
  const bulkSkip = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "skipped");
  const bulkOver = getLabeled(parsed, "ise_portal_bulk_items_total", "outcome", "overwritten");

  return `
    <div class="metrics-hero">
      <div class="cb-badge ${cbCls}">
        <span class="cb-dot"></span>
        <span>Circuit Breaker: <strong>${cbText}</strong></span>
      </div>
    </div>

    <div class="metrics-grid">
      ${buildStatCard("ISE API", [
        { label: "Total requests", value: fmt(iseTotal) },
        { label: "Succesful (2xx)", value: fmt(ise2xx), sub: pct(ise2xx, iseTotal - ise2xx) + " hit-rate" },
        { label: "4xx fejl", value: fmt(ise4xx) },
        { label: "5xx fejl", value: fmt(ise5xx) },
        { label: "Transport-fejl", value: fmt(iseErr) },
        { label: "Retries", value: fmt(retries) },
        { label: "Gennemsn. svartid", value: durMean !== null ? fmt(durMean * 1000, 1) + " ms" : "–" },
      ])}

      ${buildStatCard("Cache", [
        { label: "Entries i hukommelse", value: fmt(cacheEntries) },
        { label: "Hits", value: fmt(hits), sub: pct(hits, misses) + " hit-rate" },
        { label: "Misses", value: fmt(misses) },
        { label: "Stale-while-revalidate", value: fmt(stale) },
        { label: "Evictions (FIFO)", value: fmt(evictions) },
        { label: "Disk-stale ved opstart", value: fmt(diskStale) },
      ])}

      ${buildStatCard("Rate Limiter", [
        { label: "Blokerede requests (429)", value: fmt(blocked) },
      ])}

      ${buildStatCard("Bulk-operationer", [
        { label: "Oprettet", value: fmt(bulkOk) },
        { label: "Overskrevet", value: fmt(bulkOver) },
        { label: "Sprunget over", value: fmt(bulkSkip) },
        { label: "Fejlet", value: fmt(bulkFail) },
      ])}
    </div>
  `;
}

// ------------------------------------------------------------------ //
// Main export                                                          //
// ------------------------------------------------------------------ //

export async function renderMetrics(container) {
  container.innerHTML = `
    <h2>Metrics</h2>
    <p class="hint">
      Live Prometheus-data fra backend. Tæller akkumuleres fra seneste genstart
      — absolutte totaler, ikke rate per sekund. Auto-opdaterer hvert 15 sek.
    </p>
    <div class="metrics-toolbar">
      <button id="metrics-refresh">Opdater nu</button>
      <span id="metrics-ts" class="hint"></span>
    </div>
    <div id="metrics-body"><div class="alert info">Henter…</div></div>
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
      tsEl.textContent = `Sidst opdateret: ${new Date().toLocaleTimeString("da-DK")}`;
    } catch (err) {
      body.innerHTML = `<div class="alert error">Kunne ikke hente metrics: ${err.message}</div>`;
    }
  }

  refreshBtn.addEventListener("click", load);

  // Auto-refresh — stopper når containeren fjernes fra DOM (hashchange)
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
