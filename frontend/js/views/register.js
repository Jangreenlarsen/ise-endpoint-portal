import { api } from "../api.js";
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
  container.innerHTML = `
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

        <label for="r-desc" class="register-label">Beskrivelse</label>
        <input type="text" id="r-desc" class="register-input" placeholder="(valgfri)" />

        <button type="submit" id="r-submit" class="register-submit">Registrér</button>
      </form>
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
    PlatformType: "Platform",
  };
  let caData = { attributes: [] };
  try {
    caData = await api.listCustomAttributes();
  } catch (err) {
    showError(`Kunne ikke hente attributter: ${err.message}`);
  }
  const attrMap = {};
  for (const a of caData.attributes || []) attrMap[a.name] = a.values;
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
