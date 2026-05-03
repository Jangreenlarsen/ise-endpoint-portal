import { api } from "../api.js";
import { auth } from "../auth.js";
import { offlineQueue } from "../offline_queue.js";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const MAC_EXTRACT_RE = /([0-9A-Fa-f]{2}[:\-]?){5}[0-9A-Fa-f]{2}/;
const SCAN_FORMATS = ["qr_code", "code_128", "code_39", "data_matrix", "pdf417"];

function hasBarcodeDetector() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function normaliseMac(raw) {
  const hex = (raw || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (hex.length !== 12) return raw;
  return hex.match(/.{2}/g).join(":");
}

function esc(s) {
  return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const VENDOR_TO_PLATFORM = {
  "Cisco Systems Inc": "iosxe",
  "Cisco-Linksys": "iosxe",
  "Cisco Meraki": "meraki",
  "Aruba Networks": "aruba",
  "Espressif Inc (ESP32)": "esp32",
  "Raspberry Pi Foundation": "linux",
  "Raspberry Pi Trading": "linux",
  "Apple Inc": "macos",
  "Samsung Electronics": "android",
  "Microsoft Corp": "windows",
  "HP Inc": "printer",
  "Canon Inc": "printer",
  "AXIS Communications": "ipcam",
};

export async function renderRegister(container) {
  container.classList.add("mobile-register-mode");
  const scanSupported = hasBarcodeDetector();
  const user = auth.getUser();
  const userLabel = user ? `${user.username} (${user.role})` : "";
  container.innerHTML = `
    <div class="register-topbar">
      <span class="register-brand">ISE Register</span>
      <span class="register-user">${userLabel}</span>
      <button type="button" id="r-logout" class="register-tiny-btn">Log ud</button>
    </div>
    <div class="register-shell">
      <div class="register-header">
        <h1>Registrér endpoint</h1>
        <div class="register-sub">Scan eller indtast MAC og indsend.</div>
      </div>
      <div id="queue-banner" class="register-queue-banner" hidden></div>
      <div id="msg" class="register-msg"></div>
      <form id="register-form" class="register-form" autocomplete="off">
        <label for="r-mac" class="register-label">MAC-adresse</label>
        <div class="register-mac-row">
          <input type="text" id="r-mac" inputmode="text" autocapitalize="characters"
                 placeholder="AA:BB:CC:DD:EE:FF" required class="register-input mac" />
          ${scanSupported
            ? `<button type="button" id="r-scan-btn" class="register-scan-btn" title="Scan barcode/QR">📷</button>`
            : ""}
        </div>
        <div id="r-vendor" class="register-vendor" hidden></div>

        <label for="r-group" class="register-label">Identity Group</label>
        <select id="r-group" class="register-input">
          <option value="">— ingen (ISE default) —</option>
        </select>

        <div id="r-attrs"></div>

        <div id="r-roles-section" class="register-roles-section" hidden>
          <label class="register-label">System adm</label>
          <div class="register-sub register-roles-hint">Vælg System adm fra kataloget. Hvis ingen vælges, tagges endpointet med dit brugernavn (din egen System adm-rolle).</div>
          <div id="r-roles-chips" class="role-chips register-roles-chips"></div>
        </div>

        <div id="r-psk-section" hidden>
          <label class="register-label">PSK Mode</label>
          <label class="register-psk-mode-cb">
            <input type="checkbox" id="r-psk-mode" /> MPSK/IPSK aktiveret
          </label>
          <label class="register-label">PSK Key</label>
          <div class="psk-key-wrap register-psk-key-wrap">
            <input type="password" id="r-psk-key" class="register-input" autocomplete="off" placeholder="(valgfri)" />
            <button type="button" id="r-psk-show" class="register-tiny-btn">Vis</button>
            <button type="button" id="r-psk-gen" class="register-tiny-btn">Generer</button>
          </div>
        </div>

        <label for="r-desc" class="register-label">Beskrivelse</label>
        <input type="text" id="r-desc" class="register-input" placeholder="(valgfri)" />

        <button type="submit" id="r-submit" class="register-submit">Registrér</button>
      </form>
      <div class="register-mine-section">
        <button type="button" id="r-mine-toggle" class="register-mine-btn">
          <span class="register-mine-icon">📋</span>
          <span id="r-mine-label">Mine endpoints</span>
        </button>
        <div id="r-mine-list" class="register-mine-list" hidden></div>
      </div>
    </div>
  `;

  const macInput = container.querySelector("#r-mac");
  const groupSel = container.querySelector("#r-group");
  const attrsDiv = container.querySelector("#r-attrs");
  const vendorDiv = container.querySelector("#r-vendor");
  const msg = container.querySelector("#msg");
  const submitBtn = container.querySelector("#r-submit");

  // Load groups + custom-attribute dropdowns
  try {
    const groups = await api.listGroups();
    groupSel.innerHTML =
      `<option value="">— ingen (ISE default) —</option>` +
      groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
  } catch (err) {
    showError(`Kunne ikke hente groups: ${err.message}`);
  }

  const attrLabels = {
    Type: "Type",
    Owner: "Ejer",
    Lokation: "Lokation",
    AuthzVlan: "Authz VLAN",
    AuthzACL: "Authz ACL",
    PlatformType: "Platform",
  };
  let caData = { attributes: [] };
  let dacls = [];
  let roleCatalog = [];
  let me = null;
  try {
    let rolesResp;
    [caData, dacls, rolesResp, me] = await Promise.all([
      api.listCustomAttributes(),
      api.listDacls().catch(() => []),
      api.listEndpointRoles().catch(() => ({ roles: [] })),
      api.authMe().catch(() => null),
    ]);
    roleCatalog = (rolesResp && Array.isArray(rolesResp.roles)) ? rolesResp.roles : [];
  } catch (err) {
    showError(`Kunne ikke hente attributter: ${err.message}`);
  }
  const canPickRoles = !!me && (me.role === "admin" || me.role === "editor");
  const isPskEditor = !!me && (me.role === "admin" || me.role === "editor-psk");
  const attrMap = {};
  for (const a of caData.attributes || []) attrMap[a.name] = a.values;
  // AuthzACL hentes fra ISE DACLs, ikke fra det lokale CA-store.
  attrMap.AuthzACL = (dacls || []).map((d) => d.name).filter(Boolean).sort();
  for (const [name, label] of Object.entries(attrLabels)) {
    const opts = (attrMap[name] || [])
      .map((v) => `<option value="${v}">${v}</option>`).join("");
    attrsDiv.insertAdjacentHTML("beforeend", `
      <label for="r-ca-${name}" class="register-label">${label}</label>
      <select id="r-ca-${name}" class="register-input">
        <option value="">— vælg —</option>${opts}
      </select>
    `);
  }

  // Roller-picker: kun synlig for admin/editor. Viewer/registrar får
  // automatisk deres username som tag (auto-tag i backend Phase 5).
  if (canPickRoles && roleCatalog.length) {
    const rolesSection = container.querySelector("#r-roles-section");
    const rolesChips = container.querySelector("#r-roles-chips");
    rolesChips.innerHTML = roleCatalog.map((r) => `
      <label class="role-chip" title="${esc(r.description || r.name)}">
        <input type="checkbox" class="r-role-chip" data-role="${esc(r.name)}" />
        <span>${esc(r.name)}</span>
      </label>
    `).join("");
    rolesSection.hidden = false;
  }

  // PSK-sektion: kun for admin og editor-psk
  if (isPskEditor) {
    container.querySelector("#r-psk-section").hidden = false;

    container.querySelector("#r-psk-show").addEventListener("click", () => {
      const inp = container.querySelector("#r-psk-key");
      const btn = container.querySelector("#r-psk-show");
      if (inp.type === "password") {
        inp.type = "text";
        btn.textContent = "Skjul";
      } else {
        inp.type = "password";
        btn.textContent = "Vis";
      }
    });

    container.querySelector("#r-psk-gen").addEventListener("click", async () => {
      const btn = container.querySelector("#r-psk-gen");
      btn.disabled = true;
      try {
        const { key } = await api.generatePskKey();
        const inp = container.querySelector("#r-psk-key");
        inp.value = key;
        inp.type = "text";
        container.querySelector("#r-psk-show").textContent = "Skjul";
      } catch (err) {
        showError(`Kunne ikke generere nøgle: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // OUI auto-suggest
  let vendorTimer;
  macInput.addEventListener("input", () => {
    macInput.value = macInput.value.toUpperCase();
    clearTimeout(vendorTimer);
    vendorTimer = setTimeout(lookupVendor, 250);
  });
  macInput.addEventListener("blur", () => {
    macInput.value = normaliseMac(macInput.value);
  });

  async function lookupVendor() {
    const mac = macInput.value.trim();
    if (!mac || mac.replace(/[^0-9A-Fa-f]/g, "").length < 6) {
      vendorDiv.hidden = true;
      vendorDiv.innerHTML = "";
      return;
    }
    try {
      const res = await api.lookupOui(mac);
      const vendor = res && res.vendor ? res.vendor : "";
      if (!vendor) {
        vendorDiv.hidden = false;
        vendorDiv.innerHTML = `<span class="register-vendor-unknown">Ukendt vendor</span>`;
        return;
      }
      const platform = VENDOR_TO_PLATFORM[vendor] || "";
      const ptSel = container.querySelector("#r-ca-PlatformType");
      const hasPlatform = platform && ptSel
        && Array.from(ptSel.options).some((o) => o.value === platform);
      vendorDiv.hidden = false;
      vendorDiv.innerHTML = `
        <span class="register-vendor-tag">${vendor}</span>
        ${hasPlatform ? `<button type="button" id="r-apply-pt" class="register-tiny-btn">Sæt Platform=${platform}</button>` : ""}
      `;
      const applyBtn = container.querySelector("#r-apply-pt");
      if (applyBtn) {
        applyBtn.addEventListener("click", () => {
          ptSel.value = platform;
          applyBtn.disabled = true;
          applyBtn.textContent = "✓ Sat";
        });
      }
    } catch {
      vendorDiv.hidden = true;
    }
  }

  function showError(text) {
    msg.innerHTML = `<div class="alert error">${text}</div>`;
  }
  function showOk(text) {
    msg.innerHTML = `<div class="alert success">${text}</div>`;
  }

  // Offline-kø: vis banner hvis der ligger items, og auto-flush ved 'online'.
  const queueBanner = container.querySelector("#queue-banner");
  function refreshQueueBanner() {
    const n = offlineQueue.size();
    if (n === 0) {
      queueBanner.hidden = true;
      queueBanner.innerHTML = "";
    } else {
      queueBanner.hidden = false;
      queueBanner.innerHTML = `
        <span>${n} registrering(er) venter på at blive sendt…</span>
        <button type="button" id="q-flush" class="register-tiny-btn">Send nu</button>
      `;
      const flushBtn = container.querySelector("#q-flush");
      if (flushBtn) flushBtn.addEventListener("click", async () => {
        flushBtn.disabled = true;
        const res = await offlineQueue.flushAll();
        if (res.sent > 0) showOk(`Sendte ${res.sent} fra kø.`);
        if (res.failed > 0) showError(`${res.failed} fra kø blev afvist af serveren.`);
        refreshQueueBanner();
      });
    }
  }
  refreshQueueBanner();
  window.addEventListener("offlinequeue:flushed", refreshQueueBanner);

  container.querySelector("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const mac = normaliseMac(macInput.value.trim()).toUpperCase();
    if (!MAC_RE.test(mac)) {
      showError("Ugyldig MAC-adresse.");
      return;
    }
    const ca = {};
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#r-ca-${name}`);
      const v = sel ? sel.value : "";
      if (v) ca[name] = v;
    }
    if (canPickRoles) {
      const checked = container.querySelectorAll(".r-role-chip:checked");
      if (checked.length) {
        ca.HypervisionRoles = Array.from(checked).map((c) => c.dataset.role).join(",");
      }
    }
    if (isPskEditor) {
      ca.PSK_Mode = container.querySelector("#r-psk-mode").checked ? "true" : "false";
      const pskKey = container.querySelector("#r-psk-key").value.trim();
      if (pskKey) ca.PSK_Key = pskKey;
    }
    const payload = {
      mac,
      group_id: groupSel.value,
      description: container.querySelector("#r-desc").value.trim(),
    };
    if (Object.keys(ca).length) payload.custom_attributes = ca;

    submitBtn.disabled = true;
    submitBtn.textContent = "Registrerer…";
    try {
      await api.createEndpoint(payload);
      showOk(`✓ ${mac} oprettet`);
      e.target.reset();
      if (isPskEditor) {
        const pskInp = container.querySelector("#r-psk-key");
        pskInp.type = "password";
        container.querySelector("#r-psk-show").textContent = "Vis";
      }
      vendorDiv.hidden = true;
      vendorDiv.innerHTML = "";
      macInput.focus();
    } catch (err) {
      // Netværksfejl (ingen "NNN:" prefix) → læg i offline-kø.
      const isNetwork = err && typeof err.message === "string"
        && !/^\d{3}:/.test(err.message);
      if (isNetwork) {
        offlineQueue.enqueue(payload);
        showOk(`Offline — ${mac} er gemt i kø og sendes når der er forbindelse.`);
        e.target.reset();
        vendorDiv.hidden = true;
        vendorDiv.innerHTML = "";
        refreshQueueBanner();
        macInput.focus();
      } else {
        showError(`Fejl: ${err.message}`);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Registrér";
    }
  });

  // ── Camera scan via BarcodeDetector ──────────────────────────────
  const scanBtn = container.querySelector("#r-scan-btn");
  if (scanBtn) {
    scanBtn.addEventListener("click", async () => {
      try {
        await openScanner((mac) => {
          macInput.value = mac;
          macInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
      } catch (err) {
        showError(`Kamera kunne ikke startes: ${err.message}`);
      }
    });
  }

  // ── Mine endpoints — mobil-venlig oversigt over endpoints brugeren
  // har adgang til. Backend filterer allerede pr. effektive roller, så
  // listen indeholder kun det brugeren må se.
  const mineToggle = container.querySelector("#r-mine-toggle");
  const mineList = container.querySelector("#r-mine-list");
  const mineLabel = container.querySelector("#r-mine-label");
  let mineLoaded = false;
  let mineRows = [];

  function renderMineList(rows) {
    if (!rows.length) {
      mineList.innerHTML = `<div class="register-mine-empty">Ingen endpoints synlige for dig.</div>`;
      return;
    }
    mineList.innerHTML = rows.map((r) => {
      const mac = esc(r.mac || r.name || "");
      const grp = esc(r.group_name || "—");
      const roles = (r.roles || []).map(esc).join(", ");
      const desc = esc(r.description || "");
      return `
        <div class="register-mine-card">
          <div class="register-mine-mac">${mac}</div>
          <div class="register-mine-row"><span class="register-mine-key">Gruppe</span><span>${grp}</span></div>
          ${desc ? `<div class="register-mine-row"><span class="register-mine-key">Beskr.</span><span>${desc}</span></div>` : ""}
          ${roles ? `<div class="register-mine-row"><span class="register-mine-key">System adm</span><span class="register-mine-roles">${roles}</span></div>` : ""}
        </div>
      `;
    }).join("");
  }

  mineToggle.addEventListener("click", async () => {
    if (!mineList.hidden) {
      mineList.hidden = true;
      mineLabel.textContent = "Mine endpoints";
      return;
    }
    if (!mineLoaded) {
      mineList.hidden = false;
      mineList.innerHTML = `<div class="register-mine-empty">Henter…</div>`;
      mineLabel.textContent = "Mine endpoints (henter…)";
      try {
        mineRows = await api.listAllEndpointDetails("", []);
        mineLoaded = true;
      } catch (err) {
        mineList.innerHTML = `<div class="register-mine-empty register-mine-error">Kunne ikke hente: ${esc(err.message)}</div>`;
        mineLabel.textContent = "Mine endpoints";
        return;
      }
    } else {
      mineList.hidden = false;
    }
    renderMineList(mineRows);
    mineLabel.textContent = `Mine endpoints (${mineRows.length})`;
  });

  // Logout-knap i topbar — registrar har ingen sidebar at logge ud fra.
  const logoutBtn = container.querySelector("#r-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try { await api.logout(); } catch { /* ignore */ }
      auth.clear();
      // app.js's setUnauthorizedHandler vil normalt overtage; her kalder vi
      // direkte for at sikre at login-siden vises i samme chromeless mode.
      location.reload();
    });
  }

  // Cleanup mode-class hvis brugeren navigerer væk
  window.addEventListener("hashchange", function once() {
    container.classList.remove("mobile-register-mode");
    window.removeEventListener("hashchange", once);
  });

  macInput.focus();
}

/**
 * Open a fullscreen camera scanner overlay. Uses the browser-native
 * BarcodeDetector to read QR/Code128/Code39/DataMatrix/PDF417 from the
 * live video feed; the first match that contains a MAC-shaped substring
 * is normalised and passed to onMatch().
 */
async function openScanner(onMatch) {
  if (!hasBarcodeDetector()) throw new Error("Browseren understøtter ikke scanning.");
  const supported = await window.BarcodeDetector.getSupportedFormats?.() || [];
  const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
  if (!formats.length) throw new Error("Ingen understøttede barcode-formater.");
  const detector = new window.BarcodeDetector({ formats });

  const overlay = document.createElement("div");
  overlay.className = "scan-overlay";
  overlay.innerHTML = `
    <video class="scan-video" autoplay muted playsinline></video>
    <div class="scan-hud">
      <div class="scan-frame"></div>
      <div class="scan-status">Peg kameraet på en MAC-stregkode eller QR…</div>
      <button type="button" class="scan-cancel">Annuller</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const video = overlay.querySelector(".scan-video");
  const status = overlay.querySelector(".scan-status");

  let stream;
  let stopped = false;

  function cleanup() {
    stopped = true;
    overlay.remove();
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  overlay.querySelector(".scan-cancel").addEventListener("click", cleanup);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  video.srcObject = stream;

  async function tick() {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      for (const c of codes) {
        const m = (c.rawValue || "").match(MAC_EXTRACT_RE);
        if (m) {
          const hex = m[0].replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
          if (hex.length === 12) {
            const mac = hex.match(/.{2}/g).join(":");
            status.textContent = `✓ ${mac}`;
            cleanup();
            onMatch(mac);
            return;
          }
        }
      }
    } catch { /* keep looping */ }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
