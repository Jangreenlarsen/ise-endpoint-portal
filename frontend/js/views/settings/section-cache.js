// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

function fmtAge(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function fmtTimestamp(unixSeconds) {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  const age = (Date.now() / 1000) - unixSeconds;
  return `${d.toLocaleTimeString()} (${fmtAge(age)} siden)`;
}

function renderCacheStats(container, stats) {
  const hits = stats.hits || 0;
  const misses = stats.misses || 0;
  const staleServes = stats.stale_serves || 0;
  const total = hits + misses + staleServes;
  const hitRate = total > 0 ? ((hits + staleServes) / total * 100).toFixed(1) : "—";

  const pw = stats.prewarm;
  let prewarmRows = "";
  if (pw == null) {
    prewarmRows = `<tr><td colspan="2" style="color:#888;font-style:italic;">${t("settings.cache_prewarm_na")}</td></tr>`;
  } else {
    const scanPct = pw.total_endpoints > 0 ? Math.round(pw.scanned / pw.total_endpoints * 100) : 0;
    const scanStatus = pw.scanning
      ? t("settings.cache_scanning").replace("{done}", pw.scanned).replace("{total}", pw.total_endpoints).replace("{pct}", scanPct).replace("{n}", pw.scan_number)
      : pw.running ? t("settings.cache_active").replace("{n}", pw.scan_number + 1) : `<span style="color:#c0392b;">${t("settings.cache_stopped")}</span>`;
    const scanAge = pw.last_full_scan_age_s != null
      ? t("settings.cache_ago").replace("{t}", fmtAge(pw.last_full_scan_age_s * 1000)) : "—";
    const diskSave = pw.last_disk_save_at
      ? fmtTimestamp(pw.last_disk_save_at) : "—";
    prewarmRows = `
        <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Pre-warm worker</td></tr>
        <tr><td>Status</td><td>${scanStatus}</td></tr>
        <tr><td>${t("settings.cache_prewarm_last")}</td><td>${scanAge}</td></tr>
        <tr><td>${t("settings.cache_prewarm_disk")}</td><td>${diskSave}</td></tr>
        <tr><td>${t("settings.cache_prewarm_loaded")}</td><td>${pw.disk_loaded}</td></tr>
        <tr><td>${t("settings.cache_hot_queue")}</td><td>${t("settings.cache_hot_n").replace("{n}", pw.hot_queue_size)}</td></tr>
        ${pw.last_error ? `<tr><td>${t("settings.cache_last_err")}</td><td><span style="color:#c0392b;">${esc(pw.last_error)}</span></td></tr>` : ""}`;
  }

  container.innerHTML = `
    <table class="cache-stats-table">
      <tbody>
        <tr><td>Status</td><td>${stats.enabled ? t("settings.cache_stats_enabled") : t("settings.cache_stats_disabled")}</td></tr>
        <tr><td>TTL</td><td>${stats.ttl_seconds}s</td></tr>
        <tr><td>Stale-while-revalidate</td><td>${stats.stale_while_revalidate ? t("settings.cache_stats_on") : t("settings.cache_stats_off")}</td></tr>
        <tr><td>${t("settings.cache_detail_entries")}</td><td>${stats.detail_entries}</td></tr>
        <tr><td>${t("settings.cache_disk_stale")}</td><td>${stats.disk_stale_entries ?? 0}</td></tr>
        <tr><td>${t("settings.cache_disk_loads")}</td><td>${stats.disk_loads ?? 0}</td></tr>
        <tr><td>${t("settings.cache_groups")}</td><td>${stats.groups_cached ? t("cell.yes") : t("btn.no")}</td></tr>
        <tr><td>${t("settings.cache_hitrate")}</td><td>${hitRate === "—" ? "—" : hitRate + "%"} (hits: ${hits}, stale: ${staleServes}, misses: ${misses})</td></tr>
        <tr><td>${t("settings.cache_bg_refresh")}</td><td>${stats.bg_refreshes || 0} (${stats.inflight_detail_refreshes || 0} inflight)</td></tr>
        <tr><td>${t("settings.cache_invalidations")}</td><td>${stats.invalidations || 0}</td></tr>
        <tr><td>${t("settings.cache_last_sync")}</td><td>${fmtTimestamp(stats.last_sync_at)}</td></tr>
        <tr><td>${t("settings.cache_sync_err")}</td><td>${stats.last_sync_error ? `<span style="color:#c0392b;">${esc(stats.last_sync_error)}</span>` : t("settings.cache_no_err")}</td></tr>
        ${prewarmRows}
      </tbody>
    </table>
  `;
}

export async function initCacheSection(container) {
  const msg = container.querySelector("#cache-msg");
  const statsBox = container.querySelector("#cache-stats");
  const refreshBtn = container.querySelector("#cache-refresh-btn");
  const invalidateBtn = container.querySelector("#cache-invalidate-btn");

  // Set element texts
  const cacheCardH3 = container.querySelector("#cache-card-h3");
  if (cacheCardH3) cacheCardH3.textContent = t("settings.cache_card");
  const cacheEnabledLbl = container.querySelector("#cache-enabled-lbl");
  if (cacheEnabledLbl) cacheEnabledLbl.textContent = t("settings.cache_enabled_lbl");
  const cacheEnabledHint = container.querySelector("#cache-enabled-hint");
  if (cacheEnabledHint) cacheEnabledHint.textContent = t("settings.cache_enabled_hint");
  const cacheTtlLbl = container.querySelector("#cache-ttl-lbl");
  if (cacheTtlLbl) cacheTtlLbl.textContent = t("settings.cache_ttl");
  const cacheStaleWrLbl = container.querySelector("#cache-stale-wr-lbl");
  if (cacheStaleWrLbl) cacheStaleWrLbl.textContent = t("settings.cache_stale_wr");
  const cacheSyncLbl = container.querySelector("#cache-sync-interval-lbl");
  if (cacheSyncLbl) cacheSyncLbl.textContent = t("settings.cache_sync_interval");
  const cachePrewarmH4 = container.querySelector("#cache-prewarm-h4");
  if (cachePrewarmH4) cachePrewarmH4.textContent = t("settings.cache_prewarm_h4");
  const cacheScanLbl = container.querySelector("#cache-scan-interval-lbl");
  if (cacheScanLbl) cacheScanLbl.textContent = t("settings.cache_scan_interval");
  const cacheConcurrencyLbl = container.querySelector("#cache-concurrency-lbl");
  if (cacheConcurrencyLbl) cacheConcurrencyLbl.textContent = t("settings.cache_concurrency");
  const cacheDiskPathLbl = container.querySelector("#cache-disk-path-lbl");
  if (cacheDiskPathLbl) cacheDiskPathLbl.textContent = t("settings.cache_disk_path_lbl");
  const cacheBtnSave = container.querySelector("#cache-btn-save");
  if (cacheBtnSave) cacheBtnSave.textContent = t("settings.cache_btn_save");
  const cacheLiveH4 = container.querySelector("#cache-live-status-h4");
  if (cacheLiveH4) cacheLiveH4.textContent = t("settings.cache_live_status");
  const cacheFetchingHint = container.querySelector("#cache-fetching-hint");
  if (cacheFetchingHint) cacheFetchingHint.textContent = t("settings.cache_fetching");
  const cacheRefreshBtn = container.querySelector("#cache-refresh-btn");
  if (cacheRefreshBtn) cacheRefreshBtn.textContent = t("settings.cache_btn_refresh");
  const cacheInvalidateBtn = container.querySelector("#cache-invalidate-btn");
  if (cacheInvalidateBtn) cacheInvalidateBtn.textContent = t("settings.cache_btn_clear");

  async function loadSettings() {
    try {
      const s = await api.getBackendSettings();
      container.querySelector("#cache_enabled").checked = !!s.cache_enabled;
      container.querySelector("#cache_ttl_seconds").value = s.cache_ttl_seconds ?? 60;
      container.querySelector("#cache_stale_while_revalidate").checked = !!s.cache_stale_while_revalidate;
      container.querySelector("#cache_sync_interval_seconds").value = s.cache_sync_interval_seconds ?? 300;
      container.querySelector("#cache_prewarm_interval_s").value = s.cache_prewarm_interval_s ?? 1800;
      container.querySelector("#cache_prewarm_concurrency").value = s.cache_prewarm_concurrency ?? 5;
      container.querySelector("#cache_disk_path").value = s.cache_disk_path ?? "cache/endpoints.json";
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.cache_load_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  async function loadStats() {
    try {
      const stats = await api.getCacheStats();
      renderCacheStats(statsBox, stats);
    } catch (err) {
      statsBox.innerHTML = `<div class="alert error">${t("settings.cache_stats_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  await loadSettings();
  await loadStats();

  container.querySelector("#cache-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    // Preserve all other backend settings — cache updates go through the same endpoint.
    let current;
    try {
      current = await api.getBackendSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.cache_read_err").replace("{msg}", esc(err.message))}</div>`;
      return;
    }
    const payload = {
      ise_base_url: current.ise_base_url,
      ise_username: current.ise_username,
      ise_password: "",  // keep existing
      ise_verify_tls: current.ise_verify_tls,
      ise_timeout: current.ise_timeout,
      ise_api_type: current.ise_api_type,
      coa_psn_name: current.coa_psn_name,
      coa_reauth_type: current.coa_reauth_type,
      coa_disconnect_type: current.coa_disconnect_type,
      cache_enabled: container.querySelector("#cache_enabled").checked,
      cache_ttl_seconds: parseFloat(container.querySelector("#cache_ttl_seconds").value),
      cache_stale_while_revalidate: container.querySelector("#cache_stale_while_revalidate").checked,
      cache_sync_interval_seconds: parseFloat(container.querySelector("#cache_sync_interval_seconds").value),
      cache_prewarm_interval_s: parseFloat(container.querySelector("#cache_prewarm_interval_s").value),
      cache_prewarm_concurrency: parseInt(container.querySelector("#cache_prewarm_concurrency").value, 10),
      cache_disk_path: container.querySelector("#cache_disk_path").value.trim(),
    };
    try {
      await api.updateBackendSettings(payload);
      msg.innerHTML = `<div class="alert success">${t("settings.cache_saved")}</div>`;
      await loadStats();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  refreshBtn.addEventListener("click", loadStats);

  invalidateBtn.addEventListener("click", async () => {
    if (!confirm(t("settings.cache_clear_confirm"))) return;
    try {
      await api.invalidateCache();
      msg.innerHTML = `<div class="alert success">${t("settings.cache_cleared")}</div>`;
      await loadStats();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}
