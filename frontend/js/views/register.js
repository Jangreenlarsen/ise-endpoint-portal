// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { auth } from "../auth.js";
import { t } from "../i18n.js";
import { offlineQueue } from "../offline_queue.js";
import { esc, groupHierarchyOptionsHtml } from "./browse-utils.js";

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
  const user = auth.getUser();
  const isRegistrant = user?.role === "registrant_templet";
  const userLabel = user ? `${user.username} (${user.role})` : "";
  const subText = isRegistrant ? t("reg.sub_template") : t("reg.sub_normal");
  container.innerHTML = `
    <div class="register-topbar">
      <span class="register-brand">ISE Register</span>
      <span class="register-user">${userLabel}</span>
      <button type="button" id="r-logout" class="register-tiny-btn">${t("reg.logout")}</button>
    </div>
    <div class="register-shell">
      <div class="register-header">
        <h1>${t("reg.title")}</h1>
        <div class="register-sub">${subText}</div>
      </div>
      <div id="queue-banner" class="register-queue-banner" hidden></div>
      <div id="msg" class="register-msg"></div>
      <form id="register-form" class="register-form" autocomplete="off">
        <div id="r-template-row" class="register-template-row"${isRegistrant ? "" : " hidden"}>
          <label for="r-template" class="register-label">${t("reg.label_template")}</label>
          <select id="r-template" class="register-input">
            <option value="">${t("reg.template_none")}</option>
          </select>
        </div>
        <div id="r-save-tpl-row" class="register-template-row" hidden>
          <button type="button" id="r-save-as-tpl" class="register-tiny-btn">${t("detail.btn_save_as_tpl")}</button>
        </div>

        <label for="r-mac" class="register-label">${t("reg.label_mac")}</label>
        <div class="register-mac-row">
          <input type="text" id="r-mac" inputmode="text" autocapitalize="characters"
                 placeholder="AA:BB:CC:DD:EE:FF" required class="register-input mac" />
          ${scanSupported
            ? `<button type="button" id="r-scan-btn" class="register-scan-btn" title="Scan barcode/QR">📷</button>`
            : ""}
        </div>
        <div id="r-vendor" class="register-vendor" hidden></div>

        <div id="r-advanced-section"${isRegistrant ? ' hidden' : ''}>
          <label for="r-group" class="register-label">${t("reg.label_group")}</label>
          <select id="r-group" class="register-input">
            <option value="">${t("reg.group_none")}</option>
          </select>

          <div id="r-attrs"></div>

          <div id="r-roles-section" class="register-roles-section" hidden>
            <label class="register-label">${t("reg.label_roles")}</label>
            <div class="register-sub register-roles-hint">${t("reg.roles_hint")}</div>
            <div id="r-roles-chips" class="role-chips register-roles-chips"></div>
          </div>

          <div id="r-psk-section" hidden>
            <label class="register-label">${t("reg.psk_mode_label")}</label>
            <label class="register-psk-mode-cb">
              <input type="checkbox" id="r-psk-mode" /> ${t("reg.psk_mode_cb")}
            </label>
            <label class="register-label">${t("reg.psk_key_label")}</label>
            <div class="psk-key-wrap register-psk-key-wrap">
              <input type="password" id="r-psk-key" class="register-input" autocomplete="off" placeholder="${t("reg.optional")}" />
              <button type="button" id="r-psk-show" class="register-tiny-btn">${t("reg.btn_show")}</button>
              <button type="button" id="r-psk-gen" class="register-tiny-btn">${t("reg.btn_generate")}</button>
            </div>
          </div>
        </div>

        <label for="r-desc" class="register-label">${t("reg.label_desc")}</label>
        <input type="text" id="r-desc" class="register-input" placeholder="${t("reg.optional")}" />

        <button type="submit" id="r-submit" class="register-submit">${t("reg.btn_submit")}</button>
      </form>
      <div class="register-mine-section">
        <button type="button" id="r-mine-toggle" class="register-mine-btn">
          <span class="register-mine-icon">📋</span>
          <span id="r-mine-label">${t("reg.mine_label")}</span>
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
    groupSel.innerHTML = groupHierarchyOptionsHtml(groups, "", t("reg.group_none"));
  } catch (err) {
    showError(t("reg.err_groups").replace("{msg}", err.message));
  }

  const attrLabels = {
    Type:        t("reg.attr_type"),
    Owner:       t("reg.attr_owner"),
    Lokation:    t("reg.attr_lokation"),
    AuthzVlan:   t("reg.attr_authzvlan"),
    AuthzACL:    t("reg.attr_authzacl"),
    PlatformType:t("reg.attr_platform"),
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
    const allRoles = (rolesResp && Array.isArray(rolesResp.roles)) ? rolesResp.roles : [];
    if (!me || me.role === "admin") {
      roleCatalog = allRoles;
    } else {
      const assigned = new Set((me.assigned_endpoint_roles || []).map((r) => r.toLowerCase()));
      roleCatalog = allRoles.filter((r) => assigned.has(r.name.toLowerCase()));
    }
  } catch (err) {
    showError(t("reg.err_attrs").replace("{msg}", err.message));
  }
  const canPickRoles = !!me && (me.role === "admin" || me.role === "editor" || me.role === "editor-psk");
  const isPskEditor = !!me && (me.role === "admin" || me.role === "editor-psk");
  const attrMap = {};
  for (const a of caData.attributes || []) attrMap[a.name] = a.values;
  attrMap.AuthzACL = (dacls || []).map((d) => d.name).filter(Boolean).sort();
  for (const [name, label] of Object.entries(attrLabels)) {
    const opts = (attrMap[name] || [])
      .map((v) => `<option value="${v}">${v}</option>`).join("");
    attrsDiv.insertAdjacentHTML("beforeend", `
      <label for="r-ca-${name}" class="register-label">${label}</label>
      <select id="r-ca-${name}" class="register-input">
        <option value="">${t("reg.attr_select")}</option>${opts}
      </select>
    `);
  }

  if (canPickRoles && roleCatalog.length) {
    const rolesSection = container.querySelector("#r-roles-section");
    const rolesChips = container.querySelector("#r-roles-chips");
    const ownRole = me ? me.username.toLowerCase() : null;
    rolesChips.innerHTML = roleCatalog.map((r) => {
      const isOwn = ownRole && r.name.toLowerCase() === ownRole;
      return `<label class="role-chip" title="${esc(r.description || r.name)}">
        <input type="checkbox" class="r-role-chip" data-role="${esc(r.name)}"${isOwn ? " checked" : ""} />
        <span>${esc(r.name)}</span>
      </label>`;
    }).join("");
    rolesSection.hidden = false;
  }

  // ── Skabeloner ────────────────────────────────────────────────────
  let templates = [];
  try {
    const tplResp = await api.listTemplates().catch(() => ({ templates: [] }));
    templates = (tplResp && tplResp.templates) ? tplResp.templates : [];
  } catch { /* ignorer — skabeloner er valgfrie */ }

  const templateRow = container.querySelector("#r-template-row");
  const templateSel = container.querySelector("#r-template");

  if (isRegistrant && !templates.length) {
    templateSel.innerHTML = `<option value="">${t("reg.no_templates")}</option>`;
    templateSel.disabled = true;
    container.querySelector("#r-submit").disabled = true;
    container.querySelector("#msg").innerHTML =
      `<div class="alert error">${t("reg.no_templates_msg")}</div>`;
  } else if (templates.length) {
    const noneLabel = isRegistrant ? t("reg.template_select") : t("reg.template_none");
    templateSel.innerHTML =
      `<option value="">${noneLabel}</option>` +
      templates.map((tpl) =>
        `<option value="${esc(tpl.id)}">${esc(tpl.name)}${tpl.description ? ` — ${esc(tpl.description)}` : ""}</option>`
      ).join("");
    templateRow.hidden = false;
  }

  function applyTemplate(tplId) {
    const tpl = templates.find((tpl) => tpl.id === tplId);
    if (!tpl) return;
    const fields = tpl.fields || {};
    if (groupSel && fields.group_id) groupSel.value = fields.group_id;
    const descInput = container.querySelector("#r-desc");
    descInput.value = `Templet ${tpl.name}`;
    const ca = fields.custom_attributes || {};
    for (const name of Object.keys(attrLabels)) {
      if (ca[name]) {
        const sel = container.querySelector(`#r-ca-${name}`);
        if (sel) sel.value = ca[name];
      }
    }
    if (isPskEditor && ca.PSK_Mode !== undefined) {
      const pskModeEl = container.querySelector("#r-psk-mode");
      if (pskModeEl) {
        pskModeEl.checked = ca.PSK_Mode === "true";
        if (pskModeEl.checked) {
          const pskVal = prompt(t("detail.tpl_psk_prompt"), "");
          if (pskVal !== null) {
            const pskKeyEl = container.querySelector("#r-psk-key");
            if (pskKeyEl) pskKeyEl.value = pskVal;
          }
        }
      }
    }
  }

  templateSel.addEventListener("change", () => applyTemplate(templateSel.value));

  // "Gem som skabelon" — tilgængelig for editor og derover
  if (canPickRoles || isPskEditor) {
    container.querySelector("#r-save-tpl-row").hidden = false;
    container.querySelector("#r-save-as-tpl").addEventListener("click", async () => {
      const name = prompt(t("detail.tpl_name_prompt"), "");
      if (!name?.trim()) return;

      const customAttrs = {};
      for (const attrName of Object.keys(attrLabels)) {
        const sel = container.querySelector(`#r-ca-${attrName}`);
        const v = sel ? sel.value : "";
        if (v) customAttrs[attrName] = v;
      }
      if (isPskEditor) {
        const pskMode = container.querySelector("#r-psk-mode")?.checked;
        if (pskMode !== undefined) customAttrs.PSK_Mode = pskMode ? "true" : "false";
      }

      const payload = {
        name: name.trim(),
        fields: {
          group_id: groupSel.value || "",
          description: container.querySelector("#r-desc").value.trim(),
          custom_attributes: customAttrs,
        },
      };

      const btn = container.querySelector("#r-save-as-tpl");
      btn.disabled = true;
      try {
        await api.createTemplate(payload);
        showOk(t("detail.tpl_saved_ok"));
        const tplResp = await api.listTemplates().catch(() => ({ templates: [] }));
        templates = (tplResp && tplResp.templates) ? tplResp.templates : [];
        const noneLabel = isRegistrant ? t("reg.template_select") : t("reg.template_none");
        templateSel.innerHTML = `<option value="">${noneLabel}</option>`
          + templates.map((tpl) => `<option value="${esc(tpl.id)}">${esc(tpl.name)}${tpl.description ? ` — ${esc(tpl.description)}` : ""}</option>`).join("");
        if (templates.length) container.querySelector("#r-template-row").hidden = false;
      } catch (err) {
        showError(t("detail.tpl_save_err").replace("{msg}", esc(err.message)));
      } finally { btn.disabled = false; }
    });
  }

  // PSK-sektion: kun for admin og editor-psk
  if (isPskEditor) {
    container.querySelector("#r-psk-section").hidden = false;

    container.querySelector("#r-psk-show").addEventListener("click", () => {
      const inp = container.querySelector("#r-psk-key");
      const btn = container.querySelector("#r-psk-show");
      if (inp.type === "password") {
        inp.type = "text";
        btn.textContent = t("reg.btn_hide");
      } else {
        inp.type = "password";
        btn.textContent = t("reg.btn_show");
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
        container.querySelector("#r-psk-show").textContent = t("reg.btn_hide");
      } catch (err) {
        showError(t("reg.err_psk").replace("{msg}", err.message));
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
        vendorDiv.innerHTML = `<span class="register-vendor-unknown">${t("reg.vendor_unknown")}</span>`;
        return;
      }
      const platform = VENDOR_TO_PLATFORM[vendor] || "";
      const ptSel = container.querySelector("#r-ca-PlatformType");
      const hasPlatform = platform && ptSel
        && Array.from(ptSel.options).some((o) => o.value === platform);
      vendorDiv.hidden = false;
      vendorDiv.innerHTML = `
        <span class="register-vendor-tag">${vendor}</span>
        ${hasPlatform ? `<button type="button" id="r-apply-pt" class="register-tiny-btn">${t("reg.apply_platform").replace("{p}", platform)}</button>` : ""}
      `;
      const applyBtn = container.querySelector("#r-apply-pt");
      if (applyBtn) {
        applyBtn.addEventListener("click", () => {
          ptSel.value = platform;
          applyBtn.disabled = true;
          applyBtn.textContent = t("reg.platform_set");
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

  // Offline-kø
  const queueBanner = container.querySelector("#queue-banner");
  function refreshQueueBanner() {
    const n = offlineQueue.size();
    if (n === 0) {
      queueBanner.hidden = true;
      queueBanner.innerHTML = "";
    } else {
      queueBanner.hidden = false;
      queueBanner.innerHTML = `
        <span>${t("reg.queue_n").replace("{n}", n)}</span>
        <button type="button" id="q-flush" class="register-tiny-btn">${t("reg.queue_send")}</button>
      `;
      const flushBtn = container.querySelector("#q-flush");
      if (flushBtn) flushBtn.addEventListener("click", async () => {
        flushBtn.disabled = true;
        const res = await offlineQueue.flushAll();
        if (res.sent > 0) showOk(t("reg.queue_sent").replace("{n}", res.sent));
        if (res.failed > 0) showError(t("reg.queue_failed").replace("{n}", res.failed));
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
      showError(t("reg.err_invalid_mac"));
      return;
    }
    if (isRegistrant && !templateSel.value) {
      showError(t("reg.err_no_template"));
      return;
    }
    const ca = {};
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#r-ca-${name}`);
      const v = sel ? sel.value : "";
      if (v) ca[name] = v;
    }
    if (me?.username) {
      ca.RegistretBy = me.username;
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
    submitBtn.textContent = t("reg.btn_submitting");
    try {
      await api.createEndpoint(payload);
      showOk(t("reg.success").replace("{mac}", mac));
      e.target.reset();
      if (templateSel) templateSel.value = "";
      if (isPskEditor) {
        const pskInp = container.querySelector("#r-psk-key");
        pskInp.type = "password";
        container.querySelector("#r-psk-show").textContent = t("reg.btn_show");
      }
      vendorDiv.hidden = true;
      vendorDiv.innerHTML = "";
      macInput.focus();
    } catch (err) {
      const isNetwork = err && typeof err.message === "string"
        && !/^\d{3}:/.test(err.message);
      if (isNetwork) {
        offlineQueue.enqueue(payload);
        showOk(t("reg.offline").replace("{mac}", mac));
        e.target.reset();
        vendorDiv.hidden = true;
        vendorDiv.innerHTML = "";
        refreshQueueBanner();
        macInput.focus();
      } else {
        showError(t("reg.err_generic").replace("{msg}", err.message));
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = t("reg.btn_submit");
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
        showError(t("reg.err_camera").replace("{msg}", err.message));
      }
    });
  }

  // ── Mine endpoints ────────────────────────────────────────────────
  const mineToggle = container.querySelector("#r-mine-toggle");
  const mineList = container.querySelector("#r-mine-list");
  const mineLabel = container.querySelector("#r-mine-label");
  let mineLoaded = false;
  let mineRows = [];

  function renderMineList(rows) {
    if (!rows.length) {
      mineList.innerHTML = `<div class="register-mine-empty">${t("reg.mine_empty")}</div>`;
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
          <div class="register-mine-row"><span class="register-mine-key">${t("reg.mine_key_group")}</span><span>${grp}</span></div>
          ${desc ? `<div class="register-mine-row"><span class="register-mine-key">${t("reg.mine_key_desc")}</span><span>${desc}</span></div>` : ""}
          ${roles ? `<div class="register-mine-row"><span class="register-mine-key">${t("reg.mine_key_roles")}</span><span class="register-mine-roles">${roles}</span></div>` : ""}
        </div>
      `;
    }).join("");
  }

  mineToggle.addEventListener("click", async () => {
    if (!mineList.hidden) {
      mineList.hidden = true;
      mineLabel.textContent = t("reg.mine_label");
      return;
    }
    if (!mineLoaded) {
      mineList.hidden = false;
      mineList.innerHTML = `<div class="register-mine-empty">${t("alert.loading")}</div>`;
      mineLabel.textContent = t("reg.mine_loading");
      try {
        mineRows = await api.listAllEndpointDetails("", []);
        mineLoaded = true;
      } catch (err) {
        mineList.innerHTML = `<div class="register-mine-empty register-mine-error">${t("reg.err_fetch_mine").replace("{msg}", esc(err.message))}</div>`;
        mineLabel.textContent = t("reg.mine_label");
        return;
      }
    } else {
      mineList.hidden = false;
    }
    renderMineList(mineRows);
    mineLabel.textContent = t("reg.mine_count").replace("{n}", mineRows.length);
  });

  const logoutBtn = container.querySelector("#r-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try { await api.logout(); } catch { /* ignore */ }
      auth.clear();
      location.reload();
    });
  }

  window.addEventListener("hashchange", function once() {
    container.classList.remove("mobile-register-mode");
    window.removeEventListener("hashchange", once);
  });

  macInput.focus();
}

async function openScanner(onMatch) {
  if (!hasBarcodeDetector()) throw new Error(t("reg.scan_no_detector"));
  const supported = await window.BarcodeDetector.getSupportedFormats?.() || [];
  const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
  if (!formats.length) throw new Error(t("reg.scan_no_formats"));
  const detector = new window.BarcodeDetector({ formats });

  const overlay = document.createElement("div");
  overlay.className = "scan-overlay";
  overlay.innerHTML = `
    <video class="scan-video" autoplay muted playsinline></video>
    <div class="scan-hud">
      <div class="scan-frame"></div>
      <div class="scan-status">${t("reg.scan_status")}</div>
      <button type="button" class="scan-cancel">${t("reg.scan_cancel")}</button>
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
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
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
