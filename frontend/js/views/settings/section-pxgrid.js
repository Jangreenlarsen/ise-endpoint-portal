// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initPxGridSection(container) {
  const msg = container.querySelector("#pxgrid-msg");
  const certStatus = container.querySelector("#pxgrid-cert-status");
  const uploadBlock = container.querySelector("#pxgrid-upload-block");
  const csrBlock = container.querySelector("#pxgrid-csr-block");
  const modeSel = container.querySelector("#pxgrid_cert_mode");
  const pwHint = container.querySelector("#pxgrid-pw-hint");

  // Set element texts
  const pxgridCardH3 = container.querySelector("#pxgrid-card-h3");
  if (pxgridCardH3) pxgridCardH3.textContent = t("settings.pxgrid_card");
  const pxgridEnabledLbl = container.querySelector("#pxgrid-enabled-lbl");
  if (pxgridEnabledLbl) pxgridEnabledLbl.textContent = t("settings.pxgrid_enabled_lbl");
  const pxgridEnabledHint = container.querySelector("#pxgrid-enabled-hint");
  if (pxgridEnabledHint) pxgridEnabledHint.textContent = t("settings.pxgrid_enabled_hint");
  const pxgridNodeNameLbl = container.querySelector("#pxgrid-node-name-lbl");
  if (pxgridNodeNameLbl) pxgridNodeNameLbl.textContent = t("settings.pxgrid_node_name");
  const pxgridNodeHint = container.querySelector("#pxgrid-node-hint");
  if (pxgridNodeHint) pxgridNodeHint.textContent = t("settings.pxgrid_node_hint");
  const pxgridExtraSansLbl = container.querySelector("#pxgrid-extra-sans-lbl");
  if (pxgridExtraSansLbl) pxgridExtraSansLbl.textContent = t("settings.pxgrid_extra_sans");
  const pxgridPsnLbl = container.querySelector("#pxgrid-psn-lbl");
  if (pxgridPsnLbl) pxgridPsnLbl.textContent = t("settings.pxgrid_psn");
  const pxgridPsnHint = container.querySelector("#pxgrid-psn-hint");
  if (pxgridPsnHint) pxgridPsnHint.textContent = t("settings.pxgrid_psn_hint");
  const pxgridCertModeLbl = container.querySelector("#pxgrid-cert-mode-lbl");
  if (pxgridCertModeLbl) pxgridCertModeLbl.textContent = t("settings.pxgrid_cert_mode");
  const pxgridCertUploadOpt = container.querySelector("#pxgrid-cert-upload-opt");
  if (pxgridCertUploadOpt) pxgridCertUploadOpt.textContent = t("settings.pxgrid_cert_upload");
  const pxgridCertCsrOpt = container.querySelector("#pxgrid-cert-csr-opt");
  if (pxgridCertCsrOpt) pxgridCertCsrOpt.textContent = t("settings.pxgrid_cert_csr");
  const pxgridUploadCertLbl = container.querySelector("#pxgrid-upload-cert-lbl");
  if (pxgridUploadCertLbl) pxgridUploadCertLbl.textContent = t("settings.pxgrid_upload_cert");
  const pxgridUploadKeyLbl = container.querySelector("#pxgrid-upload-key-lbl");
  if (pxgridUploadKeyLbl) pxgridUploadKeyLbl.textContent = t("settings.pxgrid_upload_key");
  const pxgridUploadCaLbl = container.querySelector("#pxgrid-upload-ca-lbl");
  if (pxgridUploadCaLbl) pxgridUploadCaLbl.textContent = t("settings.pxgrid_upload_ca");
  const pxgridPfxLabelEl = container.querySelector("#pxgrid-pfx-label-el");
  if (pxgridPfxLabelEl) pxgridPfxLabelEl.textContent = t("settings.pxgrid_pfx_label");
  const pxgridPfxPwLbl = container.querySelector("#pxgrid-pfx-pw-lbl");
  if (pxgridPfxPwLbl) pxgridPfxPwLbl.textContent = t("settings.pxgrid_pfx_pw");
  const pxgridPfxPw = container.querySelector("#pxgrid-pfx-pw");
  if (pxgridPfxPw) pxgridPfxPw.placeholder = t("settings.pxgrid_pfx_ph");
  const pxgridPfxImportBtn = container.querySelector("#pxgrid-pfx-import-btn");
  if (pxgridPfxImportBtn) pxgridPfxImportBtn.textContent = t("settings.pxgrid_pfx_btn");
  const pxgridCsrStep1Lbl = container.querySelector("#pxgrid-csr-step1-lbl");
  if (pxgridCsrStep1Lbl) pxgridCsrStep1Lbl.textContent = t("settings.pxgrid_csr_step1");
  const pxgridCsrStep1Hint = container.querySelector("#pxgrid-csr-step1-hint");
  if (pxgridCsrStep1Hint) pxgridCsrStep1Hint.textContent = t("settings.pxgrid_csr_step1_hint");
  const pxgridCsrBtn = container.querySelector("#pxgrid-csr-btn");
  if (pxgridCsrBtn) pxgridCsrBtn.textContent = t("settings.pxgrid_csr_btn");
  const pxgridCsrDlBtn = container.querySelector("#pxgrid-csr-dl-btn");
  if (pxgridCsrDlBtn) pxgridCsrDlBtn.textContent = t("settings.pxgrid_csr_dl_btn");
  const pxgridCsrStep2Lbl = container.querySelector("#pxgrid-csr-step2-lbl");
  if (pxgridCsrStep2Lbl) pxgridCsrStep2Lbl.textContent = t("settings.pxgrid_csr_step2");
  const pxgridCsrStep3Lbl = container.querySelector("#pxgrid-csr-step3-lbl");
  if (pxgridCsrStep3Lbl) pxgridCsrStep3Lbl.textContent = t("settings.pxgrid_csr_step3");
  const pxgridCsrStep3Hint = container.querySelector("#pxgrid-csr-step3-hint");
  if (pxgridCsrStep3Hint) pxgridCsrStep3Hint.textContent = t("settings.pxgrid_csr_step3_hint");
  const pxgridCsrStep4Lbl = container.querySelector("#pxgrid-csr-step4-lbl");
  if (pxgridCsrStep4Lbl) pxgridCsrStep4Lbl.textContent = t("settings.pxgrid_csr_step4");
  const pxgridCsrStep4Hint = container.querySelector("#pxgrid-csr-step4-hint");
  if (pxgridCsrStep4Hint) pxgridCsrStep4Hint.textContent = t("settings.pxgrid_csr_step4_hint");
  const pxgridCsrStep5Lbl = container.querySelector("#pxgrid-csr-step5-lbl");
  if (pxgridCsrStep5Lbl) pxgridCsrStep5Lbl.textContent = t("settings.pxgrid_csr_step5");
  const pxgridCsrStep5Hint = container.querySelector("#pxgrid-csr-step5-hint");
  if (pxgridCsrStep5Hint) pxgridCsrStep5Hint.textContent = t("settings.pxgrid_csr_step5_hint");
  const pxgridAccountBtn = container.querySelector("#pxgrid-account-btn");
  if (pxgridAccountBtn) pxgridAccountBtn.textContent = t("settings.pxgrid_account_btn");
  const pxgridCertPathLbl = container.querySelector("#pxgrid-cert-path-lbl");
  if (pxgridCertPathLbl) pxgridCertPathLbl.textContent = t("settings.pxgrid_cert_path");
  const pxgridKeyPathLbl = container.querySelector("#pxgrid-key-path-lbl");
  if (pxgridKeyPathLbl) pxgridKeyPathLbl.textContent = t("settings.pxgrid_key_path");
  const pxgridCaPathLbl = container.querySelector("#pxgrid-ca-path-lbl");
  if (pxgridCaPathLbl) pxgridCaPathLbl.textContent = t("settings.pxgrid_ca_path");
  const pxgridPhase2bLbl = container.querySelector("#pxgrid-phase2b-lbl");
  if (pxgridPhase2bLbl) pxgridPhase2bLbl.textContent = t("settings.pxgrid_phase2b");
  const pxgridWorkerLbl = container.querySelector("#pxgrid-worker-lbl");
  if (pxgridWorkerLbl) pxgridWorkerLbl.textContent = t("settings.pxgrid_worker_lbl");
  const pxgridWorkerHint = container.querySelector("#pxgrid-worker-hint");
  if (pxgridWorkerHint) pxgridWorkerHint.textContent = t("settings.pxgrid_worker_hint");
  const pxgridSessionTopicLbl = container.querySelector("#pxgrid-session-topic-lbl");
  if (pxgridSessionTopicLbl) pxgridSessionTopicLbl.textContent = t("settings.pxgrid_session_topic");
  const pxgridEpTopicLbl = container.querySelector("#pxgrid-ep-topic-lbl");
  if (pxgridEpTopicLbl) pxgridEpTopicLbl.textContent = t("settings.pxgrid_ep_topic_lbl");
  const pxgridEpServiceLbl = container.querySelector("#pxgrid-ep-service-lbl");
  if (pxgridEpServiceLbl) pxgridEpServiceLbl.textContent = t("settings.pxgrid_ep_service");
  const pxgridEpTopicFallbackLbl = container.querySelector("#pxgrid-ep-topic-fallback-lbl");
  if (pxgridEpTopicFallbackLbl) pxgridEpTopicFallbackLbl.textContent = t("settings.pxgrid_ep_topic");
  const pxgridHeartbeatLbl = container.querySelector("#pxgrid-heartbeat-lbl");
  if (pxgridHeartbeatLbl) pxgridHeartbeatLbl.textContent = t("settings.pxgrid_heartbeat");
  const pxgridReconnectMinLbl = container.querySelector("#pxgrid-reconnect-min-lbl");
  if (pxgridReconnectMinLbl) pxgridReconnectMinLbl.textContent = t("settings.pxgrid_reconnect_min");
  const pxgridReconnectMaxLbl = container.querySelector("#pxgrid-reconnect-max-lbl");
  if (pxgridReconnectMaxLbl) pxgridReconnectMaxLbl.textContent = t("settings.pxgrid_reconnect_max");
  const pxgridSessionAgeLbl = container.querySelector("#pxgrid-session-age-lbl");
  if (pxgridSessionAgeLbl) pxgridSessionAgeLbl.textContent = t("settings.pxgrid_session_age");
  const pxgridWorkerRefreshBtn = container.querySelector("#pxgrid-worker-refresh-btn");
  if (pxgridWorkerRefreshBtn) pxgridWorkerRefreshBtn.textContent = t("settings.pxgrid_btn_refresh");
  const pxgridWorkerRestartBtn = container.querySelector("#pxgrid-worker-restart-btn");
  if (pxgridWorkerRestartBtn) pxgridWorkerRestartBtn.textContent = t("settings.pxgrid_btn_restart");
  const pxgridBtnSave = container.querySelector("#pxgrid-btn-save");
  if (pxgridBtnSave) pxgridBtnSave.textContent = t("settings.pxgrid_btn_save");
  const pxgridTestBtn = container.querySelector("#pxgrid-test-btn");
  if (pxgridTestBtn) pxgridTestBtn.textContent = t("settings.pxgrid_btn_test");
  const pxgridStompBtn = container.querySelector("#pxgrid-stomp-btn");
  if (pxgridStompBtn) pxgridStompBtn.textContent = t("settings.pxgrid_btn_stomp");
  const pxgridResetBtn = container.querySelector("#pxgrid-reset-btn");
  if (pxgridResetBtn) pxgridResetBtn.textContent = t("settings.pxgrid_btn_reset");

  function applyMode(mode) {
    // I CSR-mode bor *alle* cert-uploads inde i csrBlock (trin 3 + 3b), og
    // upload-blokkens "Privat key"-felt ville overskrive den nøgle portalen
    // lige har genereret — så vi skjuler hele upload-blokken. Upload-mode
    // er omvendt simpelt: 3 separate PEMs eller PFX-import.
    if (mode === "csr") {
      uploadBlock.hidden = true;
      csrBlock.hidden = false;
    } else {
      uploadBlock.hidden = false;
      csrBlock.hidden = true;
    }
  }

  async function loadSettings() {
    try {
      const s = await api.getPxGridSettings();
      container.querySelector("#pxgrid_enabled").checked = !!s.pxgrid_enabled;
      container.querySelector("#pxgrid_node_name").value = s.pxgrid_node_name || "";
      container.querySelector("#pxgrid_cert_extra_sans").value = s.pxgrid_cert_extra_sans || "";
      container.querySelector("#pxgrid_psn_fqdn").value = s.pxgrid_psn_fqdn || "";
      modeSel.value = s.pxgrid_cert_mode || "upload";
      container.querySelector("#pxgrid_cert_path").value = s.pxgrid_cert_path || "";
      container.querySelector("#pxgrid_key_path").value = s.pxgrid_key_path || "";
      container.querySelector("#pxgrid_ca_bundle_path").value = s.pxgrid_ca_bundle_path || "";
      container.querySelector("#pxgrid_worker_enabled").checked = s.pxgrid_worker_enabled !== false;
      container.querySelector("#pxgrid_session_topic").value = s.pxgrid_session_topic || "/topic/com.cisco.ise.session";
      container.querySelector("#pxgrid_stomp_heartbeat_ms").value = s.pxgrid_stomp_heartbeat_ms ?? 30000;
      container.querySelector("#pxgrid_stomp_reconnect_min_s").value = s.pxgrid_stomp_reconnect_min_s ?? 1;
      container.querySelector("#pxgrid_stomp_reconnect_max_s").value = s.pxgrid_stomp_reconnect_max_s ?? 300;
      container.querySelector("#pxgrid_session_cache_max_age_s").value = s.pxgrid_session_cache_max_age_s ?? 0;
      container.querySelector("#pxgrid_endpoint_topic_enabled").checked = !!s.pxgrid_endpoint_topic_enabled;
      container.querySelector("#pxgrid_endpoint_topic").value = s.pxgrid_endpoint_topic || "/topic/com.cisco.ise.endpoint";
      container.querySelector("#pxgrid_endpoint_service").value = s.pxgrid_endpoint_service || "com.cisco.ise.endpoint";
      const cls = s.cert_status === "ok" ? "success"
                : s.cert_status === "missing" ? "warning" : "error";
      certStatus.innerHTML = `${t("settings.pxgrid_cert_status")}<span class="alert ${cls}" style="display:inline;padding:2px 8px;">${esc(s.cert_status)}</span>`;
      pwHint.textContent = s.pxgrid_password_set
        ? t("settings.pxgrid_pw_set")
        : t("settings.pxgrid_pw_empty");
      applyMode(s.pxgrid_cert_mode || "upload");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_load_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  modeSel.addEventListener("change", () => applyMode(modeSel.value));

  function buildPayload() {
    return {
      pxgrid_enabled: container.querySelector("#pxgrid_enabled").checked,
      pxgrid_node_name: container.querySelector("#pxgrid_node_name").value.trim(),
      pxgrid_psn_fqdn: container.querySelector("#pxgrid_psn_fqdn").value.trim(),
      pxgrid_cert_mode: modeSel.value,
      pxgrid_cert_path: container.querySelector("#pxgrid_cert_path").value.trim(),
      pxgrid_key_path: container.querySelector("#pxgrid_key_path").value.trim(),
      pxgrid_ca_bundle_path: container.querySelector("#pxgrid_ca_bundle_path").value.trim(),
      pxgrid_password: container.querySelector("#pxgrid_password").value,
      pxgrid_cert_extra_sans: container.querySelector("#pxgrid_cert_extra_sans").value.trim(),
      pxgrid_worker_enabled: container.querySelector("#pxgrid_worker_enabled").checked,
      pxgrid_session_topic: container.querySelector("#pxgrid_session_topic").value.trim() || "/topic/com.cisco.ise.session",
      pxgrid_stomp_heartbeat_ms: parseInt(container.querySelector("#pxgrid_stomp_heartbeat_ms").value, 10) || 0,
      pxgrid_stomp_reconnect_min_s: parseFloat(container.querySelector("#pxgrid_stomp_reconnect_min_s").value) || 1,
      pxgrid_stomp_reconnect_max_s: parseFloat(container.querySelector("#pxgrid_stomp_reconnect_max_s").value) || 300,
      pxgrid_session_cache_max_age_s: parseFloat(container.querySelector("#pxgrid_session_cache_max_age_s").value) || 0,
      pxgrid_endpoint_topic_enabled: container.querySelector("#pxgrid_endpoint_topic_enabled").checked,
      pxgrid_endpoint_topic: container.querySelector("#pxgrid_endpoint_topic").value.trim() || "/topic/com.cisco.ise.endpoint",
      pxgrid_endpoint_service: container.querySelector("#pxgrid_endpoint_service").value.trim() || "com.cisco.ise.endpoint",
    };
  }

  container.querySelector("#pxgrid-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    try {
      await api.updatePxGridSettings(buildPayload());
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_saved")}</div>`;
      container.querySelector("#pxgrid_password").value = "";
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-test-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_testing")}</div>`;
    try {
      const r = await api.testPxGridConnection();
      const cls = r.ok ? "success" : "error";
      const services = r.services_found?.length
        ? `<br><small>Services: ${r.services_found.map(esc).join(", ")}</small>`
        : "";
      msg.innerHTML = `<div class="alert ${cls}">[${esc(r.step)}] ${esc(r.message)}${r.latency_ms ? ` (${r.latency_ms}ms)` : ""}${services}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_test_failed").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#pxgrid-stomp-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_stomp_testing")}</div>`;
    try {
      const r = await api.runPxGridStompProbe(10);
      const cls = r.ok ? "success" : "error";
      const samples = r.sample_payloads?.length
        ? `<br><details style="margin-top:0.4rem;"><summary>${r.sample_payloads.length} sample payload(s)</summary><pre style="white-space:pre-wrap;font-size:0.85em;background:#f3f4f6;padding:0.5rem;margin-top:0.3rem;border-radius:4px;">${r.sample_payloads.map(esc).join("\n---\n")}</pre></details>`
        : "";
      const broker = r.peer_node ? ` via ${esc(r.peer_node)}` : "";
      const headline = r.ok
        ? t("settings.pxgrid_stomp_ok").replace("{step}", esc(r.step)).replace("{n}", r.messages_received).replace("{dur}", r.duration_s).replace("{broker}", broker)
        : t("settings.pxgrid_stomp_fail").replace("{step}", esc(r.step)).replace("{err}", esc(r.error || "ukendt"));
      msg.innerHTML = `<div class="alert ${cls}">${headline}${samples}</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_stomp_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  function fmtAge(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return t("settings.cache_ago").replace("{t}", s + "s");
    if (s < 3600) return t("settings.cache_ago").replace("{t}", Math.floor(s/60) + "m");
    return t("settings.cache_ago").replace("{t}", Math.floor(s/3600) + "t");
  }

  async function refreshWorkerStatus() {
    const el = container.querySelector("#pxgrid-worker-status");
    if (!el) return;
    try {
      const w = await api.getPxGridWorkerStatus();
      const dot = w.connected ? "🟢" : (w.running ? "🟡" : "🔴");
      const lbl = w.connected ? t("settings.pxgrid_worker_conn") : (w.running ? t("settings.pxgrid_worker_run") : t("settings.pxgrid_worker_stop"));
      const lastErr = w.last_error
        ? `<br><span style="color:#b91c1c;">${t("settings.pxgrid_worker_lasterr")} ${esc(w.last_error)}</span>`
        : "";
      const topics = (w.subscribed_topics && w.subscribed_topics.length)
        ? w.subscribed_topics : (w.subscribed_topic ? [w.subscribed_topic] : []);
      const topicsHtml = topics.length
        ? topics.map(t => `<code>${esc(t)}</code>`).join(", ")
        : "—";
      let lookupHtml = "";
      if (w.endpoint_lookup_service) {
        const propsKeys = Object.keys(w.endpoint_lookup_props || {});
        const propsLine = propsKeys.length
          ? `<pre style="margin:0.2rem 0;font-size:0.85em;background:#f3f4f6;padding:0.4rem;border-radius:4px;white-space:pre-wrap;">${esc(JSON.stringify(w.endpoint_lookup_props, null, 2))}</pre>`
          : `<em>${t("settings.pxgrid_no_props")}</em>`;
        lookupHtml = `<br><strong>${t("settings.pxgrid_ep_lookup")}</strong> <code>${esc(w.endpoint_lookup_service)}</code> ${propsLine}`;
      }
      el.innerHTML = `
        <strong>${dot} Worker: ${esc(lbl)}</strong>
        — peer: <code>${esc(w.peer_node || "—")}</code>
        — topics: ${topicsHtml}<br>
        Events: <strong>${w.messages_total}</strong>
        (session: ${w.session_events_total ?? 0}, endpoint: ${w.endpoint_events_total ?? 0})
        · cache: <strong>${w.cache_size}</strong> sessioner
        · reconnects: ${w.reconnect_count}
        · sidste event: ${fmtAge(w.last_event_at)}
        · sidste connect: ${fmtAge(w.last_connect_at)}${lastErr}${lookupHtml}`;
    } catch (err) {
      el.innerHTML = `<span style="color:#b91c1c;">${t("settings.pxgrid_worker_err").replace("{msg}", esc(err.message))}</span>`;
    }
  }

  container.querySelector("#pxgrid-worker-refresh-btn").addEventListener("click", refreshWorkerStatus);
  container.querySelector("#pxgrid-worker-restart-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_restarting")}</div>`;
    try {
      await api.restartPxGridWorker();
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_restarted")}</div>`;
      await refreshWorkerStatus();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_restart_err").replace("{msg}", esc(err.message))}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  // Auto-refresh worker-status hvert 10s mens settings-siden er åben.
  refreshWorkerStatus();
  const workerStatusTimer = setInterval(refreshWorkerStatus, 10000);
  // Best-effort cleanup når view skiftes (app.js rydder containerens children).
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      clearInterval(workerStatusTimer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // CSR + account-create kalder backend-endpoints der gatekeeper på persisted
  // settings (node_name, cert_mode). Bruger kan have ændret formularen uden at
  // klikke Gem først — auto-save dropdown/node-navn så backend ser samme state
  // som UI'et. Password-feltet ekskluderes (tomt = bevar) for ikke at wipe en
  // eksisterende secret hvis brugeren ikke har skrevet noget.
  async function autoSaveBeforeAction() {
    const payload = buildPayload();
    payload.pxgrid_password = "";
    await api.updatePxGridSettings(payload);
  }

  async function downloadCsr({ silentOnError = false } = {}) {
    try {
      const filename = await api.downloadPxGridCsr();
      return filename;
    } catch (err) {
      if (!silentOnError) {
        msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_csr_dl_err").replace("{msg}", esc(err.message))}</div>`;
      }
      return null;
    }
  }

  container.querySelector("#pxgrid-csr-btn").addEventListener("click", async () => {
    if (!confirm(t("settings.pxgrid_csr_confirm"))) return;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_csr_generating")}</div>`;
    try {
      await autoSaveBeforeAction();
      const s = await api.generatePxGridCsr();
      // Auto-trigger download so admin har CSR-filen i Downloads med det samme.
      const filename = await downloadCsr({ silentOnError: true });
      const dlNote = filename
        ? t("settings.pxgrid_csr_dl_ok_note").replace("{filename}", `<code>${esc(filename)}</code>`)
        : t("settings.pxgrid_csr_dl_fail_note");
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_csr_done").replace("{path}", `<code>${esc(s.pxgrid_key_path)}</code>`).replace("{dl_note}", dlNote)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-csr-dl-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_csr_dl_loading")}</div>`;
    const filename = await downloadCsr();
    if (filename) {
      msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_csr_dl_done").replace("{filename}", `<code>${esc(filename)}</code>`)}</div>`;
    }
  });

  container.querySelector("#pxgrid-account-btn").addEventListener("click", async () => {
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_account_load")}</div>`;
    try {
      await autoSaveBeforeAction();
      const r = await api.createPxGridAccount();
      const cls = r.ok ? "success" : "error";
      msg.innerHTML = `<div class="alert ${cls}">[${esc(r.account_state)}] ${esc(r.message)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#pxgrid-reset-btn").addEventListener("click", async () => {
    const ok = window.confirm(t("settings.pxgrid_reset_confirm"));
    if (!ok) return;
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_resetting")}</div>`;
    try {
      const r = await api.resetPxGridRegistration();
      msg.innerHTML = `<div class="alert success">${esc(r.message)}</div>`;
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_reset_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#pxgrid-pfx-import-btn").addEventListener("click", async () => {
    const fileEl = container.querySelector("#pxgrid-pfx-file");
    const pwEl = container.querySelector("#pxgrid-pfx-pw");
    const file = fileEl.files?.[0];
    if (!file) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_pfx_no_file")}</div>`;
      return;
    }
    msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_pfx_importing")}</div>`;
    try {
      const s = await api.uploadPxGridPfx(file, pwEl.value);
      const caNote = s.pxgrid_ca_bundle_path
        ? ` CA-chain: <code>${esc(s.pxgrid_ca_bundle_path)}</code>.`
        : ` (Ingen CA-chain i bundlet — upload separat hvis nødvendigt.)`;
      msg.innerHTML = `<div class="alert success">PKCS#12 importeret. Cert: <code>${esc(s.pxgrid_cert_path)}</code>, Key: <code>${esc(s.pxgrid_key_path)}</code>.${caNote}</div>`;
      fileEl.value = "";
      pwEl.value = "";
      await loadSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_pfx_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  for (const [kind, id] of [
    ["cert", "pxgrid-upload-cert"],
    ["key", "pxgrid-upload-key"],
    ["ca", "pxgrid-upload-ca"],
    // Trin 3 + 4 i CSR-flowet: samme backend-endpoint som upload-block,
    // men eksponeret inde i CSR-blokken så admin ikke skal hoppe ud af
    // flowet efter download fra MS certsrv / ISE internal CA.
    ["cert", "pxgrid-csr-signed-cert"],
    ["ca", "pxgrid-csr-ca-bundle"],
  ]) {
    const inputEl = container.querySelector(`#${id}`);
    const statusEl = container.querySelector(`#${id}-status`);
    inputEl.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const filename = file.name;
      msg.innerHTML = `<div class="alert info">${t("settings.pxgrid_upload_loading").replace("{file}", esc(filename))}</div>`;
      if (statusEl) statusEl.innerHTML = `<span style="color:#666;">${t("settings.pxgrid_upload_loading").replace("{file}", esc(filename))}</span>`;
      try {
        await api.uploadPxGridCert(kind, file);
        msg.innerHTML = `<div class="alert success">${t("settings.pxgrid_upload_done").replace("{kind}", esc(kind)).replace("{file}", esc(filename))}</div>`;
        if (statusEl) statusEl.innerHTML = `<span style="color:#16a34a;">${t("settings.pxgrid_upload_ok").replace("{file}", esc(filename))}</span>`;
        await loadSettings();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("settings.pxgrid_upload_err").replace("{kind}", esc(kind)).replace("{msg}", esc(err.message))}</div>`;
        if (statusEl) statusEl.innerHTML = `<span style="color:#c0392b;">${t("settings.pxgrid_upload_fail").replace("{msg}", esc(err.message))}</span>`;
      } finally {
        // Reset input så samme fil kan vælges igen efter fejl/genupload.
        e.target.value = "";
      }
    });
  }

  await loadSettings();
}
