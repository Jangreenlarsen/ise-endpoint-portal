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
  const pskBtnSave = container.querySelector("#psk-btn-save");
  if (pskBtnSave) pskBtnSave.textContent = t("settings.psk_btn_save");
  const pskTestGen = container.querySelector("#psk-test-gen");
  if (pskTestGen) pskTestGen.textContent = t("settings.psk_btn_test");

  function applyPolicy(p) {
    const pskType = (p.psk_type || "MPSK").toUpperCase();
    const mpskRb = container.querySelector("#psk-type-mpsk");
    const ipskRb = container.querySelector("#psk-type-ipsk");
    if (mpskRb) mpskRb.checked = pskType !== "IPSK";
    if (ipskRb) ipskRb.checked = pskType === "IPSK";
    container.querySelector("#psk-show-key").checked = !!p.show_key_in_table;
    container.querySelector("#psk-min-length").value = p.min_length ?? 8;
    container.querySelector("#psk-req-upper").checked = !!p.require_uppercase;
    container.querySelector("#psk-req-number").checked = !!p.require_numbers;
    container.querySelector("#psk-req-special").checked = !!p.require_special;
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
    };
    try {
      const saved = await api.updatePskPolicy(payload);
      applyPolicy(saved);
      msg.innerHTML = `<div class="alert success">${t("settings.psk_saved")}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.psk_gen_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#psk-test-gen").addEventListener("click", async () => {
    genResult.textContent = t("settings.psk_generating");
    try {
      const { key } = await api.generatePskKey();
      genResult.textContent = t("settings.psk_example").replace("{key}", key);
    } catch (err) {
      genResult.textContent = t("settings.psk_gen_err").replace("{msg}", err.message);
    }
  });
}
