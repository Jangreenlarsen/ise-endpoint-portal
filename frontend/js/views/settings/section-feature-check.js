// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";

const ICONS  = { ok: "✅", warning: "⚠️", error: "❌" };
const COLORS = { ok: "#27ae60", warning: "#e67e22", error: "#c0392b" };
const LABELS = { ok: "OK", warning: "Advarsel", error: "Fejl" };

export function initFeatureCheckSection(container) {
  const p1Btn   = container.querySelector("#fc-phase1-btn");
  const p2Btn   = container.querySelector("#fc-phase2-btn");
  const p1Panel = container.querySelector("#fc-phase1-result");
  const p2Panel = container.querySelector("#fc-phase2-result");

  if (!p1Btn || !p2Btn) return;

  p2Btn.disabled = true;

  p1Btn.addEventListener("click", async () => {
    p1Btn.disabled = true;
    p2Btn.disabled = true;
    p1Panel.innerHTML = _spinner("Fase 1: statiske tjek kører…");
    p2Panel.innerHTML = "";
    try {
      const res = await api.featureCheckPhase1();
      p1Panel.innerHTML = _renderResult(res, 1);
      p2Btn.disabled = false;
    } catch (err) {
      p1Panel.innerHTML = `<div class="alert error">Fejl: ${err.message || err}</div>`;
    } finally {
      p1Btn.disabled = false;
    }
  });

  p2Btn.addEventListener("click", async () => {
    p2Btn.disabled = true;
    p2Panel.innerHTML = _spinner("Fase 2: live ISE-test kører (5-15 s)…");
    try {
      const res = await api.featureCheckPhase2();
      p2Panel.innerHTML = _renderResult(res, 2);
    } catch (err) {
      p2Panel.innerHTML = `<div class="alert error">Fejl: ${err.message || err}</div>`;
    } finally {
      p2Btn.disabled = false;
    }
  });
}

function _spinner(msg) {
  return `<p class="hint" style="margin:.5rem 0">⏳ ${msg}</p>`;
}

function _renderResult(res, phase) {
  const overall = res.overall || "error";
  const color   = COLORS[overall];
  const icon    = ICONS[overall];
  const checks  = res.checks || [];
  const ts      = res.timestamp ? new Date(res.timestamp * 1000).toLocaleTimeString() : "";

  const rows = checks.map(c => {
    const ico = ICONS[c.status] || "?";
    const col = COLORS[c.status] || "#666";
    const lbl = LABELS[c.status] || c.status;
    let detailHtml = "";
    if (c.details && Object.keys(c.details).length) {
      const pairs = Object.entries(c.details)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => {
          const val = Array.isArray(v) ? v.join(", ") : String(v);
          return `<span style="color:#888">${_escHtml(k)}:</span> <span>${_escHtml(val.slice(0, 120))}</span>`;
        })
        .join(" &nbsp;·&nbsp; ");
      if (pairs) detailHtml = `<div style="font-size:.78rem;margin-top:.15rem;color:#aaa">${pairs}</div>`;
    }
    return `
      <tr>
        <td style="width:1.8rem;text-align:center;font-size:1rem">${ico}</td>
        <td style="padding:.35rem .5rem">
          <strong style="color:${col}">${_escHtml(c.name)}</strong>
          <div style="font-size:.82rem;color:#ccc;margin-top:.1rem">${_escHtml(c.message)}</div>
          ${detailHtml}
        </td>
        <td style="width:5rem;text-align:right;font-size:.75rem;color:${col};white-space:nowrap">${lbl}</td>
      </tr>`;
  }).join("");

  const errCount  = checks.filter(c => c.status === "error").length;
  const warnCount = checks.filter(c => c.status === "warning").length;
  const okCount   = checks.filter(c => c.status === "ok").length;

  return `
    <div style="border-left:3px solid ${color};padding:.5rem .75rem;margin:.5rem 0;background:#1e2030;border-radius:0 4px 4px 0">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
        <span style="font-size:1.1rem">${icon}</span>
        <strong style="color:${color}">Fase ${phase}: ${overall.toUpperCase()}</strong>
        <span style="font-size:.78rem;color:#888;margin-left:auto">${ts} &nbsp;
          <span style="color:#27ae60">${okCount} OK</span> &nbsp;
          <span style="color:#e67e22">${warnCount} advarsel</span> &nbsp;
          <span style="color:#c0392b">${errCount} fejl</span>
        </span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function _escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
