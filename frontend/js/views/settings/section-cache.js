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
  return `${d.toLocaleTimeString()} (${fmtAge(age)}${t("settings.ago")})`;
}

function renderCacheStats(container, stats) {
  const hits       = stats.hits || 0;
  const misses     = stats.misses || 0;
  const staleServes = stats.stale_serves || 0;
  const total      = hits + misses + staleServes;
  const hitRate    = total > 0 ? ((hits + staleServes) / total * 100).toFixed(1) : "—";

  const pw = stats.prewarm;
  const sl = stats.staleness;

  // ── Pre-warm + drip + cache-alder ────────────────────────────────────────
  let prewarmRows = "";
  if (pw == null) {
    prewarmRows = `<tr><td colspan="2" style="color:#888;font-style:italic;">${t("settings.cache_prewarm_na")}</td></tr>`;
  } else {
    const scanPct = pw.total_endpoints > 0
      ? Math.round(pw.scanned / pw.total_endpoints * 100) : 0;
    const scanStatus = pw.scanning
      ? t("settings.cache_scanning")
          .replace("{done}", pw.scanned).replace("{total}", pw.total_endpoints)
          .replace("{pct}", scanPct).replace("{n}", pw.scan_number)
      : pw.running
        ? t("settings.cache_active").replace("{n}", pw.scan_number + 1)
        : `<span style="color:#c0392b;">${t("settings.cache_stopped")}</span>`;
    const scanAge = pw.last_full_scan_age_s != null
      ? t("settings.cache_ago").replace("{t}", fmtAge(pw.last_full_scan_age_s * 1000)) : "—";
    const diskSave = pw.last_disk_save_at ? fmtTimestamp(pw.last_disk_save_at) : "—";

    let dripCapacityBadge = "";
    if (pw.drip_estimated_full_cycle_s != null && pw.drip_current_sleep_s > 0) {
      const configInterval = parseFloat(document.getElementById("cache_prewarm_interval_s")?.value) || 1800;
      const ratio    = pw.drip_estimated_full_cycle_s / configInterval;
      const cycleStr = fmtAge(pw.drip_estimated_full_cycle_s);
      if (ratio <= 0.9) {
        dripCapacityBadge = `<span style="background:#27ae60;color:#fff;border-radius:4px;padding:1px 7px;font-size:.82em;margin-left:6px;">${t("settings.cache_capacity_ok").replace("{cycle}", cycleStr)}</span>`;
      } else if (ratio <= 1.1) {
        dripCapacityBadge = `<span style="background:#f39c12;color:#fff;border-radius:4px;padding:1px 7px;font-size:.82em;margin-left:6px;">${t("settings.cache_capacity_warn").replace("{cycle}", cycleStr)}</span>`;
      } else {
        dripCapacityBadge = `<span style="background:#c0392b;color:#fff;border-radius:4px;padding:1px 7px;font-size:.82em;margin-left:6px;">${t("settings.cache_capacity_behind").replace("{cycle}", cycleStr)}</span>`;
      }
    }

    let staleBar = "";
    if (sl) {
      const slTotal = (sl.fresh_count || 0) + (sl.stale_count || 0) + (sl.very_stale_count || 0);
      if (slTotal > 0) {
        const freshPct = (sl.fresh_count / slTotal * 100).toFixed(0);
        const stalePct = (sl.stale_count / slTotal * 100).toFixed(0);
        const veryPct  = (sl.very_stale_count / slTotal * 100).toFixed(0);
        staleBar = `
          <tr><td colspan="2" style="padding-top:.3rem;">
            <div title="Frisk: ${sl.fresh_count} | Stale: ${sl.stale_count} | Meget stale: ${sl.very_stale_count}"
                 style="display:flex;height:10px;border-radius:4px;overflow:hidden;width:100%;margin-top:2px;">
              <div style="width:${freshPct}%;background:#27ae60;" title="Frisk ${freshPct}%"></div>
              <div style="width:${stalePct}%;background:#f39c12;" title="Stale ${stalePct}%"></div>
              <div style="width:${veryPct}%;background:#c0392b;" title="Meget stale ${veryPct}%"></div>
            </div>
            <div style="font-size:.78em;color:#888;margin-top:2px;">
              <span style="color:#27ae60;">&#9632;</span> Frisk: ${sl.fresh_count}
              &nbsp;<span style="color:#f39c12;">&#9632;</span> Stale: ${sl.stale_count}
              &nbsp;<span style="color:#c0392b;">&#9632;</span> Meget stale: ${sl.very_stale_count}
            </div>
          </td></tr>`;
      }
    }

    prewarmRows = `
      <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Pre-warm worker</td></tr>
      <tr><td>Status</td><td>${scanStatus}</td></tr>
      <tr><td>${t("settings.cache_prewarm_last")}</td><td>${scanAge}</td></tr>
      <tr><td>${t("settings.cache_prewarm_disk")}</td><td>${diskSave}</td></tr>
      <tr><td>${t("settings.cache_prewarm_loaded")}</td><td>${pw.disk_loaded}</td></tr>
      <tr><td>${t("settings.cache_hot_queue")}</td><td>${t("settings.cache_hot_n").replace("{n}", pw.hot_queue_size)}</td></tr>
      ${pw.last_error ? `<tr><td>${t("settings.cache_last_err")}</td><td><span style="color:#c0392b;">${esc(pw.last_error)}</span></td></tr>` : ""}
      <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Drip-refresh</td></tr>
      <tr><td>Kapacitet</td><td>
        Opdateringsinterval: ${fmtAge(pw.drip_current_sleep_s)}${dripCapacityBadge}
      </td></tr>
      ${pw.adaptive_speed_factor != null ? `
      <tr><td>Adaptiv hastighed</td><td>
        <span style="font-weight:600;color:${pw.adaptive_speed_factor >= 1 ? "#27ae60" : "#f39c12"};">${pw.adaptive_speed_factor.toFixed(2)}×</span>
        <span style="color:#888;font-size:.85em;margin-left:4px;">${pw.adaptive_speed_factor > 1 ? "hurtigere — ISE sund" : pw.adaptive_speed_factor < 1 ? "langsommere — ISE presset" : "baseline"}</span>
      </td></tr>` : ""}
      <tr><td>Refreshet i alt</td><td>${pw.drip_refreshed_total} endpoints (sprunget over: ${pw.drip_skipped_total})</td></tr>
      ${sl ? `
      <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Cache-alder</td></tr>
      <tr><td>Ældste entry</td><td>${sl.oldest_entry_age_s != null ? fmtAge(sl.oldest_entry_age_s) : "—"}</td></tr>
      <tr><td>Gennemsnitlig alder</td><td>${sl.average_entry_age_s != null ? fmtAge(sl.average_entry_age_s) : "—"}</td></tr>
      <tr><td>Stale-andel</td><td>${sl.stale_pct}% (${(sl.stale_count || 0) + (sl.very_stale_count || 0)} af ${(sl.fresh_count || 0) + (sl.stale_count || 0) + (sl.very_stale_count || 0)} entries)</td></tr>
      ${staleBar}` : ""}`;
  }

  // ── Tier-fordeling (EMA) + evictions ─────────────────────────────────────
  const tiers    = stats.tiers || {};
  const hot      = tiers.hot  ?? 0;
  const warm     = tiers.warm ?? 0;
  const cold     = tiers.cold ?? 0;
  const tierTotal = hot + warm + cold || 1;
  const tierRows  = (hot || warm || cold) ? `
      <tr><td colspan="2" style="font-weight:600;padding-top:.6rem;">Tier-fordeling (EMA)</td></tr>
      <tr><td colspan="2">
        <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:4px;">
          ${hot  ? `<div style="flex:${hot};background:#c0392b;"  title="Hot: ${hot}"></div>`  : ""}
          ${warm ? `<div style="flex:${warm};background:#f39c12;" title="Warm: ${warm}"></div>` : ""}
          ${cold ? `<div style="flex:${cold};background:#2980b9;" title="Cold: ${cold}"></div>` : ""}
        </div>
        <div style="font-size:.8em;color:#888;">
          🔥 Hot: ${hot} (${Math.round(hot / tierTotal * 100)}%)&nbsp;&nbsp;
          ~ Warm: ${warm} (${Math.round(warm / tierTotal * 100)}%)&nbsp;&nbsp;
          ❄ Cold: ${cold} (${Math.round(cold / tierTotal * 100)}%)
        </div>
      </td></tr>
      ${(stats.evictions ?? 0) > 0
        ? `<tr><td>Evictions</td><td style="color:#c0392b;font-weight:600;">${stats.evictions}</td></tr>`
        : ""}` : "";

  container.innerHTML = `
    <table class="cache-stats-table">
      <tbody>
        <tr><td>Status</td><td>${stats.enabled ? t("settings.cache_stats_enabled") : t("settings.cache_stats_disabled")}</td></tr>
        <tr><td>TTL (base)</td><td>${stats.ttl_seconds}s</td></tr>
        ${stats.adaptive_ttl_enabled && stats.effective_ttl_seconds != null ? `
        <tr><td>Effektiv TTL (adaptiv)</td><td>${Math.round(stats.effective_ttl_seconds)}s${
          stats.adaptive_ttl_idle_s != null ? ` <span style="color:#888;font-size:.85em;">(portal inaktiv ${fmtAge(stats.adaptive_ttl_idle_s)})</span>` : ""
        }</td></tr>` : ""}
        <tr><td>Stale-while-revalidate</td><td>${stats.stale_while_revalidate ? t("settings.cache_stats_on") : t("settings.cache_stats_off")}</td></tr>
        <tr><td>${t("settings.cache_detail_entries")}</td><td>${stats.detail_entries}</td></tr>
        <tr><td>${t("settings.cache_disk_stale")}</td><td>${stats.disk_stale_entries ?? 0}</td></tr>
        <tr><td>${t("settings.cache_disk_loads")}</td><td>${stats.disk_loads ?? 0}</td></tr>
        <tr><td>${t("settings.cache_groups")}</td><td>${stats.groups_cached ? t("cell.yes") : t("btn.no")}</td></tr>
        <tr><td>${t("settings.cache_hitrate")}</td><td>${hitRate === "—" ? "—" : hitRate + "%"} (hits: ${hits}, stale: ${staleServes}, misses: ${misses})</td></tr>
        <tr><td>${t("settings.cache_bg_refresh")}</td><td>${stats.bg_refreshes || 0} (${stats.inflight_detail_refreshes || 0} inflight)</td></tr>
        <tr><td>${t("settings.cache_invalidations")}</td><td>${stats.invalidations || 0}</td></tr>
        <tr><td>${t("settings.cache_last_sync")}</td><td>${fmtTimestamp(stats.last_sync_at)}</td></tr>
        <tr><td>${t("settings.cache_sync_err")}</td><td>${stats.last_sync_error
          ? `<span style="color:#c0392b;">${esc(stats.last_sync_error)}</span>`
          : t("settings.cache_no_err")}</td></tr>
        ${prewarmRows}
        ${tierRows}
      </tbody>
    </table>
  `;
}

export async function initCacheSection(container) {
  const msg          = container.querySelector("#cache-msg");
  const statsBox     = container.querySelector("#cache-stats");
  const refreshBtn   = container.querySelector("#cache-refresh-btn");
  const invalidateBtn = container.querySelector("#cache-invalidate-btn");

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
      container.querySelector("#cache_max_entries").value = s.cache_max_entries ?? 5000;
      container.querySelector("#cache_max_memory_mb").value = s.cache_max_memory_mb ?? 300;
      container.querySelector("#cache_prewarm_interval_s").value = s.cache_prewarm_interval_s ?? 1800;
      container.querySelector("#cache_prewarm_skip_fresh_s").value = s.cache_prewarm_skip_fresh_s ?? 900;
      container.querySelector("#cache_prewarm_concurrency").value = s.cache_prewarm_concurrency ?? 5;
      container.querySelector("#adaptive_pacing_enabled").checked = s.adaptive_pacing_enabled !== false;
      container.querySelector("#adaptive_pacing_range_pct").value = s.adaptive_pacing_range_pct ?? 50;
      container.querySelector("#adaptive_ttl_enabled").checked = s.adaptive_ttl_enabled !== false;
      container.querySelector("#adaptive_ttl_max_seconds").value = s.adaptive_ttl_max_seconds ?? 3600;
      container.querySelector("#adaptive_scan_max_seconds").value = s.adaptive_scan_max_seconds ?? 14400;
      container.querySelector("#ise_group_cache_ttl_s").value = s.ise_group_cache_ttl_s ?? 7200;
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
    let current;
    try {
      current = await api.getBackendSettings();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.cache_read_err").replace("{msg}", esc(err.message))}</div>`;
      return;
    }
    const payload = {
      ise_base_url:              current.ise_base_url,
      ise_username:              current.ise_username,
      ise_password:              "",
      ise_verify_tls:            current.ise_verify_tls,
      ise_timeout:               current.ise_timeout,
      ise_api_type:              current.ise_api_type,
      coa_psn_name:              current.coa_psn_name,
      coa_reauth_type:           current.coa_reauth_type,
      coa_disconnect_type:       current.coa_disconnect_type,
      cache_enabled:             container.querySelector("#cache_enabled").checked,
      cache_ttl_seconds:         parseFloat(container.querySelector("#cache_ttl_seconds").value),
      cache_stale_while_revalidate: container.querySelector("#cache_stale_while_revalidate").checked,
      cache_sync_interval_seconds: parseFloat(container.querySelector("#cache_sync_interval_seconds").value),
      cache_max_entries:         parseInt(container.querySelector("#cache_max_entries").value, 10),
      cache_max_memory_mb:       parseInt(container.querySelector("#cache_max_memory_mb").value, 10),
      cache_prewarm_interval_s:  parseFloat(container.querySelector("#cache_prewarm_interval_s").value),
      cache_prewarm_skip_fresh_s: parseFloat(container.querySelector("#cache_prewarm_skip_fresh_s").value),
      cache_prewarm_concurrency: parseInt(container.querySelector("#cache_prewarm_concurrency").value, 10),
      adaptive_pacing_enabled:   container.querySelector("#adaptive_pacing_enabled").checked,
      adaptive_pacing_range_pct: parseFloat(container.querySelector("#adaptive_pacing_range_pct").value),
      adaptive_ttl_enabled:      container.querySelector("#adaptive_ttl_enabled").checked,
      adaptive_ttl_max_seconds:  parseFloat(container.querySelector("#adaptive_ttl_max_seconds").value),
      adaptive_scan_max_seconds: parseFloat(container.querySelector("#adaptive_scan_max_seconds").value),
      ise_group_cache_ttl_s:     parseFloat(container.querySelector("#ise_group_cache_ttl_s").value),
      cache_disk_path:           container.querySelector("#cache_disk_path").value.trim(),
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
