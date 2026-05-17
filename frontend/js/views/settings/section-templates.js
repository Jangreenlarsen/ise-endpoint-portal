// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";
import { groupHierarchyOptionsHtml } from "../browse-utils.js";

export async function initTemplatesSection(container) {
  const msg        = container.querySelector("#tpl-msg");
  const listDiv    = container.querySelector("#tpl-list");
  const formWrap   = container.querySelector("#tpl-form-wrap");
  const formTitle  = container.querySelector("#tpl-form-title");
  const editIdInp  = container.querySelector("#tpl-edit-id");
  const nameInp    = container.querySelector("#tpl-name");
  const descFieldInp = container.querySelector("#tpl-desc-field");
  const groupSel   = container.querySelector("#tpl-group");
  const epDescInp  = container.querySelector("#tpl-ep-desc");
  const attrsWrap  = container.querySelector("#tpl-attrs-wrap");
  const staticCb   = container.querySelector("#tpl-static-group");
  const newBtn     = container.querySelector("#tpl-new-btn");
  const saveBtn    = container.querySelector("#tpl-save-btn");
  const cancelBtn  = container.querySelector("#tpl-cancel-btn");

  const attrLabels = {
    Type: "Type", Owner: t("settings.tpl_owner"), Lokation: t("settings.tpl_lokation"),
    AuthzVlan: "Authz VLAN", AuthzACL: "Authz ACL", PlatformType: "Platform",
  };

  // Set element texts
  const tplCardH3 = container.querySelector("#tpl-card-h3");
  if (tplCardH3) tplCardH3.textContent = t("settings.tpl_card");
  const tplNewBtn = container.querySelector("#tpl-new-btn");
  if (tplNewBtn) tplNewBtn.textContent = t("settings.tpl_btn_new");
  const tplNameLbl = container.querySelector("#tpl-name-lbl");
  if (tplNameLbl) tplNameLbl.textContent = t("settings.tpl_name_lbl");
  const tplDescLbl = container.querySelector("#tpl-desc-lbl");
  if (tplDescLbl) tplDescLbl.textContent = t("settings.tpl_desc_lbl");
  const tplGroupLbl = container.querySelector("#tpl-group-lbl");
  if (tplGroupLbl) tplGroupLbl.textContent = t("settings.tpl_group_lbl");
  const tplGroupNoneOpt = container.querySelector("#tpl-group-none-opt");
  if (tplGroupNoneOpt) tplGroupNoneOpt.textContent = t("settings.tpl_group_none");
  const tplEpDescLbl = container.querySelector("#tpl-ep-desc-lbl");
  if (tplEpDescLbl) tplEpDescLbl.textContent = t("settings.tpl_ep_desc_lbl");
  const tplVisibleLbl = container.querySelector("#tpl-visible-lbl");
  if (tplVisibleLbl) tplVisibleLbl.textContent = t("settings.tpl_visible_lbl");
  const tplSaveBtn = container.querySelector("#tpl-save-btn");
  if (tplSaveBtn) tplSaveBtn.textContent = t("settings.tpl_btn_save");
  const tplCancelBtn = container.querySelector("#tpl-cancel-btn");
  if (tplCancelBtn) tplCancelBtn.textContent = t("settings.tpl_btn_cancel");

  // Hent grupper + custom-attr-værdier til form-dropdowns
  let groups = [];
  let attrMap = {};
  try {
    const [groupsResp, caResp, daclsResp] = await Promise.all([
      api.listGroups().catch(() => []),
      api.listCustomAttributes().catch(() => ({ attributes: [] })),
      api.listDacls().catch(() => []),
    ]);
    groups = groupsResp || [];
    for (const a of (caResp.attributes || [])) attrMap[a.name] = a.values || [];
    attrMap.AuthzACL = (daclsResp || []).map((d) => d.name).filter(Boolean).sort();
  } catch { /* ignorer */ }

  groupSel.innerHTML = groupHierarchyOptionsHtml(groups, "", t("settings.tpl_group_none"));

  attrsWrap.innerHTML = Object.entries(attrLabels).map(([name, label]) => {
    const opts = (attrMap[name] || [])
      .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    return `
      <div class="field">
        <label for="tpl-ca-${name}">${label}</label>
        <select id="tpl-ca-${name}" style="max-width:320px;">
          <option value="">${t("settings.tpl_attr_select")}</option>${opts}
        </select>
      </div>`;
  }).join("");

  function showMsg(html) { msg.innerHTML = html; }
  function clearMsg() { msg.innerHTML = ""; }

  function getVisibleToCheckboxes() {
    return container.querySelectorAll(".tpl-visible-to");
  }

  function resetForm() {
    editIdInp.value = "";
    nameInp.value = "";
    descFieldInp.value = "";
    groupSel.value = "";
    epDescInp.value = "";
    staticCb.checked = false;
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#tpl-ca-${name}`);
      if (sel) sel.value = "";
    }
    getVisibleToCheckboxes().forEach((cb) => { cb.checked = false; });
    formWrap.classList.add("hidden");
    formTitle.textContent = t("settings.tpl_form_new");
  }

  function fillForm(tpl) {
    editIdInp.value = tpl.id;
    nameInp.value = tpl.name;
    descFieldInp.value = tpl.description || "";
    const f = tpl.fields || {};
    groupSel.value = f.group_id || "";
    epDescInp.value = f.description || "";
    staticCb.checked = !!f.static_group_assignment;
    const ca = f.custom_attributes || {};
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#tpl-ca-${name}`);
      if (sel) sel.value = ca[name] || "";
    }
    const visibleTo = tpl.visible_to || [];
    getVisibleToCheckboxes().forEach((cb) => {
      cb.checked = visibleTo.includes(cb.value);
    });
    formTitle.textContent = t("settings.tpl_form_edit").replace("{name}", esc(tpl.name));
    formWrap.classList.remove("hidden");
    nameInp.focus();
  }

  function buildPayload() {
    const ca = {};
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#tpl-ca-${name}`);
      const v = sel ? sel.value.trim() : "";
      if (v) ca[name] = v;
    }
    const visibleTo = Array.from(getVisibleToCheckboxes())
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    return {
      name: nameInp.value.trim(),
      description: descFieldInp.value.trim(),
      fields: {
        group_id: groupSel.value,
        description: epDescInp.value.trim(),
        static_group_assignment: staticCb.checked || null,
        custom_attributes: ca,
      },
      visible_to: visibleTo,
    };
  }

  async function loadAndRender() {
    try {
      const resp = await api.listTemplates();
      const templates = resp.templates || [];
      if (!templates.length) {
        listDiv.innerHTML = `<p class="hint">${t("settings.tpl_empty")}</p>`;
        return;
      }
      listDiv.innerHTML = `
        <table class="data-table" style="width:100%;">
          <thead><tr>
            <th>${t("settings.tpl_col_name")}</th><th>${t("settings.tpl_col_desc")}</th><th>${t("settings.tpl_col_group")}</th><th>${t("settings.tpl_col_attrs")}</th><th>${t("settings.tpl_col_visible")}</th><th></th>
          </tr></thead>
          <tbody>
          ${templates.map((tpl) => {
            const f = tpl.fields || {};
            const ca = f.custom_attributes || {};
            const caStr = Object.entries(ca).filter(([,v]) => v)
              .map(([k,v]) => `${k}=${v}`).join(", ") || "—";
            const grpName = groups.find((g) => g.id === f.group_id)?.name || f.group_id || "—";
            const vt = (tpl.visible_to || []);
            const vtStr = vt.length ? vt.join(", ") : t("settings.tpl_all_visible");
            return `<tr data-tpl-id="${esc(tpl.id)}">
              <td><b>${esc(tpl.name)}</b></td>
              <td>${esc(tpl.description || "—")}</td>
              <td>${esc(grpName)}</td>
              <td style="font-size:0.82rem;color:var(--text-secondary,#64748b);">${esc(caStr)}</td>
              <td style="font-size:0.82rem;color:var(--text-secondary,#64748b);">${esc(vtStr)}</td>
              <td style="white-space:nowrap;">
                <button type="button" class="secondary tpl-edit-btn" data-id="${esc(tpl.id)}" style="padding:2px 10px;margin-right:4px;">${t("settings.tpl_btn_edit")}</button>
                <button type="button" class="danger tpl-del-btn" data-id="${esc(tpl.id)}" style="padding:2px 10px;">${t("settings.tpl_btn_del")}</button>
              </td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>`;

      listDiv.querySelectorAll(".tpl-edit-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tplItem = templates.find((tpl) => tpl.id === btn.dataset.id);
          if (tplItem) fillForm(tplItem);
          formWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
      listDiv.querySelectorAll(".tpl-del-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tplItem = templates.find((tpl) => tpl.id === btn.dataset.id);
          if (!tplItem) return;
          if (!confirm(t("settings.tpl_del_confirm").replace("{name}", tplItem.name))) return;
          try {
            await api.deleteTemplate(tplItem.id);
            showMsg(`<div class="alert success">${t("settings.tpl_deleted").replace("{name}", esc(tplItem.name))}</div>`);
            resetForm();
            await loadAndRender();
          } catch (err) {
            showMsg(`<div class="alert error">${t("settings.tpl_err").replace("{msg}", esc(err.message))}</div>`);
          }
        });
      });
    } catch (err) {
      listDiv.innerHTML = `<p class="hint" style="color:#e11d48;">${t("settings.tpl_load_err").replace("{msg}", esc(err.message))}</p>`;
    }
  }

  newBtn.addEventListener("click", () => {
    resetForm();
    formWrap.classList.remove("hidden");
    formTitle.textContent = t("settings.tpl_form_new");
    nameInp.focus();
  });
  cancelBtn.addEventListener("click", resetForm);

  saveBtn.addEventListener("click", async () => {
    clearMsg();
    const payload = buildPayload();
    if (!payload.name) {
      showMsg(`<div class="alert error">${t("settings.tpl_name_required")}</div>`);
      nameInp.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const id = editIdInp.value;
      if (id) {
        await api.updateTemplate(id, payload);
        showMsg(`<div class="alert success">${t("settings.tpl_updated").replace("{name}", esc(payload.name))}</div>`);
      } else {
        await api.createTemplate(payload);
        showMsg(`<div class="alert success">${t("settings.tpl_created").replace("{name}", esc(payload.name))}</div>`);
      }
      resetForm();
      await loadAndRender();
    } catch (err) {
      showMsg(`<div class="alert error">${t("settings.tpl_err").replace("{msg}", esc(err.message))}</div>`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  await loadAndRender();
}
