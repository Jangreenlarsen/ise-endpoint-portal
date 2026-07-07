// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initBackendSection(container) {
  const backendMsg = container.querySelector("#backend-msg");
  const passwordHint = container.querySelector("#password-hint");

  // Set element texts
  const icHintP = container.querySelector("#ic-hint-p");
  if (icHintP) icHintP.innerHTML = t("settings.ic_hint");
  const pwInput = container.querySelector("#password");
  if (pwInput) pwInput.placeholder = t("settings.ic_pw_placeholder");
  const apiErsOpt = container.querySelector("#ic-api-ers-opt");
  if (apiErsOpt) apiErsOpt.textContent = t("settings.ic_api_ers");
  const apiOpenApiOpt = container.querySelector("#ic-api-openapi-opt");
  if (apiOpenApiOpt) apiOpenApiOpt.textContent = t("settings.ic_api_openapi");
  const readUrlLbl = container.querySelector("#ic-read-url-lbl");
  if (readUrlLbl) readUrlLbl.textContent = t("settings.ic_read_url");
  const readUrlHint = container.querySelector("#ic-read-url-hint");
  if (readUrlHint) readUrlHint.textContent = t("settings.ic_read_url_hint");
  const verifyTlsLbl = container.querySelector("#ic-verify-tls-lbl");
  if (verifyTlsLbl) verifyTlsLbl.textContent = t("settings.ic_verify_tls");
  const verifyTlsHint = container.querySelector("#ic-verify-tls-hint");
  if (verifyTlsHint) verifyTlsHint.textContent = t("settings.ic_verify_tls_hint");
  const timeoutLbl = container.querySelector("#ic-timeout-lbl");
  if (timeoutLbl) timeoutLbl.textContent = t("settings.ic_timeout");
  const coaPsnLbl = container.querySelector("#ic-coa-psn-lbl");
  if (coaPsnLbl) coaPsnLbl.textContent = t("settings.ic_coa_psn");
  const coaPsnInput = container.querySelector("#coa_psn_name");
  if (coaPsnInput) coaPsnInput.placeholder = t("settings.ic_coa_psn_ph");
  const coaReauth1 = container.querySelector("#ic-coa-reauth-1-opt");
  if (coaReauth1) coaReauth1.textContent = t("settings.ic_coa_reauth_1");
  const coaDcHint = container.querySelector("#ic-coa-dc-hint");
  if (coaDcHint) coaDcHint.innerHTML = t("settings.ic_coa_dc_hint");
  const btnSave = container.querySelector("#ic-btn-save");
  if (btnSave) btnSave.textContent = t("settings.ic_btn_save");
  const btnTest = container.querySelector("#test-conn-btn");
  if (btnTest) { btnTest.textContent = t("settings.ic_btn_test"); btnTest.title = t("settings.ic_btn_test_title"); }

  try {
    const s = await api.getBackendSettings();
    container.querySelector("#base_url").value = s.ise_base_url;
    container.querySelector("#read_base_url").value = s.ise_read_base_url || "";
    container.querySelector("#username").value = s.ise_username;
    container.querySelector("#api_type").value = s.ise_api_type;
    container.querySelector("#verify_tls").checked = s.ise_verify_tls;
    container.querySelector("#timeout").value = s.ise_timeout;
    container.querySelector("#coa_psn_name").value = s.coa_psn_name || "";
    container.querySelector("#coa_reauth_type").value = String(s.coa_reauth_type ?? 1);
    container.querySelector("#coa_disconnect_type").value = String(s.coa_disconnect_type ?? 0);
    passwordHint.textContent = s.ise_password_set
      ? t("settings.ic_pw_keep")
      : t("settings.ic_pw_empty");
  } catch (err) {
    backendMsg.innerHTML = `<div class="alert error">${t("settings.ic_load_err").replace("{msg}", esc(err.message))}</div>`;
  }

  container.querySelector("#test-conn-btn").addEventListener("click", async () => {
    backendMsg.innerHTML = `<div class="alert info">${t("settings.ic_testing")}</div>`;
    const payload = {
      ise_base_url: container.querySelector("#base_url").value.trim(),
      ise_username: container.querySelector("#username").value.trim(),
      ise_password: container.querySelector("#password").value,
      ise_verify_tls: container.querySelector("#verify_tls").checked,
      ise_timeout: parseFloat(container.querySelector("#timeout").value),
      ise_api_type: container.querySelector("#api_type").value,
      coa_psn_name: container.querySelector("#coa_psn_name").value.trim(),
      coa_reauth_type: parseInt(container.querySelector("#coa_reauth_type").value, 10),
      coa_disconnect_type: parseInt(container.querySelector("#coa_disconnect_type").value, 10),
    };
    try {
      const res = await api.testBackendConnection(payload);
      const cls = res.ok ? "success" : "error";
      backendMsg.innerHTML = `<div class="alert ${cls}">${res.message}</div>`;
    } catch (err) {
      backendMsg.innerHTML = `<div class="alert error">${t("settings.ic_test_failed").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#backend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    backendMsg.innerHTML = "";
    const payload = {
      ise_base_url: container.querySelector("#base_url").value.trim(),
      ise_read_base_url: container.querySelector("#read_base_url").value.trim(),
      ise_username: container.querySelector("#username").value.trim(),
      ise_password: container.querySelector("#password").value,
      ise_verify_tls: container.querySelector("#verify_tls").checked,
      ise_timeout: parseFloat(container.querySelector("#timeout").value),
      ise_api_type: container.querySelector("#api_type").value,
      coa_psn_name: container.querySelector("#coa_psn_name").value.trim(),
      coa_reauth_type: parseInt(container.querySelector("#coa_reauth_type").value, 10),
      coa_disconnect_type: parseInt(container.querySelector("#coa_disconnect_type").value, 10),
    };
    try {
      const s = await api.updateBackendSettings(payload);
      backendMsg.innerHTML = `<div class="alert success">${t("settings.ic_saved")}</div>`;
      container.querySelector("#password").value = "";
      passwordHint.textContent = s.ise_password_set
        ? t("settings.ic_pw_keep")
        : t("settings.ic_pw_empty");
    } catch (err) {
      backendMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}
