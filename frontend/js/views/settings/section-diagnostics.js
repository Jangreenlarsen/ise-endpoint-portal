// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";

const STATUS_ICON = { ok: "✅", warning: "⚠️", error: "❌" };
const STATUS_COLOR = { ok: "#27ae60", warning: "#e67e22", error: "#c0392b" };

function _fmtDetails(details) {
  if (!details || Object.keys(details).length === 0) return "";
  const lines = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        lines.push(`${k}.${k2}: ${v2}`);
      }
    } else if (Array.isArray(v)) {
      if (v.length > 0) lines.push(`${k}: ${v.join(", ")}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join(" · ");
}

function _renderTable(checks) {
  const rows = checks.map(c => {
    const icon = STATUS_ICON[c.status] || "?";
    const color = STATUS_COLOR[c.status] || "#666";
    const detail = _fmtDetails(c.details);
    return `
      <tr>
        <td style="white-space:nowrap;padding:6px 8px;">${icon}</td>
        <td style="padding:6px 8px;font-weight:500;">${c.name}</td>
        <td style="padding:6px 8px;color:${color};">${c.message}</td>
        <td style="padding:6px 8px;font-size:.8em;color:#888;word-break:break-all;">${detail}</td>
      </tr>`;
  }).join("");
  return `
    <table style="width:100%;border-collapse:collapse;font-size:.9em;">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb;">
          <th style="padding:6px 8px;text-align:left;width:2rem;"></th>
          <th style="padding:6px 8px;text-align:left;min-width:10rem;">Tjek</th>
          <th style="padding:6px 8px;text-align:left;">Status</th>
          <th style="padding:6px 8px;text-align:left;">Detaljer</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function _overallBanner(overall, timestamp) {
  const icon  = STATUS_ICON[overall]  || "?";
  const color = STATUS_COLOR[overall] || "#666";
  const label = overall === "ok" ? "Alle tjek OK" : overall === "warning" ? "Advarsler fundet" : "Fejl fundet";
  const time  = new Date(timestamp * 1000).toLocaleTimeString();
  return `<div style="padding:8px 12px;margin-bottom:10px;border-radius:6px;background:${color}18;border-left:4px solid ${color};color:${color};font-weight:600;">
    ${icon} ${label} — tjekket kl. ${time}
  </div>`;
}

export function initDiagnosticsSection(container) {
  const btn    = container.querySelector("#diag-run-btn");
  const result = container.querySelector("#diag-result");
  if (!btn || !result) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Kører…";
    result.innerHTML = `<p style="color:#888;font-style:italic;">Kører diagnostik — tjekker forbindelser…</p>`;
    try {
      const data = await api.diagnostics();
      result.innerHTML = _overallBanner(data.overall, data.timestamp) + _renderTable(data.checks);
    } catch (err) {
      result.innerHTML = `<p style="color:#c0392b;">Fejl: ${err.message}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Kør diagnostik igen";
    }
  });
}
