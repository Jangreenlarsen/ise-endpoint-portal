// Bulk-edit modal, bulk-delete, and bulk-disconnect for Browse.
// initBulk wires all bulk-action event handlers (no public API returned).

import { t } from "../i18n.js";
import { esc, optionsHtml } from "./browse-utils.js";

export function initBulk(container, state, api, cb) {
  const tbody          = container.querySelector("#tbody");
  const msg            = container.querySelector("#msg");
  const bulkEditBtn    = container.querySelector("#bulk-edit-btn");
  const bulkEditOverlay = container.querySelector("#bulk-edit-overlay");
  const bulkDelBtn     = container.querySelector("#bulk-del-btn");
  const bulkDisconnBtn = container.querySelector("#bulk-disconnect-btn");

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
      msg.innerHTML = `<div class="alert error">Kunne ikke generere PSK: ${esc(err.message)}</div>`;
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
      if (field === "static-group") { fields["static-group"] = bulkEditOverlay.querySelector("#be-static-group-cb").checked; return; }
      if (field === "psk-mode")     { fields["psk-mode"]     = bulkEditOverlay.querySelector("#be-psk-mode-cb").checked;    return; }
      if (field === "psk-key")      { fields["psk-key"]      = bulkEditOverlay.querySelector("#be-psk-key-inp").value;      return; }
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
      cb.markDirty(tr);
    }
    bulkEditOverlay.classList.add("hidden");
    msg.innerHTML = `<div class="alert info">${ids.length} ${t("bulk.updated_local")}</div>`;
  });

  // ── Bulk delete ───────────────────────────────────────────────────────────
  bulkDelBtn.addEventListener("click", async () => {
    const ids = cb.getSelectedIds();
    if (!ids.length) return;
    const macs = ids.map((id) => {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      return tr ? tr.querySelector(".mac-cell").textContent : id;
    });
    if (!confirm(t("bulk.confirm_delete").replace("{n}", ids.length).replace("{macs}", macs.join("\n")))) return;
    bulkDelBtn.disabled = true;
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
    bulkDelBtn.disabled = false;
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
    msg.innerHTML = `<div class="alert info">CoA Disconnect → ${ids.length}...</div>`;
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
}
