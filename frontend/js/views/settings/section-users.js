// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../../api.js";
import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initUsersSection(container, currentUser, rolesState) {
  const tbody = container.querySelector("#users-tbody");
  const msg = container.querySelector("#users-msg");
  let _isTacacs = false;

  // Set static element texts
  const usersColRoleLbl = container.querySelector("#users-col-role");
  if (usersColRoleLbl) usersColRoleLbl.textContent = t("settings.users_col_role");
  const usersColTypeLbl = container.querySelector("#users-col-type");
  if (usersColTypeLbl) usersColTypeLbl.textContent = t("settings.users_col_type");
  const usersColRolesLbl = container.querySelector("#users-col-roles");
  if (usersColRolesLbl) usersColRolesLbl.textContent = t("col.roles");
  const usersColTemplatesLbl = container.querySelector("#users-col-templates");
  if (usersColTemplatesLbl) usersColTemplatesLbl.textContent = t("settings.subtab_templates");
  const usersColLastLoginLbl = container.querySelector("#users-col-last-login");
  if (usersColLastLoginLbl) usersColLastLoginLbl.textContent = t("settings.users_col_last_login");
  const usersColCreatedLbl = container.querySelector("#users-col-created");
  if (usersColCreatedLbl) usersColCreatedLbl.textContent = t("settings.users_col_created");
  const usersColActionsLbl = container.querySelector("#users-col-actions");
  if (usersColActionsLbl) usersColActionsLbl.textContent = t("settings.users_col_actions");
  const usersNameInput = container.querySelector("#new-username");
  if (usersNameInput) usersNameInput.placeholder = t("settings.users_name_ph");
  const usersPwInput = container.querySelector("#new-password");
  if (usersPwInput) usersPwInput.placeholder = t("settings.users_pw_ph");
  const usersBtnCreate = container.querySelector("#users-btn-create");
  if (usersBtnCreate) usersBtnCreate.textContent = t("settings.users_btn_create");
  // Role option texts
  const newRoleEditorPsk = container.querySelector("#new-role-editor-psk");
  if (newRoleEditorPsk) newRoleEditorPsk.textContent = `editor-psk (PSK-${t("btn.edit").toLowerCase()})`;
  const newRoleRegistrant = container.querySelector("#new-role-registrant");
  if (newRoleRegistrant) newRoleRegistrant.textContent = `registrant (${t("settings.users_type_user").toLowerCase()} — ${t("btn.create").toLowerCase()})`;
  const newRoleRegistrantTpl = container.querySelector("#new-role-registrant-tpl");
  if (newRoleRegistrantTpl) newRoleRegistrantTpl.textContent = `registrant_templet (${t("settings.subtab_templates").toLowerCase()} + MAC)`;

  // Hent auth-mode og opdater kosmetiske labels
  try {
    const authCfg = await api.getPortalAuthConfig();
    _isTacacs = authCfg.auth_mode === "tacacs";
    const titleEl = container.querySelector("#users-section-title");
    const hintEl = container.querySelector("#users-section-hint");
    const tacacsHintEl = container.querySelector("#users-tacacs-hint");
    const colHeader = container.querySelector("#users-col-username");
    const pwInput = container.querySelector("#new-password");
    if (hintEl) hintEl.textContent = t("settings.users_section_hint");
    if (tacacsHintEl) tacacsHintEl.textContent = t("settings.users_tacacs_hint");
    if (_isTacacs) {
      if (titleEl) titleEl.innerHTML = `${t("settings.subtab_users")} — <span style='font-size:0.85em;font-weight:normal;color:var(--text-muted);'>${t("settings.users_type_operator")} mode (TACACS+)</span>`;
      if (tacacsHintEl) tacacsHintEl.style.display = "";
      if (colHeader) colHeader.textContent = t("settings.users_op_col");
      if (pwInput) {
        pwInput.required = false;
        pwInput.placeholder = t("settings.users_tacacs_pw_ph");
        pwInput.removeAttribute("minlength");
      }
    } else {
      if (titleEl) titleEl.textContent = t("settings.subtab_users");
      if (colHeader) colHeader.textContent = t("settings.users_col_username");
    }
  } catch { /* non-critical */ }

  let allTemplates = [];

  function renderEndpointRoleCell(user) {
    const catalog = (rolesState ? rolesState.roles : []).filter((r) => r.name.toLowerCase() !== "admin");
    const assigned = new Set(user.assigned_endpoint_roles || []);
    if (catalog.length === 0) {
      return `<span class="hint">${t("settings.users_no_roles")}</span>`;
    }
    const checks = catalog
      .map((r) => {
        const checked = assigned.has(r.name) ? " checked" : "";
        const isOwn = r.name.toLowerCase() === user.username.toLowerCase();
        return `<label class="role-chip${isOwn ? " own-role-chip" : ""}"><input type="checkbox" class="user-role-chip" value="${esc(r.name)}"${checked}/> ${esc(r.name)}</label>`;
      })
      .join("");
    return `<div class="role-chips">${checks}</div>`;
  }

  function visibleTemplatesForRole(role) {
    if (role === "admin") return null; // null = alle
    return allTemplates.filter((t) => {
      const vt = t.visible_to || [];
      return vt.length === 0 || vt.includes(role);
    });
  }

  function renderTemplateCell(user) {
    // viewer kan ikke oprette endpoints — skabeloner ikke relevante
    if (user.role === "viewer") return `<span style="color:var(--text-secondary,#94a3b8);">—</span>`;

    if (!allTemplates.length) return `<span class="hint" style="color:var(--text-secondary,#94a3b8);">${t("settings.users_no_tpls")}</span>`;

    if (user.role === "admin") {
      return `<span class="hint" style="font-style:italic;">${t("settings.users_all_tpls").replace("{n}", allTemplates.length)}</span>`;
    }

    if (user.role === "registrant_templet") {
      // Redigerbare checkboxes — admin tildeler eksplicit
      const assigned = new Set(user.assigned_templates || []);
      const checks = allTemplates
        .map((t) => {
          const checked = assigned.has(t.id) ? " checked" : "";
          return `<label class="role-chip"><input type="checkbox" class="user-tpl-chip" value="${esc(t.id)}"${checked}/> ${esc(t.name)}</label>`;
        })
        .join("");
      return `<div class="role-chips">${checks}</div>`;
    }

    // Alle andre roller: vis hvilke skabeloner de kan se via visible_to
    const visible = visibleTemplatesForRole(user.role);
    if (!visible.length) {
      return `<span class="hint" style="color:var(--text-secondary,#94a3b8);">${t("settings.users_no_access")}</span>`;
    }
    const tags = visible
      .map((t) => `<span class="role-chip" style="background:var(--bg-secondary,#f1f5f9);border:1px solid var(--border,#e2e8f0);padding:1px 7px;border-radius:4px;font-size:0.78rem;">${esc(t.name)}</span>`)
      .join("");
    return `<div style="display:flex;flex-wrap:wrap;gap:0.25rem;">${tags}</div>`;
  }

  async function reload() {
    msg.innerHTML = "";
    try {
      const tplResp = await api.listTemplates().catch(() => ({ templates: [] }));
      allTemplates = tplResp.templates || [];
    } catch { /* ignorer */ }
    try {
      const users = await api.listUsers();
      tbody.innerHTML = users
        .map((u) => {
          const isSelf = u.id === currentUser.id;
          const isPortalAdmin = u.role === "admin";
          const adminCell = `<span class="hint" style="font-style:italic;">${t("settings.users_admin_roles")}</span>`;
          const isOperator = u.user_type === "operator";
          return `
            <tr data-user-id="${esc(u.id)}" data-username="${esc(u.username)}">
              <td>${esc(u.username)}</td>
              <td>
                <select class="user-role-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen rolle her'" : ""}>
                  ${["admin", "editor", "editor-psk", "viewer", "registrant", "registrant_templet"]
                    .map((r) => `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`)
                    .join("")}
                </select>
              </td>
              <td>
                <select class="user-type-select" ${isSelf ? "disabled title='Du kan ikke ændre din egen type her'" : ""}>
                  <option value="user"${!isOperator ? " selected" : ""}>${t("settings.users_type_user")}</option>
                  <option value="operator"${isOperator ? " selected" : ""}>${t("settings.users_type_operator")}</option>
                </select>
              </td>
              <td>${isPortalAdmin ? adminCell : renderEndpointRoleCell(u)}</td>
              <td>${renderTemplateCell(u)}</td>
              <td class="mono" style="font-size:0.78rem;">${esc(u.last_login || "—")}</td>
              <td class="mono" style="font-size:0.78rem;">${esc((u.created_at || "").slice(0, 10))}</td>
              <td>
                <button class="small user-copy">${t("settings.users_btn_copy")}</button>
                <button class="small user-reset-pw" ${isSelf ? "disabled" : ""}>${t("settings.users_btn_reset_pw")}</button>
                <button class="small danger user-del" ${isSelf ? "disabled" : ""}>${t("btn.delete")}</button>
              </td>
            </tr>`;
        })
        .join("");
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("settings.users_load_err").replace("{msg}", esc(err.message))}</div>`;
    }
  }

  // Sub som kan kaldes når rolle-kataloget ændrer sig så user-cellerne følger med.
  if (rolesState) rolesState.onChange = reload;

  tbody.addEventListener("change", async (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.userId;
    if (e.target.classList.contains("user-role-select")) {
      try {
        await api.updateUser(id, { role: e.target.value });
        msg.innerHTML = `<div class="alert success">${t("settings.users_role_updated")}</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-type-select")) {
      const newType = e.target.value;
      const label = newType === "operator" ? t("settings.users_type_operator") : t("settings.users_type_user");
      try {
        await api.updateUser(id, { user_type: newType });
        msg.innerHTML = `<div class="alert success">${t("settings.users_type_updated").replace("{user}", esc(row.dataset.username)).replace("{type}", `<strong>${label}</strong>`)}</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-role-chip")) {
      const checks = row.querySelectorAll(".user-role-chip");
      const selected = Array.from(checks).filter((c) => c.checked).map((c) => c.value);
      try {
        await api.setUserEndpointRoles(id, selected);
        msg.innerHTML = `<div class="alert success">${t("settings.users_roles_updated").replace("{user}", esc(row.dataset.username))}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
      return;
    }
    if (e.target.classList.contains("user-tpl-chip")) {
      const checks = row.querySelectorAll(".user-tpl-chip");
      const selected = Array.from(checks).filter((c) => c.checked).map((c) => c.value);
      try {
        await api.setUserTemplates(id, selected);
        msg.innerHTML = `<div class="alert success">${t("settings.users_tpls_updated").replace("{user}", esc(row.dataset.username))}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
        await reload();
      }
    }
  });

  tbody.addEventListener("click", async (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.userId;
    const username = row.querySelector("td").textContent;
    if (e.target.classList.contains("user-del")) {
      if (!confirm(t("settings.users_del_confirm").replace("{user}", username))) return;
      try {
        await api.deleteUser(id);
        msg.innerHTML = `<div class="alert success">${t("settings.users_deleted")}</div>`;
        await reload();
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    }
    if (e.target.classList.contains("user-reset-pw")) {
      const pw = prompt(t("settings.users_pw_prompt").replace("{user}", username));
      if (!pw) return;
      if (pw.length < 8) {
        msg.innerHTML = `<div class="alert error">${t("settings.users_pw_min8")}</div>`;
        return;
      }
      try {
        await api.updateUser(id, { password: pw });
        msg.innerHTML = `<div class="alert success">${t("settings.users_pw_updated").replace("{user}", esc(username))}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    }

    if (e.target.classList.contains("user-copy")) {
      // Fjern evt. eksisterende copy-række
      tbody.querySelector(".user-copy-row")?.remove();

      const users = await api.listUsers().catch(() => []);
      const srcUser = users.find((u) => u.id === id);
      if (!srcUser) return;

      const suggestedName = srcUser.username.replace(/_copy(\d*)$/, "") + "_copy";
      const pwRequired = !_isTacacs;
      const pwHint = _isTacacs ? t("settings.users_tacacs_pw_ph") : t("settings.users_pw_ph");

      const copyRow = document.createElement("tr");
      copyRow.className = "user-copy-row";
      copyRow.innerHTML = `
        <td colspan="7" style="padding:0.6rem 0.75rem;background:var(--bg-alt,#f8fafc);border-left:3px solid var(--accent,#3b82f6);border-top:1px dashed #e5e7eb;">
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
            <span style="font-size:0.82rem;color:var(--text-secondary,#64748b);white-space:nowrap;">
              ${t("settings.users_copy_of").replace("{user}", `<strong>${esc(srcUser.username)}</strong>`).replace("{role}", esc(srcUser.role))}
            </span>
            <input type="text" class="copy-username" value="${esc(suggestedName)}"
              placeholder="nyt brugernavn" minlength="3" maxlength="64"
              style="width:16rem;" />
            <input type="password" class="copy-password"
              placeholder="password (${pwHint})"
              ${pwRequired ? 'minlength="8"' : ""}
              style="width:16rem;" />
            <button type="button" class="copy-confirm">${t("settings.users_copy_btn")}</button>
            <button type="button" class="copy-cancel secondary">${t("btn.cancel")}</button>
            <span class="copy-msg" style="font-size:0.82rem;"></span>
          </div>
        </td>`;

      row.after(copyRow);
      copyRow.querySelector(".copy-username").focus();

      copyRow.querySelector(".copy-cancel").addEventListener("click", () => copyRow.remove());

      copyRow.querySelector(".copy-confirm").addEventListener("click", async () => {
        const copyMsg = copyRow.querySelector(".copy-msg");
        const newUsername = copyRow.querySelector(".copy-username").value.trim();
        const newPassword = copyRow.querySelector(".copy-password").value;

        if (!newUsername || newUsername.length < 3) {
          copyMsg.innerHTML = `<span style="color:var(--error,#ef4444);">${t("settings.users_copy_min3")}</span>`;
          return;
        }
        if (pwRequired && newPassword.length < 8) {
          copyMsg.innerHTML = `<span style="color:var(--error,#ef4444);">${t("settings.users_pw_min8")}</span>`;
          return;
        }

        copyMsg.textContent = t("settings.users_creating");
        try {
          const created = await api.createUser({
            username: newUsername,
            password: newPassword,
            role: srcUser.role,
          });
          // Kopiér endpoint-roller og skabeloner
          if (srcUser.assigned_endpoint_roles?.length) {
            await api.setUserEndpointRoles(created.id, srcUser.assigned_endpoint_roles).catch(() => {});
          }
          if (srcUser.assigned_templates?.length) {
            await api.setUserTemplates(created.id, srcUser.assigned_templates).catch(() => {});
          }
          copyRow.remove();
          msg.innerHTML = `<div class="alert success">${t("settings.users_copy_done").replace("{user}", `<strong>${esc(newUsername)}</strong>`).replace("{role}", esc(srcUser.role))}</div>`;
          if (rolesState && typeof rolesState.reload === "function") await rolesState.reload();
          await reload();
        } catch (err) {
          copyMsg.innerHTML = `<span style="color:var(--error,#ef4444);">${esc(err.message)}</span>`;
        }
      });
    }
  });

  container.querySelector("#user-create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      username: container.querySelector("#new-username").value.trim(),
      password: container.querySelector("#new-password").value,
      role: container.querySelector("#new-role").value,
    };
    try {
      await api.createUser(payload);
      container.querySelector("#new-username").value = "";
      container.querySelector("#new-password").value = "";
      msg.innerHTML = `<div class="alert success">${t("settings.users_created")}</div>`;
      // 3.8.2: backend opretter automatisk en System adm-rolle med navn =
      // username (3.8.0-feature). Refresh rolle-kataloget så admin straks
      // kan tilvælge rollen til den nye bruger uden side-reload.
      if (rolesState && typeof rolesState.reload === "function") {
        await rolesState.reload();
      }
      await reload();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });

  await reload();
}
