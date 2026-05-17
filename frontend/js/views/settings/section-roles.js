// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initRolesSection(container) {
  const tbody = container.querySelector("#roles-tbody");
  const msg = container.querySelector("#roles-msg");
  const form = container.querySelector("#role-create-form");
  const state = { roles: [], onChange: null, reload: null };

  // Set element texts
  const rolesCardH3 = container.querySelector("#roles-card-h3");
  if (rolesCardH3) rolesCardH3.textContent = t("settings.roles_card");
  const rolesColName = container.querySelector("#roles-col-name");
  if (rolesColName) rolesColName.textContent = t("settings.roles_col_name");
  const rolesColDesc = container.querySelector("#roles-col-desc");
  if (rolesColDesc) rolesColDesc.textContent = t("settings.roles_col_desc");
  const rolesColCreatedBy = container.querySelector("#roles-col-created-by");
  if (rolesColCreatedBy) rolesColCreatedBy.textContent = t("settings.roles_col_created_by");
  const rolesColCreated = container.querySelector("#roles-col-created");
  if (rolesColCreated) rolesColCreated.textContent = t("settings.roles_col_created");
  const rolesColAction = container.querySelector("#roles-col-action");
  if (rolesColAction) rolesColAction.textContent = t("settings.roles_col_action");
  const rolesNameInput = container.querySelector("#new-role-name");
  if (rolesNameInput) rolesNameInput.placeholder = t("settings.roles_name_ph");
  const rolesDescInput = container.querySelector("#new-role-desc");
  if (rolesDescInput) rolesDescInput.placeholder = t("settings.roles_desc_ph");
  const rolesBtnCreate = container.querySelector("#roles-btn-create");
  if (rolesBtnCreate) rolesBtnCreate.textContent = t("settings.roles_btn_create");

  async function reload() {
    msg.innerHTML = "";
    try {
      const data = await api.listEndpointRoles();
      state.roles = data.roles || [];
      if (state.roles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="hint" style="text-align:center;padding:1rem;">${t("settings.roles_empty")}</td></tr>`;
      } else {
        tbody.innerHTML = state.roles
          .map(
            (r) => `
              <tr data-role-name="${esc(r.name)}">
                <td><b>${esc(r.name)}</b></td>
                <td>${esc(r.description || "")}</td>
                <td class="mono" style="font-size:0.78rem;">${esc(r.created_by || "")}</td>
                <td class="mono" style="font-size:0.78rem;">${esc((r.created_at || "").slice(0, 10))}</td>
                <td><button class="small danger role-del">${t("btn.delete")}</button></td>
              </tr>`,
          )
          .join("");
      }
      if (state.onChange) await state.onChange();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.roles_load_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  tbody.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("role-del")) return;
    const row = e.target.closest("tr");
    const name = row.dataset.roleName;
    if (!confirm(t("settings.roles_del_confirm").replace("{name}", name))) return;
    try {
      await api.deleteEndpointRole(name);
      msg.innerHTML = `<div class="alert success">${t("settings.roles_deleted").replace("{name}", esc(name))}</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = container.querySelector("#new-role-name");
    const descInput = container.querySelector("#new-role-desc");
    const payload = {
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
    };
    try {
      await api.createEndpointRole(payload);
      nameInput.value = "";
      descInput.value = "";
      msg.innerHTML = `<div class="alert success">${t("settings.roles_created")}</div>`;
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  // load error message
  // Note: roles_load_err handled in reload() catch block
  await reload();
  state.reload = reload;
  return state;
}
