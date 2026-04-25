import { api } from "../api.js";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

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
  container.innerHTML = `
    <div class="register-shell">
      <div class="register-header">
        <h1>Registrér endpoint</h1>
        <div class="register-sub">Scan eller indtast MAC og indsend.</div>
      </div>
      <div id="msg" class="register-msg"></div>
      <form id="register-form" class="register-form" autocomplete="off">
        <label for="r-mac" class="register-label">MAC-adresse</label>
        <input type="text" id="r-mac" inputmode="text" autocapitalize="characters"
               placeholder="AA:BB:CC:DD:EE:FF" required class="register-input mac" />
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
      showError(`Fejl: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Registrér";
    }
  });

  // Cleanup mode-class hvis brugeren navigerer væk
  window.addEventListener("hashchange", function once() {
    container.classList.remove("mobile-register-mode");
    window.removeEventListener("hashchange", once);
  });

  macInput.focus();
}
