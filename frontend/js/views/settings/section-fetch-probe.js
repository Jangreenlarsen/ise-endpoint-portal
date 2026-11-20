// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Test: Endpoint-hentning — Open API-liste vs. ERS N+1 (admin).
import { api } from "../../api.js";

const VERDICT = {
  ok:      { icon: "✅", color: "#16a34a", label: "Open API-listen kan bruges" },
  warning: { icon: "⚠️", color: "#d97706", label: "Open API-listen kan ikke erstatte detalje-kaldene" },
  error:   { icon: "❌", color: "#dc2626", label: "Testen kunne ikke gennemføres" },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ms = (v) => (v == null ? "—" : `${Number(v).toLocaleString("da-DK")} ms`);
const sec = (v) => {
  if (v == null) return "—";
  if (v < 120) return `${v.toLocaleString("da-DK")} s`;
  const m = v / 60;
  return m < 120 ? `${m.toFixed(1).replace(".", ",")} min` : `${(m / 60).toFixed(1).replace(".", ",")} timer`;
};
const frac = (a, b) => `${a ?? 0} / ${b ?? 0}`;
const yes = (b) => (b ? `<span style="color:#16a34a;">ja</span>` : `<span style="color:#dc2626;">nej</span>`);

function row(label, value) {
  return `<tr><td style="padding:4px 8px;color:#6b7280;white-space:nowrap;">${label}</td><td style="padding:4px 8px;">${value}</td></tr>`;
}

function render(r) {
  const v = VERDICT[r.verdict] || VERDICT.error;
  const o = r.openapi || {};
  const e = r.ers || {};
  const c = r.comparison || {};
  const est = r.estimate || {};

  let html = `<div style="padding:10px 12px;margin-bottom:12px;border-radius:6px;background:${v.color}18;border-left:4px solid ${v.color};">
    <div style="font-weight:700;color:${v.color};">${v.icon} ${v.label}</div>
    <div style="margin-top:4px;">${esc(r.message)}</div>
  </div>`;

  if (est.total_endpoints) {
    html += `<div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:12px;">
      <div style="flex:1;min-width:220px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Nuværende metode (ERS N+1)</div>
        <div style="font-size:1.4rem;font-weight:700;">${sec(est.ers_n_plus_1_seconds)}</div>
        <div style="font-size:.85rem;color:#6b7280;">${(est.ers_n_plus_1_calls || 0).toLocaleString("da-DK")} kald pr. fuld scanning</div>
      </div>
      <div style="flex:1;min-width:220px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Open API-liste</div>
        <div style="font-size:1.4rem;font-weight:700;">${sec(est.openapi_list_seconds)}</div>
        <div style="font-size:.85rem;color:#6b7280;">${(est.openapi_list_calls || 0).toLocaleString("da-DK")} kald pr. fuld scanning</div>
      </div>
      ${est.speedup ? `<div style="flex:0 0 auto;min-width:140px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Faktor</div>
        <div style="font-size:1.4rem;font-weight:700;">${est.speedup.toLocaleString("da-DK")}×</div>
        <div style="font-size:.85rem;color:#6b7280;">${est.total_endpoints.toLocaleString("da-DK")} endpoints</div>
      </div>` : ""}
    </div>
    <p class="hint" style="margin-top:-4px;">Estimat ud fra målte svartider og ${r.concurrency} samtidige kald (cache_prewarm_concurrency). Kun gyldigt hvis listen indeholder fulde data.</p>`;
  }

  html += `<table style="width:100%;border-collapse:collapse;font-size:.9em;margin-bottom:12px;"><tbody>
    ${row("Open API-liste", o.ok ? `${frac(o.items, o.total)} endpoints på side 1 · ${esc(o.http_version)}` : `<span style="color:#dc2626;">${esc(o.error)}</span>`)}
    ${row("Svartid pr. side", `første ${ms(o.first_page_ms)} · gennemsnit ${ms(o.avg_page_ms)} (${(o.page_ms || []).length} sider)`)}
    ${row("Custom attributes i listen", `${frac(o.items_with_custom_attributes, o.items)} elementer (${o.items_with_nonempty_custom_attributes ?? 0} med værdier)`)}
    ${row("Gruppe / profil i listen", `${frac(o.items_with_group, o.items)} / ${frac(o.items_with_profile, o.items)}`)}
    ${row("ERS-liste", e.ok ? `${ms(e.list_page_ms)} · ${esc(e.http_version)} · felter: ${esc(Object.keys(e.fields || {}).join(", "))}` : `<span style="color:#dc2626;">${esc(e.error)}</span>`)}
    ${row("ERS-detaljekald", `gennemsnit ${ms(e.avg_detail_ms)} (${(e.detail_ms || []).length} målt)`)}
  </tbody></table>`;

  if ((c.rows || []).length) {
    html += `<h4 style="margin:.5rem 0;">Liste vs. detaljekald (${c.sampled} stikprøver)</h4>
    <table style="width:100%;border-collapse:collapse;font-size:.85em;margin-bottom:12px;">
      <thead><tr style="border-bottom:2px solid #e5e7eb;text-align:left;">
        <th style="padding:4px 8px;">MAC</th><th style="padding:4px 8px;">CA i listen</th>
        <th style="padding:4px 8px;">CA ens</th><th style="padding:4px 8px;">Gruppe ens</th>
        <th style="padding:4px 8px;">Profil ens</th><th style="padding:4px 8px;">Afvigende attributter</th>
      </tr></thead><tbody>
      ${c.rows.map((x) => x.error
        ? `<tr><td style="padding:4px 8px;font-family:monospace;">${esc(x.id)}</td><td colspan="5" style="padding:4px 8px;color:#dc2626;">${esc(x.error)}</td></tr>`
        : `<tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:4px 8px;font-family:monospace;">${esc(x.mac || x.id)}</td>
            <td style="padding:4px 8px;">${yes(x.list_has_custom_attributes)}</td>
            <td style="padding:4px 8px;">${yes(x.custom_attributes_match)}</td>
            <td style="padding:4px 8px;">${yes(x.group_match)}</td>
            <td style="padding:4px 8px;">${yes(x.profile_match)}</td>
            <td style="padding:4px 8px;">${esc((x.differing_attributes || []).join(", ")) || "—"}</td>
          </tr>`).join("")}
      </tbody></table>`;
  }

  html += `<details><summary style="cursor:pointer;">Felter i Open API-listen og rå resultat</summary>
    <p style="font-size:.85em;margin:.5rem 0;">${Object.entries(o.fields || {}).map(([k, n]) => `<code>${esc(k)}</code> ${n}`).join(" · ") || "—"}</p>
    <textarea readonly style="width:100%;height:220px;font-family:monospace;font-size:.8em;">${esc(JSON.stringify(r, null, 2))}</textarea>
  </details>`;
  return html;
}

export function initFetchProbeSection(container) {
  const btn = container.querySelector("#fetch-probe-btn");
  const result = container.querySelector("#fetch-probe-result");
  const pagesSel = container.querySelector("#fetch-probe-pages");
  if (!btn || !result) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Tester…";
    result.innerHTML = `<p style="color:#888;font-style:italic;">Henter fra ISE — typisk 5-20 sekunder…</p>`;
    try {
      const pages = Number(pagesSel?.value ?? 3);
      result.innerHTML = render(await api.endpointFetchProbe(pages));
    } catch (err) {
      result.innerHTML = `<p style="color:#c0392b;">Fejl: ${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Kør test igen";
    }
  });
}
