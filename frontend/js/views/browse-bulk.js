// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
// Bulk-edit modal, bulk-delete, and bulk-disconnect for Browse.
// initBulk wires all bulk-action event handlers (no public API returned).

import { t } from "../i18n.js";
import { esc, optionsHtml } from "./browse-utils.js";

export function initBulk(container, state, api, cb) {
  const tbody          = container.querySelector("#tbody");
  const msg            = container.querySelector("#msg");
  const bulkEditBtn    = container.querySelector("#bulk-edit-btn");
  const bulkEditOverlay = container.querySelector("#bulk-edit-overlay");
  const bulkDisconnBtn = container.querySelector("#bulk-disconnect-btn");
  const bulkCoaBtn     = container.querySelector("#bulk-coa-btn");
  const bulkSimBtn     = container.querySelector("#bulk-sim-btn");
  const bulkSimOverlay = container.querySelector("#bulk-sim-overlay");
  const tplPickOverlay = container.querySelector("#tpl-pick-overlay");
  // Action buttons live in the bulk-edit modal
  const beTplBtn      = container.querySelector("#be-tpl-btn");
  const beDelBtn      = container.querySelector("#be-del-btn");
  const beDecommBtn   = container.querySelector("#be-decomm-btn");
  const beUndecommBtn = container.querySelector("#be-undecomm-btn");

  // ── Bulk-edit modal ──────────────────────────────────────────────────────
  bulkEditBtn.addEventListener("click", () => {
    const ids = cb.getSelectedIds();
    if (!ids.length) return;
    container.querySelector("#bulk-edit-count").textContent = `${ids.length} ${t("bulk.count_suffix")}`;
    container.querySelector("#be-group").innerHTML      = cb.groupOptionsHtml("");
    container.querySelector("#be-type").innerHTML       = optionsHtml(state.caValues.Type, "");
    container.querySelector("#be-owner").innerHTML      = optionsHtml(state.caValues.Owner, "");
    container.querySelector("#be-lokation").innerHTML   = optionsHtml(state.caValues.Lokation, "");
    container.querySelector("#be-authzvlan").innerHTML  = optionsHtml(state.caValues.AuthzVlan, "");
    container.querySelector("#be-authzacl").innerHTML   = optionsHtml(state.caValues.AuthzACL, "");
    container.querySelector("#be-platformtype").innerHTML = optionsHtml(state.caValues.PlatformType, "");
    container.querySelector("#be-roles").innerHTML      = cb.rolesChipsHtml([], { editable: true });
    container.querySelector("#be-description").value   = "";
    container.querySelector("#be-static-group-cb").checked = false;
    container.querySelector("#be-psk-mode-cb").checked = false;
    container.querySelector("#be-psk-key-inp").value   = "";
    container.querySelector("#be-psk-show").textContent = t("bulk.btn_show");
    ["be-psk-mode-row", "be-psk-mode", "be-psk-key-row", "be-psk-key"].forEach((id) => {
      container.querySelector(`#${id}`).classList.toggle("hidden", !state.isPskEditor);
    });
    bulkEditOverlay.querySelectorAll(".be-cb").forEach((cbEl) => {
      cbEl.checked = false;
      const ctrl = bulkEditOverlay.querySelector(`#be-${cbEl.dataset.field}`);
      if (!ctrl) return;
      if (ctrl.tagName === "DIV") {
        ctrl.classList.add("disabled-overlay");
        ctrl.querySelectorAll("input, button").forEach((el) => { el.disabled = true; });
      } else { ctrl.disabled = true; }
    });
    bulkEditOverlay.classList.remove("hidden");
  });

  // Toggle fields when be-cb is checked
  bulkEditOverlay.querySelectorAll(".be-cb").forEach((cbEl) => {
    cbEl.addEventListener("change", () => {
      const ctrl = bulkEditOverlay.querySelector(`#be-${cbEl.dataset.field}`);
      if (!ctrl) return;
      if (ctrl.tagName === "DIV") {
        ctrl.classList.toggle("disabled-overlay", !cbEl.checked);
        ctrl.querySelectorAll("input, button").forEach((el) => { el.disabled = !cbEl.checked; });
      } else { ctrl.disabled = !cbEl.checked; }
    });
  });

  container.querySelector("#be-psk-show").addEventListener("click", () => {
    const inp = container.querySelector("#be-psk-key-inp");
    const btn = container.querySelector("#be-psk-show");
    inp.type = inp.type === "password" ? "text" : "password";
    btn.textContent = inp.type === "password" ? t("bulk.btn_show") : t("bulk.btn_hide");
  });

  container.querySelector("#be-psk-gen").addEventListener("click", async () => {
    try {
      const result = await api.generatePskKey();
      const inp = container.querySelector("#be-psk-key-inp");
      inp.value = result.key; inp.type = "text";
      container.querySelector("#be-psk-show").textContent = t("bulk.btn_hide");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("browse.psk_gen_err").replace("{msg}", esc(err.message))}</div>`;
    }
  });

  container.querySelector("#be-cancel").addEventListener("click", () => {
    bulkEditOverlay.classList.add("hidden");
  });

  container.querySelector("#be-apply").addEventListener("click", () => {
    const ids = cb.getSelectedIds();
    if (!ids.length) return;
    const fields = {};
    bulkEditOverlay.querySelectorAll(".be-cb:checked").forEach((cbEl) => {
      const field = cbEl.dataset.field;
      if (field === "roles") {
        const chips = bulkEditOverlay.querySelectorAll("#be-roles .row-role-chip:checked");
        fields.roles = Array.from(chips).map((c) => c.dataset.role);
        return;
      }
      if (field === "static-group")  { fields["static-group"]  = bulkEditOverlay.querySelector("#be-static-group-cb").checked; return; }
      if (field === "psk-mode")      { fields["psk-mode"]      = bulkEditOverlay.querySelector("#be-psk-mode-cb").checked;    return; }
      if (field === "psk-key")       { fields["psk-key"]       = bulkEditOverlay.querySelector("#be-psk-key-inp").value;      return; }
      if (field === "active-status") { fields["active-status"] = bulkEditOverlay.querySelector("#be-active-status").value;    return; }
      const ctrl = bulkEditOverlay.querySelector(`#be-${field}`);
      if (ctrl) fields[field] = ctrl.value;
    });
    if (!Object.keys(fields).length) { bulkEditOverlay.classList.add("hidden"); return; }

    for (const id of ids) {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (!tr) continue;
      if ("group" in fields) tr.querySelector(".grp-select").value = fields.group;
      if ("static-group" in fields) {
        const assignCell = tr.querySelector(".assign-cell");
        if (assignCell) assignCell.textContent = fields["static-group"] ? t("cell.static") : t("cell.dynamic");
        tr.dataset.beStaticGroup = fields["static-group"] ? "1" : "0";
      }
      if ("description" in fields) tr.querySelector(".desc-input").value  = fields.description;
      if ("type" in fields)        tr.querySelector(".ca-type").value      = fields.type;
      if ("owner" in fields)       tr.querySelector(".ca-owner").value     = fields.owner;
      if ("lokation" in fields)    tr.querySelector(".ca-lokation").value  = fields.lokation;
      if ("authzvlan" in fields)   tr.querySelector(".ca-authzvlan").value = fields.authzvlan;
      if ("authzacl" in fields)    tr.querySelector(".ca-authzacl").value  = fields.authzacl;
      if ("platformtype" in fields) tr.querySelector(".ca-platformtype").value = fields.platformtype;
      if ("guestreg" in fields) { const s = tr.querySelector(".ca-guestreg"); if (s) s.value = fields.guestreg; }
      if ("psk-mode" in fields) {
        const cbEl = tr.querySelector(".psk-mode-cb");
        if (cbEl) cbEl.checked = !!fields["psk-mode"];
      }
      if ("psk-key" in fields) {
        const cell = tr.querySelector(".psk-key-cell");
        if (cell) cell.textContent = fields["psk-key"];
        tr.dataset.bePskKey = fields["psk-key"];
      }
      if ("roles" in fields) {
        const row          = state.allRows.find((r) => r.id === id);
        const catalogLower = new Set(state.roleCatalog.map((c) => c.name.toLowerCase()));
        const externalRoles = ((row && row.roles) || []).filter(
          (r) => !catalogLower.has((r || "").toLowerCase()),
        );
        const newRoles = [...externalRoles, ...fields.roles];
        const cell = tr.querySelector(".roles-cell");
        if (cell) cell.innerHTML = cb.rolesChipsHtml(newRoles);
      }
      if ("active-status" in fields) {
        tr.dataset.beActiveStatus = fields["active-status"];
        // Update badge in MAC cell
        const macCell = tr.querySelector(".mac-cell");
        if (macCell) {
          macCell.querySelectorAll(".active-status-row-badge").forEach(b => b.remove());
          const v = fields["active-status"];
          if (v === "Inaktiv") {
            macCell.insertAdjacentHTML("beforeend", `<span class="active-status-row-badge inaktiv" title="${t("detail.active_status_inaktiv")}">⊘</span>`);
          } else if (v === "Aktiv") {
            macCell.insertAdjacentHTML("beforeend", `<span class="active-status-row-badge aktiv" title="${t("detail.active_status_aktiv")}">✓</span>`);
          }
        }
      }
      cb.markDirty(tr);
    }
    bulkEditOverlay.classList.add("hidden");
    msg.innerHTML = `<div class="alert info">${ids.length} ${t("bulk.updated_local")}</div>`;
  });

  // ── Bulk disconnect ───────────────────────────────────────────────────────
  bulkDisconnBtn.addEventListener("click", async () => {
    const ids = cb.getSelectedIds();
    if (!ids.length) return;
    const macs = ids.map((id) => {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      return tr ? tr.querySelector(".mac-cell").textContent : id;
    });
    if (!confirm(
      t("bulk.confirm_disconnect").replace("{n}", ids.length).replace("{macs}", macs.join("\n")),
    )) return;
    bulkDisconnBtn.disabled = true;
    msg.innerHTML = `<div class="alert info">${t("browse.coa_disc_progress").replace("{n}", ids.length)}</div>`;
    let ok = 0, fail = 0;
    const failures = [];
    for (const id of ids) {
      try {
        const res = await api.coaDisconnect(id);
        if (res?.ok) ok++;
        else { fail++; failures.push(`${res?.mac || id}: ${res?.message || t("bulk.failed")}`); }
      } catch (err) { fail++; failures.push(`${id}: ${err.message}`); }
    }
    const parts = [];
    if (ok)   parts.push(`${ok} disconnected`);
    if (fail) parts.push(`${fail} ${t("bulk.failed")}`);
    const cls    = fail ? (ok ? "info" : "error") : "success";
    const detail = failures.length ? `<br><small>${failures.slice(0, 5).map(esc).join("<br>")}</small>` : "";
    msg.innerHTML = `<div class="alert ${cls}">${parts.join(", ")}${detail}</div>`;
    bulkDisconnBtn.disabled = false;
  });

  // ── Bulk CoA Reauth ───────────────────────────────────────────────────────
  if (bulkCoaBtn) {
    bulkCoaBtn.addEventListener("click", async () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      if (!confirm(t("browse.coa_reauth_confirm").replace("{n}", ids.length))) return;
      bulkCoaBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("browse.coa_reauth_progress").replace("{n}", ids.length)}</div>`;
      try {
        const res = await api.bulkCoa(ids, "reauth");
        const ok   = res?.ok_count ?? 0;
        const fail = (res?.results || []).filter((r) => !r.ok).length;
        const cls  = fail ? (ok ? "info" : "error") : "success";
        msg.innerHTML = `<div class="alert ${cls}">${t("browse.coa_reauth_result").replace("{ok}", ok).replace("{fail}", fail)}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("browse.coa_reauth_err").replace("{msg}", esc(err.message))}</div>`;
      } finally {
        bulkCoaBtn.disabled = false;
      }
    });
  }

  // ── Bulk Simulate match ───────────────────────────────────────────────────
  if (bulkSimBtn && bulkSimOverlay) {
    const policySetSel = bulkSimOverlay.querySelector("#bsim-policy-set");
    const simCount     = bulkSimOverlay.querySelector("#bulk-sim-count");
    const runBtn       = bulkSimOverlay.querySelector("#bsim-run");
    const cancelBtn    = bulkSimOverlay.querySelector("#bsim-cancel");
    const resultsDiv   = bulkSimOverlay.querySelector("#bsim-results");
    const summaryEl    = bulkSimOverlay.querySelector("#bsim-summary");
    const tbody2       = bulkSimOverlay.querySelector("#bsim-tbody");
    const radiusAddBtn = bulkSimOverlay.querySelector("#bsim-radius-add");
    const radiusRowsEl = bulkSimOverlay.querySelector("#bsim-radius-rows");

    // ── RADIUS rows ──────────────────────────────────────────────────────────
    function addBsimRadiusRow(key = "", val = "") {
      const row = document.createElement("div");
      row.className = "radius-attr-row";
      row.innerHTML = `
        <input type="text" class="radius-attr-key" list="bsim-radius-attrs-list"
               placeholder="${t("browse.radius_attr_placeholder")}" value="${esc(key)}" />
        <input type="text" class="radius-attr-val" placeholder="${t("browse.radius_val_placeholder")}" value="${esc(val)}" />
        <button type="button" class="radius-row-remove secondary small" title="${t("browse.radius_remove_title")}">✕</button>
      `;
      row.querySelector(".radius-row-remove").addEventListener("click", () => row.remove());
      radiusRowsEl.appendChild(row);
    }

    function readBsimRadiusAttrs() {
      const attrs = {};
      radiusRowsEl.querySelectorAll(".radius-attr-row").forEach((row) => {
        const k = row.querySelector(".radius-attr-key")?.value.trim();
        const v = row.querySelector(".radius-attr-val")?.value.trim();
        if (k && v) attrs[k] = v;
      });
      return attrs;
    }

    radiusAddBtn.addEventListener("click", () => addBsimRadiusRow());

    // ── RADIUS templates (shared localStorage key med single-endpoint simulator) ──
    const TPL_KEY = "ise_radius_templates";
    function loadTpls() {
      try { return JSON.parse(localStorage.getItem(TPL_KEY) || "[]"); } catch { return []; }
    }
    function saveTpls(tpls) { localStorage.setItem(TPL_KEY, JSON.stringify(tpls)); }

    function renderBsimTplSelect() {
      const sel = bulkSimOverlay.querySelector("#bsim-radius-tpl-sel");
      if (!sel) return;
      const cur = sel.value;
      const tpls = loadTpls().sort((a, b) => a.name.localeCompare(b.name));
      sel.innerHTML = `<option value="">${t("browse.sim_tpl_none")}</option>`
        + tpls.map((tp) => `<option value="${esc(tp.id)}"${tp.id === cur ? " selected" : ""}>${esc(tp.name)}</option>`).join("");
    }

    bulkSimOverlay.querySelector("#bsim-radius-tpl-load").addEventListener("click", () => {
      const tplId = bulkSimOverlay.querySelector("#bsim-radius-tpl-sel")?.value;
      if (!tplId) return;
      const tpl = loadTpls().find((tp) => tp.id === tplId);
      if (!tpl) return;
      radiusRowsEl.innerHTML = "";
      for (const [k, v] of Object.entries(tpl.attrs || {})) addBsimRadiusRow(k, v);
    });

    bulkSimOverlay.querySelector("#bsim-radius-tpl-save").addEventListener("click", () => {
      const attrs = readBsimRadiusAttrs();
      if (!Object.keys(attrs).length) { alert(t("browse.radius_tpl_empty_alert")); return; }
      const name = prompt(t("browse.radius_tpl_name_prompt"));
      if (!name?.trim()) return;
      const tpls = loadTpls();
      tpls.push({ id: Date.now().toString(36), name: name.trim(), attrs });
      saveTpls(tpls);
      renderBsimTplSelect();
    });

    bulkSimOverlay.querySelector("#bsim-radius-tpl-del").addEventListener("click", () => {
      const tplId = bulkSimOverlay.querySelector("#bsim-radius-tpl-sel")?.value;
      if (!tplId) return;
      saveTpls(loadTpls().filter((tp) => tp.id !== tplId));
      renderBsimTplSelect();
    });

    let policySetsLoaded = false;

    async function loadPolicySets() {
      if (policySetsLoaded) return;
      try {
        const data = await api.listPolicySets();
        const sets = data.policy_sets || data || [];
        policySetSel.innerHTML = sets.length
          ? sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")
          : `<option value="">${t("browse.sim_no_policy_sets")}</option>`;
        policySetsLoaded = true;
      } catch (err) {
        policySetSel.innerHTML = `<option value="">Fejl: ${esc(err.message)}</option>`;
      }
    }

    bulkSimBtn.addEventListener("click", async () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      simCount.textContent = t("browse.sim_count").replace("{n}", ids.length);
      resultsDiv.style.display = "none";
      tbody2.innerHTML = "";
      summaryEl.textContent = "";
      runBtn.disabled = false;
      runBtn.textContent = t("browse.sim_run_btn");
      renderBsimTplSelect();
      bulkSimOverlay.classList.remove("hidden");
      await loadPolicySets();
    });

    cancelBtn.addEventListener("click", () => {
      bulkSimOverlay.classList.add("hidden");
    });

    runBtn.addEventListener("click", async () => {
      const setId = policySetSel.value;
      if (!setId) return;
      const ids = cb.getSelectedIds();
      if (!ids.length) { bulkSimOverlay.classList.add("hidden"); return; }

      runBtn.disabled = true;
      runBtn.textContent = t("browse.sim_running");
      resultsDiv.style.display = "none";

      try {
        const radiusAttrs = readBsimRadiusAttrs();
        const data = await api.batchSimulate(setId, ids, radiusAttrs);
        const results = data.results || [];

        tbody2.innerHTML = results.map((r) => {
          if (r.error) {
            return `<tr>
              <td><code class="lc-mac">${esc(r.mac || r.id)}</code></td>
              <td colspan="2" style="color:#dc2626;font-size:0.78rem;">${esc(r.error)}</td>
              <td><span class="bsim-badge bsim-err">${t("browse.sim_error")}</span></td>
            </tr>`;
          }
          const badge = r.matched
            ? `<span class="bsim-badge bsim-ok">${t("browse.sim_match")}</span>`
            : `<span class="bsim-badge bsim-fail">${t("browse.sim_no_match")}</span>`;
          const partial = r.partial_match
            ? `<span class="bsim-badge bsim-partial">${t("browse.sim_partial")}</span>` : "";
          return `<tr>
            <td><code class="lc-mac">${esc(r.mac || r.id)}</code></td>
            <td style="font-size:0.8rem;">${esc(r.matched_rule || "—")}</td>
            <td style="font-size:0.8rem;">${esc(r.matched_profile || "—")}</td>
            <td>${badge}${partial}</td>
          </tr>`;
        }).join("");

        summaryEl.textContent = t("browse.sim_summary")
          .replace("{matched}", data.matched_count)
          .replace("{unmatched}", data.unmatched_count)
          .replace("{errors}", data.error_count);
        resultsDiv.style.display = "";
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("browse.sim_batch_err").replace("{msg}", esc(err.message))}</div>`;
        bulkSimOverlay.classList.add("hidden");
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = t("browse.sim_run_btn");
      }
    });
  }

  // ── Bulk template-apply ───────────────────────────────────────────────────
  // ── Apply template (modal action button) ─────────────────────────────────
  if (beTplBtn && tplPickOverlay) {
    const tplSelect = tplPickOverlay.querySelector("#tpl-pick-select");
    const tplApply  = tplPickOverlay.querySelector("#tpl-pick-apply");
    const tplCancel = tplPickOverlay.querySelector("#tpl-pick-cancel");
    const tplCount  = tplPickOverlay.querySelector("#tpl-pick-count");

    beTplBtn.addEventListener("click", async () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      bulkEditOverlay.classList.add("hidden");
      tplCount.textContent = t("bulk.tpl_count").replace("{n}", ids.length);
      try {
        const resp = await api.listTemplates();
        const tpls = resp?.templates || [];
        tplSelect.innerHTML = `<option value="">${t("bulk.tpl_none")}</option>`
          + tpls.map((tpl) => `<option value="${esc(tpl.id)}">${esc(tpl.name)}${tpl.description ? ` — ${esc(tpl.description)}` : ""}</option>`).join("");
      } catch { tplSelect.innerHTML = `<option value="">${t("bulk.tpl_none")}</option>`; }
      tplPickOverlay.classList.remove("hidden");
    });

    tplCancel.addEventListener("click", () => tplPickOverlay.classList.add("hidden"));

    tplApply.addEventListener("click", async () => {
      const templateId = tplSelect.value;
      if (!templateId) return;
      const ids = cb.getSelectedIds();
      if (!ids.length) { tplPickOverlay.classList.add("hidden"); return; }
      tplApply.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("bulk.tpl_applying").replace("{n}", ids.length)}</div>`;
      tplPickOverlay.classList.add("hidden");
      try {
        const res = await api.bulkApplyTemplate(ids, templateId);
        const ok   = res?.ok_count ?? 0;
        const fail = (res?.results || []).filter((r) => !r.ok).length;
        const cls  = fail ? (ok ? "info" : "error") : "success";
        msg.innerHTML = `<div class="alert ${cls}">${t("bulk.tpl_result").replace("{ok}", ok).replace("{fail}", fail)}</div>`;
        if (ok) cb.load?.();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("bulk.tpl_err").replace("{msg}", esc(err.message))}</div>`;
      } finally {
        tplApply.disabled = false;
      }
    });
  }

  // ── Delete (modal action button) ─────────────────────────────────────────
  if (beDelBtn) {
    beDelBtn.addEventListener("click", async () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      const macs = ids.map((id) => {
        const tr = tbody.querySelector(`tr[data-id="${id}"]`);
        return tr ? tr.dataset.mac || tr.querySelector(".mac-cell")?.textContent : id;
      });
      if (!confirm(t("bulk.confirm_delete").replace("{n}", ids.length).replace("{macs}", macs.join("\n")))) return;
      bulkEditOverlay.classList.add("hidden");
      beDelBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("bulk.deleting")} ${ids.length} endpoints...</div>`;
      let ok = 0, fail = 0;
      for (const id of ids) {
        try {
          await api.deleteEndpoint(id);
          state.allRows     = state.allRows.filter((r) => r.id !== id);
          if (state.allRowsCache) state.allRowsCache = state.allRowsCache.filter((r) => r.id !== id);
          ok++;
        } catch { fail++; }
      }
      cb.applyFilter();
      const parts = [];
      if (ok)   parts.push(`${ok} ${t("bulk.deleted")}`);
      if (fail) parts.push(`${fail} ${t("bulk.failed")}`);
      msg.innerHTML = `<div class="alert ${fail ? "error" : "success"}">${parts.join(", ")}</div>`;
      beDelBtn.disabled = false;
    });
  }

  // ── Decommission (modal action button) ────────────────────────────────────
  if (beDecommBtn) {
    beDecommBtn.addEventListener("click", async () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      if (!confirm(t("bulk.confirm_decomm").replace("{n}", ids.length))) return;
      bulkEditOverlay.classList.add("hidden");
      beDecommBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("bulk.decomm_progress").replace("{n}", ids.length)}</div>`;
      try {
        const res = await api.bulkDecommission(ids);
        const ok   = res?.ok_count ?? 0;
        const fail = (res?.results || []).filter((r) => !r.ok).length;
        const cls  = fail ? (ok ? "info" : "error") : "success";
        msg.innerHTML = `<div class="alert ${cls}">${t("bulk.decomm_result").replace("{ok}", ok).replace("{fail}", fail)}</div>`;
        const okIds = new Set((res?.results || []).filter((r) => r.ok).map((r) => r.id));
        if (okIds.size) {
          state.allRows = state.allRows.map((r) => okIds.has(r.id) ? { ...r, status: "Decommissioned" } : r);
          if (state.allRowsCache) {
            state.allRowsCache = state.allRowsCache.map((r) => okIds.has(r.id) ? { ...r, status: "Decommissioned" } : r);
          }
          cb.applyFilter?.();
        }
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("bulk.decomm_err").replace("{msg}", esc(err.message))}</div>`;
      } finally {
        beDecommBtn.disabled = false;
      }
    });
  }

  // ── Undecommission / Reactivate (modal action button) ─────────────────────
  if (beUndecommBtn) {
    beUndecommBtn.addEventListener("click", async () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      if (!confirm(t("bulk.confirm_undecomm").replace("{n}", ids.length))) return;
      bulkEditOverlay.classList.add("hidden");
      beUndecommBtn.disabled = true;
      msg.innerHTML = `<div class="alert info">${t("bulk.undecomm_progress").replace("{n}", ids.length)}</div>`;
      try {
        const res = await api.bulkUndecommission(ids);
        const ok   = res?.ok_count ?? 0;
        const fail = (res?.results || []).filter((r) => !r.ok).length;
        const cls  = fail ? (ok ? "info" : "error") : "success";
        msg.innerHTML = `<div class="alert ${cls}">${t("bulk.undecomm_result").replace("{ok}", ok).replace("{fail}", fail)}</div>`;
        const okIds = new Set((res?.results || []).filter((r) => r.ok).map((r) => r.id));
        if (okIds.size) {
          state.allRows = state.allRows.map((r) => okIds.has(r.id) ? { ...r, status: "" } : r);
          if (state.allRowsCache) {
            state.allRowsCache = state.allRowsCache.map((r) => okIds.has(r.id) ? { ...r, status: "" } : r);
          }
          cb.applyFilter?.();
        }
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${t("bulk.undecomm_err").replace("{msg}", esc(err.message))}</div>`;
      } finally {
        beUndecommBtn.disabled = false;
      }
    });
  }

  // ── nmap scanning ─────────────────────────────────────────────────────────
  const bulkNmapBtn  = container.querySelector("#bulk-nmap-btn");
  const nmapOverlay  = container.querySelector("#nmap-overlay");
  if (bulkNmapBtn && nmapOverlay) {
    const ipLabel     = nmapOverlay.querySelector("#nmap-overlay-ip");
    const customRow   = nmapOverlay.querySelector("#nmap-ol-custom-row");
    const customInput = nmapOverlay.querySelector("#nmap-ol-custom-flags");
    const runBtn      = nmapOverlay.querySelector("#nmap-ol-run");
    const resultPre   = nmapOverlay.querySelector("#nmap-ol-result");
    const closeBtn    = nmapOverlay.querySelector("#nmap-ol-close");
    let selectedPreset = null;
    let scanIp = "";

    nmapOverlay.querySelectorAll(".nmap-ol-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        nmapOverlay.querySelectorAll(".nmap-ol-preset").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectedPreset = btn.dataset.preset;
        customRow.style.display = selectedPreset === "custom" ? "" : "none";
        runBtn.disabled = false;
      });
    });

    runBtn.addEventListener("click", async () => {
      const preset = selectedPreset === "custom" ? null : selectedPreset;
      const flags  = selectedPreset === "custom" ? (customInput.value.trim() || null) : null;
      runBtn.disabled = true;
      runBtn.textContent = "Scanner…";
      resultPre.style.display = "";
      resultPre.textContent = `Starter nmap mod ${scanIp}…`;
      try {
        const res = await api.nmapScan(scanIp, preset, flags);
        resultPre.textContent = `# ${res.cmd}  (${res.duration}s)\n\n${res.output}`;
      } catch (err) {
        resultPre.textContent = `Fejl: ${err.message}`;
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "Kør nmap scan";
      }
    });

    closeBtn.addEventListener("click", () => nmapOverlay.classList.add("hidden"));
    nmapOverlay.addEventListener("click", (e) => {
      if (e.target === nmapOverlay) nmapOverlay.classList.add("hidden");
    });

    bulkNmapBtn.addEventListener("click", () => {
      const ids = cb.getSelectedIds();
      if (!ids.length) return;
      // Find IP for det første valgte endpoint fra pxGrid session data
      const tr = tbody.querySelector(`tr[data-id="${CSS.escape(ids[0])}"]`);
      const mac = tr?.dataset.mac || "";
      const sess = mac && state.pxgridSessionData ? state.pxgridSessionData.get(mac) : null;
      scanIp = sess?.framed_ip || "";
      if (!scanIp) {
        msg.innerHTML = `<div class="alert warning">Ingen IP-adresse fundet — endpoint skal have en aktiv RADIUS-session med framed_ip.</div>`;
        setTimeout(() => { msg.innerHTML = ""; }, 5000);
        return;
      }
      // Reset modal
      selectedPreset = null;
      runBtn.disabled = true;
      runBtn.textContent = "Kør nmap scan";
      resultPre.style.display = "none";
      resultPre.textContent = "";
      customRow.style.display = "none";
      customInput.value = "";
      nmapOverlay.querySelectorAll(".nmap-ol-preset").forEach((b) => b.classList.remove("active"));
      ipLabel.textContent = scanIp;
      nmapOverlay.classList.remove("hidden");
    });

    // Vis/skjul nmap-knap baseret på session-data tilgængelighed
    cb.updateNmapBtn = () => {
      const ids = cb.getSelectedIds();
      if (!ids.length || ids.length > 1) { bulkNmapBtn.disabled = true; return; }
      const tr  = tbody.querySelector(`tr[data-id="${CSS.escape(ids[0])}"]`);
      const mac = tr?.dataset.mac || "";
      const hasIp = mac && state.pxgridSessionData
        ? !!(state.pxgridSessionData.get(mac)?.framed_ip)
        : false;
      bulkNmapBtn.disabled = !hasIp;
    };
  }
}
