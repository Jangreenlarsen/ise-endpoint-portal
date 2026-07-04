// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/**
 * Trend-analyse — viser daglig tilgang/fragang af endpoints
 * og udvikling i private MACs (LAA) over tid.
 */

import { api } from "../api.js";
import { t } from "../i18n.js";

// ── SVG chart-renderer ────────────────────────────────────────────────────────

const _W   = 800;
const _PAD = { top: 20, right: 20, bottom: 44, left: 48 };

function niceMax(v) {
  if (v <= 0) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function svgLineChart(labels, series, { height = 260, zeroBaseline = true } = {}) {
  const W = _W;
  const H = height;
  const pad = _PAD;
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const allVals = series.flatMap((s) => s.data);
  const dataMin = Math.min(...allVals, 0);
  const dataMax = Math.max(...allVals, 1);
  let yMin, yMax;
  if (zeroBaseline) {
    // Del-charts (tilgang/fragang): tving 0-baseline så størrelser er sammenlignelige.
    const rawMin = Math.min(0, dataMin);
    yMin = rawMin < 0 ? rawMin - Math.abs(rawMin) * 0.1 : 0;
    yMax = niceMax(dataMax) * 1.1;
  } else {
    // Population-chart: zoom ind på det faktiske interval så variationen er synlig
    // (ellers ligger en flad linje øverst når baseline er stor, fx 5000+).
    const span = (dataMax - dataMin) || 1;
    yMin = Math.max(0, dataMin - span * 0.1);
    yMax = dataMax + span * 0.1;
  }
  const yRange = yMax - yMin || 1;

  const xOf = (i) => pad.left + (i / Math.max(labels.length - 1, 1)) * plotW;
  const yOf = (v) => pad.top + plotH - ((v - yMin) / yRange) * plotH;

  const steps = 5;
  let grid = "";
  for (let i = 0; i <= steps; i++) {
    const v = yMin + (i / steps) * (yMax - yMin);
    const y = yOf(v).toFixed(1);
    const lbl = Number.isInteger(v) ? v : v.toFixed(1);
    grid += `<line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
    grid += `<text x="${pad.left - 6}" y="${Number(y) + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${lbl}</text>`;
  }

  const step = Math.max(1, Math.ceil(labels.length / 12));
  let xLabels = "";
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    xLabels += `<text x="${xOf(i).toFixed(1)}" y="${pad.top + plotH + 14}" text-anchor="middle" font-size="10" fill="#9ca3af">${l.slice(5)}</text>`;
  });

  let zeroLine = "";
  if (yMin < 0) {
    const y0 = yOf(0).toFixed(1);
    zeroLine = `<line x1="${pad.left}" y1="${y0}" x2="${pad.left + plotW}" y2="${y0}" stroke="#6b7280" stroke-width="1" stroke-dasharray="4,3"/>`;
  }

  let seriesSvg = "";
  // Fill-baseline: 0-linjen ved zeroBaseline, ellers bunden af plottet.
  const baseY = (zeroBaseline ? yOf(0) : (pad.top + plotH)).toFixed(1);
  series.forEach((s) => {
    const pts = s.data.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
    if (s.fill) {
      const n = s.data.length - 1;
      seriesSvg += `<polygon points="${xOf(0).toFixed(1)},${baseY} ${pts} ${xOf(n).toFixed(1)},${baseY}" fill="${s.color}" fill-opacity="0.10"/>`;
    }
    seriesSvg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (labels.length <= 14) {
      s.data.forEach((v, i) => {
        seriesSvg += `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="3" fill="${s.color}"/>`;
      });
    }
  });

  const axes = `
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#d1d5db" stroke-width="1"/>
    <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" stroke="#d1d5db" stroke-width="1"/>`;

  const LEGEND_Y = H - 6;
  let legend = "";
  const lW = Math.floor(plotW / series.length);
  series.forEach((s, i) => {
    const x = pad.left + i * lW;
    legend += `<line x1="${x}" y1="${LEGEND_Y - 4}" x2="${x + 18}" y2="${LEGEND_Y - 4}" stroke="${s.color}" stroke-width="2"/>`;
    legend += `<text x="${x + 22}" y="${LEGEND_Y}" font-size="11" fill="#4b5563">${s.name}</text>`;
  });

  const crosshair = `<line class="ch-vline" x1="0" y1="${pad.top}" x2="0" y2="${pad.top + plotH}"
    stroke="#6b7280" stroke-width="1" stroke-dasharray="3,3" style="display:none;pointer-events:none"/>`;
  const hoverDots = series.map((s) =>
    `<circle class="ch-dot" cx="0" cy="0" r="5" fill="${s.color}" stroke="#fff" stroke-width="1.5" style="display:none;pointer-events:none"/>`
  ).join("");

  const meta = JSON.stringify({
    labels,
    series: series.map((s) => ({ name: s.name, color: s.color, data: s.data })),
    padLeft: pad.left, padTop: pad.top, plotW, plotH, W,
    yMin, yMax, yRange,
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
    data-chart='${meta}'
    style="width:100%;max-width:${W}px;height:auto;display:block;cursor:crosshair;overflow:visible;">
    ${grid}${zeroLine}${axes}${xLabels}${seriesSvg}${crosshair}${hoverDots}${legend}
  </svg>`;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

let _tip = null;

function _getTip() {
  if (!_tip) {
    _tip = document.createElement("div");
    _tip.style.cssText = [
      "position:fixed", "pointer-events:none", "z-index:9999",
      "background:#1f2937", "color:#f9fafb", "border-radius:8px",
      "padding:.45rem .75rem", "font-size:.82rem", "line-height:1.65",
      "box-shadow:0 4px 16px rgba(0,0,0,.35)", "display:none",
      "min-width:130px",
    ].join(";");
    document.body.appendChild(_tip);
  }
  return _tip;
}

function attachChartTooltips(container) {
  container.querySelectorAll("svg[data-chart]").forEach((svg) => {
    const cd = JSON.parse(svg.getAttribute("data-chart"));
    const { labels, series, padLeft, padTop, plotW, plotH, W, yMin, yRange } = cd;
    const n = labels.length - 1;

    const vline = svg.querySelector(".ch-vline");
    const dots  = [...svg.querySelectorAll(".ch-dot")];

    const xOf = (i) => padLeft + (i / Math.max(n, 1)) * plotW;
    const yOf = (v) => padTop + plotH - ((v - yMin) / yRange) * plotH;

    svg.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      let idx = Math.round(((svgX - padLeft) / plotW) * n);
      idx = Math.max(0, Math.min(n, idx));

      const cx = xOf(idx).toFixed(1);

      if (vline) {
        vline.setAttribute("x1", cx);
        vline.setAttribute("x2", cx);
        vline.style.display = "";
      }
      dots.forEach((dot, si) => {
        if (!series[si]) return;
        dot.setAttribute("cx", cx);
        dot.setAttribute("cy", yOf(series[si].data[idx]).toFixed(1));
        dot.style.display = "";
      });

      const tip = _getTip();
      let html = `<div style="font-weight:600;margin-bottom:.2rem;color:#9ca3af;font-size:.78rem;">${labels[idx]}</div>`;
      series.forEach((s) => {
        const v = s.data[idx];
        html += `<div style="display:flex;align-items:center;gap:.35rem;">
          <span style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0;display:inline-block;"></span>
          <span style="color:#d1d5db;">${s.name}:</span>
          <span style="font-weight:600;margin-left:auto;padding-left:.4rem;">${v.toLocaleString()}</span>
        </div>`;
      });
      tip.innerHTML = html;
      tip.style.display = "block";

      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let tx = e.clientX + 14;
      let ty = e.clientY - 10;
      if (tx + tw > window.innerWidth - 8)  tx = e.clientX - tw - 14;
      if (ty + th > window.innerHeight - 8) ty = e.clientY - th + 10;
      tip.style.left = tx + "px";
      tip.style.top  = ty + "px";
    });

    svg.addEventListener("mouseleave", () => {
      if (vline) vline.style.display = "none";
      dots.forEach((d) => { d.style.display = "none"; });
      _getTip().style.display = "none";
    });
  });
}

// ── Stat-kort ─────────────────────────────────────────────────────────────────

function statCard(label, value, sub = "", color = "#2563eb") {
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem 1.25rem;min-width:140px;flex:1;max-width:200px;">
    <div style="font-size:.8rem;color:#6b7280;margin-bottom:.3rem;">${label}</div>
    <div style="font-size:1.75rem;font-weight:700;color:${color};line-height:1;">${value}</div>
    ${sub ? `<div style="font-size:.78rem;color:#9ca3af;margin-top:.2rem;">${sub}</div>` : ""}
  </div>`;
}

// ── Chart wrapper ─────────────────────────────────────────────────────────────

function chartCard(title, svgHtml, hint = "") {
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.25rem;">
    <h3 style="margin:0 0 .6rem;font-size:1rem;color:#374151;">${title}</h3>
    ${hint ? `<p style="margin:0 0 .75rem;font-size:.82rem;color:#9ca3af;">${hint}</p>` : ""}
    ${svgHtml}
  </div>`;
}

// ── Hoved render ─────────────────────────────────────────────────────────────

export async function renderTrends(container) {
  container.innerHTML = `
    <div style="max-width:860px;margin:0 auto;padding:1.25rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;">
        <h2 style="margin:0;font-size:1.2rem;">${t("trend.title")}</h2>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <label for="trend-period" style="font-size:.88rem;color:#6b7280;">${t("trend.period_label")}</label>
          <select id="trend-period" style="border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:.9rem;background:#fff;">
            <option value="7d">${t("trend.opt_7d")}</option>
            <option value="30d" selected>${t("trend.opt_30d")}</option>
            <option value="90d">${t("trend.opt_90d")}</option>
            <option value="365d">${t("trend.opt_365d")}</option>
          </select>
          <button id="trend-refresh" style="border:1px solid #d1d5db;border-radius:6px;padding:4px 10px;font-size:.9rem;background:#fff;cursor:pointer;">↺</button>
        </div>
      </div>
      <div id="trend-content"><div style="color:#6b7280;padding:2rem 0;">${t("trend.loading")}</div></div>
    </div>`;

  const periodSel = container.querySelector("#trend-period");
  const refreshBtn = container.querySelector("#trend-refresh");
  const content = container.querySelector("#trend-content");

  let _retryTimer = null;

  async function load() {
    const period = periodSel.value;
    content.innerHTML = `<div style="color:#6b7280;padding:2rem 0;">${t("trend.loading")}</div>`;
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    try {
      const d = await api.getTrends(period);
      render(d);
    } catch (err) {
      content.innerHTML = `<div style="color:#dc2626;padding:1rem;">${t("trend.error").replace("{msg}", String(err.message || err))}</div>`;
    }
  }

  function render(d) {
    const {
      labels, added, removed, net, laa_added, laa_removed, snapshot,
      cumulative = [], laa_cumulative = [], stats: insights = {},
    } = d;

    const totalAdded    = added.reduce((s, v) => s + v, 0);
    const totalRemoved  = removed.reduce((s, v) => s + v, 0);
    const netChange     = totalAdded - totalRemoved;
    const totalLaaAdded = laa_added.reduce((s, v) => s + v, 0);

    if (snapshot.cache_loading) {
      content.innerHTML = `<div class="alert info" style="margin-top:1rem;">
        ${t("trend.cache_loading")}
      </div>`;
      _retryTimer = setTimeout(load, 10000);
      return;
    }

    const peak = insights.peak_added || { day: "", count: 0 };
    const stats = `<div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.25rem;">
      ${statCard(t("trend.stat_total"), snapshot.total.toLocaleString())}
      ${statCard(t("trend.stat_laa"), snapshot.laa.toLocaleString(), snapshot.laa_pct + t("trend.stat_laa_pct"), "#d97706")}
      ${statCard(t("trend.stat_added"), "+" + totalAdded, t("trend.stat_removed_sub").replace("{n}", totalRemoved), "#059669")}
      ${statCard(t("trend.stat_net"), (netChange >= 0 ? "+" : "") + netChange, t("trend.stat_net_sub"), netChange >= 0 ? "#2563eb" : "#dc2626")}
      ${insights.avg_added_per_day != null ? statCard(t("trend.stat_avg_added"), "+" + insights.avg_added_per_day, t("trend.stat_avg_sub").replace("{n}", insights.avg_removed_per_day ?? 0), "#0891b2") : ""}
      ${peak.count ? statCard(t("trend.stat_peak"), "+" + peak.count, t("trend.stat_peak_sub").replace("{day}", (peak.day || "").slice(5)), "#7c3aed") : ""}
      ${statCard(t("trend.stat_laa_added"), "+" + totalLaaAdded, t("trend.stat_laa_sub"), "#d97706")}
    </div>`;

    // Headline: population over tid (kumulativ). Vises kun når backend leverer data.
    const chartPop = cumulative.length ? chartCard(
      t("trend.chart_pop_title"),
      svgLineChart(labels, [
        { name: t("trend.series_population"), color: "#2563eb", data: cumulative, fill: true },
        { name: t("trend.series_laa_pop"),    color: "#d97706", data: laa_cumulative },
      ], { zeroBaseline: false }),
      t("trend.chart_pop_hint")
    ) : "";

    const chart1 = chartCard(
      t("trend.chart1_title"),
      svgLineChart(labels, [
        { name: t("trend.series_added"),   color: "#059669", data: added,   fill: true },
        { name: t("trend.series_removed"), color: "#dc2626", data: removed, fill: true },
        { name: t("trend.series_net"),     color: "#2563eb", data: net },
      ]),
      t("trend.chart1_hint")
    );

    const chart2 = chartCard(
      t("trend.chart2_title"),
      svgLineChart(labels, [
        { name: t("trend.series_laa_added"),   color: "#d97706", data: laa_added,   fill: true },
        { name: t("trend.series_laa_removed"), color: "#f87171", data: laa_removed, fill: true },
      ], { height: 220 }),
      t("trend.chart2_hint")
    );

    content.innerHTML = stats + chartPop + chart1 + chart2;
    attachChartTooltips(content);
  }

  periodSel.addEventListener("change", load);
  refreshBtn.addEventListener("click", load);
  load();
}
