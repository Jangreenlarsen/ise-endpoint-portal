import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initLocaleSection(container) {
  const form = container.querySelector("#locale-form");
  if (!form) return;
  const msg = container.querySelector("#locale-msg");
  const sel = container.querySelector("#portal-language");

  // Opdater panel-tekster med aktiv locale
  const cardTitle = container.querySelector("#locale-card-title");
  const cardHint = container.querySelector("#locale-card-hint");
  const localeLabel = container.querySelector("#locale-label");
  const submitBtn = container.querySelector("#locale-submit");
  if (cardTitle) cardTitle.textContent = t("settings.locale_card");
  if (cardHint) cardHint.textContent = t("settings.locale_hint");
  if (localeLabel) localeLabel.textContent = t("settings.locale_label");
  if (submitBtn) submitBtn.textContent = t("settings.locale_submit");

  try {
    const data = await api.getPortalLocale();
    if (sel && data?.default_language) sel.value = data.default_language;
  } catch { /* ignore */ }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    try {
      await api.updatePortalLocale({ default_language: sel.value });
      msg.innerHTML = `<div class="alert success">${t("settings.locale_success")}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

export async function initPortalAuthConfigSection(container) {
  const form = container.querySelector("#auth-cfg-form");
  const msg = container.querySelector("#auth-cfg-msg");
  const authModeSel = container.querySelector("#auth_mode");
  const tacacsFields = container.querySelector("#tacacs-fields");
  const testBtn = container.querySelector("#tacacs-test-btn");
  const testPanel = container.querySelector("#tacacs-test-panel");
  const runTestBtn = container.querySelector("#tacacs-run-test-btn");
  const testResult = container.querySelector("#tacacs-test-result");

  if (!form) return;

  // Set element texts
  const authCardH3 = container.querySelector("#auth-card-h3");
  if (authCardH3) authCardH3.textContent = t("settings.auth_card");
  const authModeLocalOpt = container.querySelector("#auth-mode-local-opt");
  if (authModeLocalOpt) authModeLocalOpt.textContent = t("settings.auth_mode_local");
  const authModeTacacsOpt = container.querySelector("#auth-mode-tacacs-opt");
  if (authModeTacacsOpt) authModeTacacsOpt.textContent = t("settings.auth_mode_tacacs");
  const authTacacsHostLbl = container.querySelector("#auth-tacacs-host-lbl");
  if (authTacacsHostLbl) authTacacsHostLbl.textContent = t("settings.auth_tacacs_host");
  const authTacacsPortLbl = container.querySelector("#auth-tacacs-port-lbl");
  if (authTacacsPortLbl) authTacacsPortLbl.textContent = t("settings.auth_tacacs_port");
  const authTacacsSecretLbl = container.querySelector("#auth-tacacs-secret-lbl");
  if (authTacacsSecretLbl) authTacacsSecretLbl.textContent = t("settings.auth_tacacs_secret");
  const tacacsSecretInput = container.querySelector("#tacacs_secret");
  if (tacacsSecretInput) tacacsSecretInput.placeholder = t("settings.auth_tacacs_secret_ph");
  const authTacacsTimeoutLbl = container.querySelector("#auth-tacacs-timeout-lbl");
  if (authTacacsTimeoutLbl) authTacacsTimeoutLbl.textContent = t("settings.auth_tacacs_timeout");
  const authTacacsFallbackLbl = container.querySelector("#auth-tacacs-fallback-lbl");
  if (authTacacsFallbackLbl) authTacacsFallbackLbl.textContent = t("settings.auth_tacacs_fallback");
  const authAttrMappingLbl = container.querySelector("#auth-attr-mapping-lbl");
  if (authAttrMappingLbl) authAttrMappingLbl.textContent = t("settings.auth_attr_mapping");
  const authProfileAttrLbl = container.querySelector("#auth-profile-attr-lbl");
  if (authProfileAttrLbl) authProfileAttrLbl.textContent = t("settings.auth_profile_attr");
  const authBtnSave = container.querySelector("#auth-btn-save");
  if (authBtnSave) authBtnSave.textContent = t("settings.auth_btn_save");
  if (testBtn) testBtn.textContent = t("settings.auth_btn_test");
  const authTestLegendLbl = container.querySelector("#auth-test-legend-lbl");
  if (authTestLegendLbl) authTestLegendLbl.textContent = t("settings.auth_test_legend");
  const authTestUserLbl = container.querySelector("#auth-test-user-lbl");
  if (authTestUserLbl) authTestUserLbl.textContent = t("settings.auth_test_user");
  const authTestPwLbl = container.querySelector("#auth-test-pw-lbl");
  if (authTestPwLbl) authTestPwLbl.textContent = t("settings.auth_test_pw");
  if (runTestBtn) runTestBtn.textContent = t("settings.auth_test_btn");
  const authOpCardH3 = container.querySelector("#auth-op-card-h3");
  if (authOpCardH3) authOpCardH3.textContent = t("settings.auth_op_card");

  function showMsg(html) { if (msg) msg.innerHTML = html; }
  function clearMsg() { if (msg) msg.innerHTML = ""; }

  function toggleTacacsFields() {
    if (!tacacsFields || !authModeSel) return;
    tacacsFields.style.display = authModeSel.value === "tacacs" ? "" : "none";
  }

  authModeSel?.addEventListener("change", toggleTacacsFields);

  async function loadAuthConfig() {
    try {
      const s = await api.getPortalAuthConfig();
      authModeSel.value = s.auth_mode || "local";
      container.querySelector("#tacacs_host").value = s.tacacs_server_host || "";
      container.querySelector("#tacacs_port").value = s.tacacs_server_port || 49;
      container.querySelector("#tacacs_secret").value = "";
      container.querySelector("#tacacs_timeout").value = s.tacacs_timeout_seconds || 5;
      container.querySelector("#tacacs_fallback").checked = !!s.tacacs_fallback_to_local;
      container.querySelector("#tacacs_profile_attr").value = s.tacacs_operator_profile_attribute || "portal-operator-profile";
      const hint = container.querySelector("#tacacs-secret-hint");
      if (hint) hint.textContent = s.tacacs_secret_set ? t("settings.auth_secret_set") : "";
      toggleTacacsFields();
    } catch (err) {
      showMsg(`<div class="alert error">${t("settings.auth_load_err").replace("{msg}", esc(err.message))}</div>`);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    const payload = {
      auth_mode: authModeSel.value,
      tacacs_server_host: container.querySelector("#tacacs_host").value,
      tacacs_server_port: parseInt(container.querySelector("#tacacs_port").value, 10) || 49,
      tacacs_secret: container.querySelector("#tacacs_secret").value,
      tacacs_timeout_seconds: parseInt(container.querySelector("#tacacs_timeout").value, 10) || 5,
      tacacs_fallback_to_local: container.querySelector("#tacacs_fallback").checked,
      tacacs_operator_profile_attribute: container.querySelector("#tacacs_profile_attr").value || "portal-operator-profile",
    };
    try {
      await api.updatePortalAuthConfig(payload);
      showMsg(`<div class="alert success">${t("settings.auth_saved")}</div>`);
      await loadAuthConfig();
    } catch (err) {
      showMsg(`<div class="alert error">${t("settings.auth_err").replace("{msg}", esc(err.message))}</div>`);
    }
  });

  testBtn?.addEventListener("click", () => {
    if (testPanel) testPanel.style.display = testPanel.style.display === "none" ? "" : "none";
  });

  runTestBtn?.addEventListener("click", async () => {
    if (!testResult) return;
    testResult.innerHTML = `<div class="alert info">${t("settings.auth_testing")}</div>`;
    const testUser = container.querySelector("#test-tacacs-user")?.value || "";
    const testPw = container.querySelector("#test-tacacs-pw")?.value || "";
    if (!testUser || !testPw) {
      testResult.innerHTML = `<div class="alert error">${t("settings.auth_test_err_creds")}</div>`;
      return;
    }
    try {
      const res = await api.testTacacs({ username: testUser, password: testPw });
      if (res.ok) {
        testResult.innerHTML = `
          <div class="alert success">
            ${t("settings.auth_test_ok")}<br>
            ${res.operator_profile
              ? `${t("settings.auth_test_ok_profile").replace("{name}", `<strong>${esc(res.operator_profile)}</strong>`)}<br><span class="hint">${t("settings.auth_test_ok_hint")}</span>`
              : `<span class="hint">${t("settings.auth_test_no_profile")}</span>`}
          </div>`;
      } else {
        testResult.innerHTML = `<div class="alert error">${esc(res.message)}</div>`;
      }
    } catch (err) {
      testResult.innerHTML = `<div class="alert error">${t("settings.auth_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  await loadAuthConfig();
}
