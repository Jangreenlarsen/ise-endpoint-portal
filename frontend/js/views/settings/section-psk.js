// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initPskPolicySection(container) {
  const msg = container.querySelector("#psk-policy-msg");
  const form = container.querySelector("#psk-policy-form");
  const genResult = container.querySelector("#psk-gen-result");
  if (!form) return;

  // Set element texts
  const pskCardH3 = container.querySelector("#psk-card-h3");
  if (pskCardH3) pskCardH3.textContent = t("settings.psk_card");
  const pskModeTypeLbl = container.querySelector("#psk-mode-type-lbl");
  if (pskModeTypeLbl) pskModeTypeLbl.textContent = t("settings.psk_mode_type");
  const pskShowKeyLbl = container.querySelector("#psk-show-key-lbl");
  if (pskShowKeyLbl) pskShowKeyLbl.textContent = t("settings.psk_show_key");
  const pskMinLengthLbl = container.querySelector("#psk-min-length-lbl");
  if (pskMinLengthLbl) pskMinLengthLbl.textContent = t("settings.psk_min_length");
  const pskReqUpperLbl = container.querySelector("#psk-req-upper-lbl");
  if (pskReqUpperLbl) pskReqUpperLbl.textContent = t("settings.psk_req_upper");
  const pskReqNumberLbl = container.querySelector("#psk-req-number-lbl");
  if (pskReqNumberLbl) pskReqNumberLbl.textContent = t("settings.psk_req_number");
  const pskReqSpecialLbl = container.querySelector("#psk-req-special-lbl");
  if (pskReqSpecialLbl) pskReqSpecialLbl.textContent = t("settings.psk_req_special");
  const pskDisconnectLbl = container.querySelector("#psk-disconnect-lbl");
  if (pskDisconnectLbl) pskDisconnectLbl.textContent = t("settings.psk_disconnect");
  const pskBtnSave = container.querySelector("#psk-btn-save");
  if (pskBtnSave) pskBtnSave.textContent = t("settings.psk_btn_save");
  const pskTestGen = container.querySelector("#psk-test-gen");
  if (pskTestGen) pskTestGen.textContent = t("settings.psk_btn_test");

  // P-7: advarsel når MPSK er valgt — Endpoint_PSK-KEY kræver psk=-formatet.
  const mpskWarning = container.querySelector("#psk-mpsk-warning");
  function updateMpskWarning() {
    if (!mpskWarning) return;
    const sel = container.querySelector("input[name='psk-type']:checked");
    const isMpsk = !sel || sel.value === "MPSK";
    mpskWarning.textContent = t("settings.psk_mpsk_warning");
    mpskWarning.hidden = !isMpsk;
  }
  container.querySelectorAll("input[name='psk-type']").forEach((rb) =>
    rb.addEventListener("change", updateMpskWarning));

  let savedType = "MPSK";

  // Moduskift: tilbyd at omskrive eksisterende nøgler til det nye format.
  async function offerMigration(newType) {
    try {
      const preview = await api.migratePskFormat(true);
      if (!preview.candidates) return "";
      if (!confirm(t("settings.psk_migrate_confirm")
        .replace("{mode}", newType).replace("{n}", preview.candidates))) {
        return t("settings.psk_migrate_skipped");
      }
      const res = await api.migratePskFormat(false);
      let out = t("settings.psk_migrate_done").replace("{ok}", res.migrated).replace("{mode}", res.mode);
      if (res.failed && res.failed.length) {
        out += " " + t("settings.psk_migrate_failed")
          .replace("{n}", res.failed.length)
          .replace("{macs}", res.failed.map((f) => f.mac || f.id).join(", "));
      }
      return out;
    } catch (err) {
      return /^403/.test(err.message || "") ? t("settings.psk_migrate_admin") : err.message;
    }
  }

  function applyPolicy(p) {
    const pskType = (p.psk_type || "MPSK").toUpperCase();
    savedType = pskType;
    const mpskRb = container.querySelector("#psk-type-mpsk");
    const ipskRb = container.querySelector("#psk-type-ipsk");
    if (mpskRb) mpskRb.checked = pskType !== "IPSK";
    if (ipskRb) ipskRb.checked = pskType === "IPSK";
    container.querySelector("#psk-show-key").checked = !!p.show_key_in_table;
    container.querySelector("#psk-min-length").value = p.min_length ?? 8;
    container.querySelector("#psk-req-upper").checked = !!p.require_uppercase;
    container.querySelector("#psk-req-number").checked = !!p.require_numbers;
    container.querySelector("#psk-req-special").checked = !!p.require_special;
    container.querySelector("#psk-disconnect").checked = p.disconnect_on_change !== false;
    updateMpskWarning();
  }

  try {
    const policy = await api.getPskPolicy();
    applyPolicy(policy);
  } catch (err) {
    msg.innerHTML = `<div class="alert error">${t("settings.psk_load_err").replace("{msg}", esc(err.message))}</div>`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const pskTypeEl = container.querySelector("input[name='psk-type']:checked");
    const payload = {
      psk_type: pskTypeEl ? pskTypeEl.value : "MPSK",
      show_key_in_table: container.querySelector("#psk-show-key").checked,
      min_length: parseInt(container.querySelector("#psk-min-length").value, 10),
      require_uppercase: container.querySelector("#psk-req-upper").checked,
      require_numbers: container.querySelector("#psk-req-number").checked,
      require_special: container.querySelector("#psk-req-special").checked,
      disconnect_on_change: container.querySelector("#psk-disconnect").checked,
    };
    try {
      const previousType = savedType;
      const saved = await api.updatePskPolicy(payload);
      applyPolicy(saved);
      let extra = "";
      if ((saved.psk_type || "MPSK").toUpperCase() !== previousType) {
        extra = await offerMigration((saved.psk_type || "MPSK").toUpperCase());
      }
      msg.innerHTML = `<div class="alert success">${t("settings.psk_saved")}${extra ? " " + esc(extra) : ""}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.psk_gen_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#psk-test-gen").addEventListener("click", async () => {
    genResult.textContent = t("settings.psk_generating");
    try {
      const pskTypeEl = container.querySelector("input[name='psk-type']:checked");
      const policy = {
        psk_type:          pskTypeEl ? pskTypeEl.value : "MPSK",
        show_key_in_table: container.querySelector("#psk-show-key").checked,
        min_length:        parseInt(container.querySelector("#psk-min-length").value, 10) || 8,
        require_uppercase: container.querySelector("#psk-req-upper").checked,
        require_numbers:   container.querySelector("#psk-req-number").checked,
        require_special:   container.querySelector("#psk-req-special").checked,
      };
      const { key } = await api.generatePskKey(policy);
      genResult.textContent = t("settings.psk_example").replace("{key}", key);
    } catch (err) {
      genResult.textContent = t("settings.psk_gen_err").replace("{msg}", err.message);
    }
  });
}
