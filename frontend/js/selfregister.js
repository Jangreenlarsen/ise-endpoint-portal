// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// CWA selvregistreringsside.
// WLC redirecter klienten hertil — ingen MAC i URL.
// Portal slår MAC op via ISE MnT API (klientens IP → aktiv RADIUS-session).

const API_BASE = "/api";
const SESSION_POLL_INTERVAL = 3000; // ms mellem retry-forsøg

async function apiGet(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── UI-hjælpefunktioner ───────────────────────────────────────────────────────

function setContent(html) {
  document.getElementById("page-content").innerHTML = html;
}

function renderDisabled() {
  setContent(`
    <div style="text-align:center;padding:2rem 0;">
      <div style="font-size:2.5rem;">🔒</div>
      <h2 style="margin:0.5rem 0;">Selvregistrering er deaktiveret</h2>
      <p style="color:#64748b;">Kontakt netværksadministratoren for hjælp.</p>
    </div>`);
}

function renderLookingUp(attempt, maxAttempts) {
  setContent(`
    <h1>Netværks-registrering</h1>
    <div style="text-align:center;padding:1.5rem 0;">
      <div style="font-size:2rem;">🔍</div>
      <p><span class="spinner"></span>Finder din enhed på netværket...</p>
      <p style="font-size:0.8rem;color:#64748b;">Forsøg ${attempt}/${maxAttempts}</p>
    </div>`);
}

function renderSessionNotFound(clientIp, onRetry) {
  setContent(`
    <h1>Netværks-registrering</h1>
    <div class="alert alert-info" style="margin-bottom:1rem;">
      <strong>Enheden er endnu ikke synlig på netværket.</strong><br>
      Dette sker normalt hvis du netop har forbundet til WiFi.<br>
      Vent et øjeblik og prøv igen.
    </div>
    <p style="font-size:0.85rem;color:#64748b;">Din IP: <code>${esc(clientIp)}</code></p>
    <button type="button" id="retry-btn" style="width:100%;padding:0.7rem;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;">
      Prøv igen
    </button>`);
  document.getElementById("retry-btn").addEventListener("click", onRetry);
}

function renderForm(mac, terms, ipskEnabled) {
  setContent(`
    <h1>Netværks-registrering</h1>
    <p style="color:#64748b;font-size:0.9rem;margin-bottom:1.25rem;">
      Registrér din enhed for at få adgang til netværket.
    </p>
    <div id="msg"></div>
    <form id="selfreg-form" autocomplete="off">
      <div class="field">
        <label for="mac-input">MAC-adresse</label>
        <input type="text" id="mac-input" value="${esc(mac)}" readonly
               title="MAC-adresse fundet via RADIUS-session" />
      </div>
      <div class="field">
        <label for="name-input">Dit navn <span style="color:#ef4444;">*</span></label>
        <input type="text" id="name-input" placeholder="Fornavn Efternavn"
               maxlength="128" required autocomplete="name" />
      </div>
      ${ipskEnabled ? `
      <div class="field">
        <label for="psk-input">IPSK-nøgle</label>
        <input type="text" id="psk-input" placeholder="Din personlige netværksnøgle"
               maxlength="128" autocomplete="off" style="font-family:monospace;" />
        <div style="font-size:0.8rem;color:#64748b;margin-top:3px;">
          Udfyldes kun hvis du har fået en nøgle udleveret.
        </div>
      </div>` : ""}
      <label class="agree-row" for="agree-cb">
        <input type="checkbox" id="agree-cb" />
        <span class="agree-text">${esc(terms)}</span>
      </label>
      <button type="submit" id="submit-btn">Registrér enhed</button>
    </form>`);

  const form   = document.getElementById("selfreg-form");
  const msgEl  = document.getElementById("msg");
  const nameEl = document.getElementById("name-input");
  const agreeEl = document.getElementById("agree-cb");
  const btn    = document.getElementById("submit-btn");
  nameEl.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.innerHTML = "";
    const name = nameEl.value.trim();
    if (!name) {
      msgEl.innerHTML = `<div class="alert alert-error">Indtast dit navn.</div>`;
      nameEl.focus(); return;
    }
    if (!agreeEl.checked) {
      msgEl.innerHTML = `<div class="alert alert-error">Du skal acceptere vilkårene.</div>`;
      return;
    }
    const pskEl = document.getElementById("psk-input");
    const pskKey = pskEl ? pskEl.value.trim() : "";
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Registrerer...`;
    try {
      const body = { mac, registrant_name: name, agreed: true };
      if (pskKey) body.psk_key = pskKey;
      const res = await apiPost("/selfregister", body);
      renderSuccess(mac, res.redirect_url || "", res.coa_sent);
    } catch (err) {
      msgEl.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = "Registrér enhed";
    }
  });
}

function renderSuccess(mac, redirectUrl, coaSent) {
  setContent(`
    <div style="text-align:center;">
      <div style="font-size:3rem;margin-bottom:0.5rem;">✅</div>
      <h2 style="color:#166534;margin:0 0 0.5rem;">Registrering gennemført!</h2>
      <p><strong>${esc(mac)}</strong> er nu registreret på netværket.</p>
      ${coaSent
        ? `<p style="color:#1e40af;">Din enhed re-autentificeres automatisk — du får adgang inden for få sekunder.</p>`
        : `<p style="color:#64748b;">Afbryd forbindelsen og opret den igen for at få adgang.</p>`}
      ${redirectUrl ? `<p style="font-size:0.8rem;color:#64748b;" id="redirect-countdown">Viderestiller om <span id="countdown-sec">10</span> sekunder...</p>` : ""}
    </div>`);

  if (redirectUrl) {
    let sec = 10;
    const tick = setInterval(() => {
      sec--;
      const el = document.getElementById("countdown-sec");
      if (el) el.textContent = sec;
      if (sec <= 0) { clearInterval(tick); window.location.href = redirectUrl; }
    }, 1000);
  }
}

// ── MnT session-lookup med polling ───────────────────────────────────────────

async function lookupSession(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    renderLookingUp(attempt, maxAttempts);
    try {
      // Backend laver 3 interne forsøg — vi kalder én gang og venter
      const data = await apiGet("/selfregister/session");
      if (data.found) return data;
      // Ikke fundet endnu — vis status og vent
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, SESSION_POLL_INTERVAL));
      } else {
        return data; // found=false — frontend viser retry-knap
      }
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, SESSION_POLL_INTERVAL));
      } else {
        return { found: false, client_ip: "", message: err.message };
      }
    }
  }
  return { found: false, client_ip: "", message: "Timeout" };
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const cfg = await apiGet("/selfregister/config");
    if (!cfg.enabled) { renderDisabled(); return; }

    const startLookup = async () => {
      const session = await lookupSession(5);
      if (!session.found) {
        renderSessionNotFound(session.client_ip || "?", startLookup);
        return;
      }
      renderForm(session.mac, cfg.terms || "Jeg accepterer betingelserne.", cfg.ipsk_enabled || false);
    };

    await startLookup();
  } catch (err) {
    setContent(`<div class="alert alert-error">Kunne ikke hente konfiguration: ${esc(err.message)}</div>`);
  }
}

init();
