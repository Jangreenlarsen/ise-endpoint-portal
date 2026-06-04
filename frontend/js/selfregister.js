// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Public self-registration page — henter MAC fra URL-param ?mac=...
// Ingen authentication kræves — bruges af wireless controller redirect.

const API_BASE = "/api";

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

function getMacFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mac") || params.get("MAC") || params.get("client_mac") || "";
}

function normalizeMac(raw) {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (hex.length !== 12) return raw;
  return hex.match(/.{2}/g).join(":");
}

function renderDisabled() {
  document.getElementById("page-content").innerHTML = `
    <div class="disabled-page">
      <div style="font-size:2.5rem;">🔒</div>
      <h2 style="margin:0.5rem 0;">Selvregistrering er deaktiveret</h2>
      <p>Kontakt netværksadministratoren for hjælp.</p>
    </div>`;
}

function renderSuccess(mac, redirectUrl) {
  const content = document.getElementById("page-content");
  content.innerHTML = `
    <div class="success-block">
      <div class="success-icon">✅</div>
      <h2>Registrering gennemført!</h2>
      <p><strong>${esc(mac)}</strong> er nu registreret på netværket.</p>
      <p>Afbryd forbindelsen og opret den igen for at få adgang.</p>
      ${redirectUrl ? `<p class="countdown" id="redirect-countdown">Viderestiller om <span id="countdown-sec">10</span> sekunder...</p>` : ""}
    </div>`;

  if (redirectUrl) {
    let sec = 10;
    const tick = setInterval(() => {
      sec--;
      const el = document.getElementById("countdown-sec");
      if (el) el.textContent = sec;
      if (sec <= 0) {
        clearInterval(tick);
        window.location.href = redirectUrl;
      }
    }, 1000);
  }
}

function renderForm(mac, terms, ipskEnabled) {
  const content = document.getElementById("page-content");
  content.innerHTML = `
    <h1>Netværks-registrering</h1>
    <p class="subtitle">Registrér din enhed for at få adgang til netværket.</p>
    <div id="msg"></div>
    <form id="selfreg-form" autocomplete="off">
      <div class="field">
        <label for="mac-input">MAC-adresse</label>
        <input type="text" id="mac-input" value="${esc(mac)}" readonly
               title="MAC-adresse sat af netværkscontrolleren" />
      </div>
      <div class="field">
        <label for="name-input">Dit navn <span style="color:#ef4444;">*</span></label>
        <input type="text" id="name-input" placeholder="Fornavn Efternavn"
               maxlength="128" required autocomplete="name" />
      </div>
      ${ipskEnabled ? `
      <div class="field">
        <label for="psk-input">IPSK-nøgle <span style="color:#ef4444;">*</span></label>
        <input type="text" id="psk-input" placeholder="Din personlige netværksnøgle"
               maxlength="128" autocomplete="off"
               style="font-family:monospace;" />
        <div style="font-size:0.8rem;color:#64748b;margin-top:3px;">
          Udfyldes kun hvis du har fået en nøgle udleveret.
        </div>
      </div>` : ""}
      <label class="agree-row" for="agree-cb">
        <input type="checkbox" id="agree-cb" />
        <span class="agree-text">${esc(terms)}</span>
      </label>
      <button type="submit" id="submit-btn">Registrér enhed</button>
    </form>`;

  const form    = document.getElementById("selfreg-form");
  const msgEl   = document.getElementById("msg");
  const nameEl  = document.getElementById("name-input");
  const agreeEl = document.getElementById("agree-cb");
  const btn     = document.getElementById("submit-btn");

  nameEl.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.innerHTML = "";
    const name = nameEl.value.trim();
    if (!name) {
      msgEl.innerHTML = `<div class="alert alert-error">Indtast dit navn.</div>`;
      nameEl.focus();
      return;
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
      renderSuccess(mac, res.redirect_url || "");
    } catch (err) {
      msgEl.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = "Registrér enhed";
    }
  });
}

async function init() {
  const rawMac = getMacFromUrl();
  const mac = rawMac ? normalizeMac(rawMac) : "";

  try {
    const cfg = await apiGet("/selfregister/config");

    if (!cfg.enabled) {
      renderDisabled();
      return;
    }

    if (!mac) {
      document.getElementById("page-content").innerHTML = `
        <div class="alert alert-error">
          Ingen MAC-adresse fundet i URL'en.<br>
          <small>Forventet: <code>?mac=AA:BB:CC:DD:EE:FF</code></small>
        </div>`;
      return;
    }

    renderForm(mac, cfg.terms || "Jeg accepterer betingelserne.", cfg.ipsk_enabled || false);
  } catch (err) {
    document.getElementById("page-content").innerHTML = `
      <div class="alert alert-error">
        Kunne ikke hente konfiguration: ${esc(err.message)}
      </div>`;
  }
}

init();
