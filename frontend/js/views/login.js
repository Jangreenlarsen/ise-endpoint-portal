import { api } from "../api.js";
import { auth } from "../auth.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function renderLogin(onSuccess) {
  document.body.classList.add("auth-mode");
  const root = document.getElementById("view-container");
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.style.display = "none";

  let status;
  try {
    status = await api.authStatus();
  } catch (err) {
    root.innerHTML = `<div class="login-wrap"><div class="alert error">Kan ikke kontakte backend: ${esc(err.message)}</div></div>`;
    return;
  }

  const isSetup = !!status.setup_required;
  const title = isSetup ? "Første-gangs opsætning" : "Log ind";
  const submitLabel = isSetup ? "Opret admin & log ind" : "Log ind";
  const hint = isSetup
    ? `<p class="hint">Der er ingen brugere endnu. Opret en administrator for at komme i gang.</p>`
    : "";

  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h2>${esc(title)}</h2>
        ${hint}
        <form id="login-form">
          <label for="login-username">Brugernavn</label>
          <input type="text" id="login-username" autocomplete="username" required minlength="3" />
          <label for="login-password">Password</label>
          <input type="password" id="login-password" autocomplete="${isSetup ? "new-password" : "current-password"}" required minlength="${isSetup ? 8 : 1}" />
          ${isSetup ? `
            <label for="login-password2">Bekræft password</label>
            <input type="password" id="login-password2" autocomplete="new-password" required minlength="8" />
          ` : ""}
          <button type="submit" id="login-submit">${esc(submitLabel)}</button>
          <div id="login-msg"></div>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector("#login-form");
  const msg = root.querySelector("#login-msg");
  const submit = root.querySelector("#login-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const username = root.querySelector("#login-username").value.trim();
    const password = root.querySelector("#login-password").value;
    if (isSetup) {
      const pw2 = root.querySelector("#login-password2").value;
      if (password !== pw2) {
        msg.innerHTML = `<div class="alert error">Passwords matcher ikke</div>`;
        return;
      }
    }
    submit.disabled = true;
    try {
      const result = isSetup
        ? await api.setupAdmin(username, password)
        : await api.login(username, password);
      auth.save(result.token, result.user);
      document.body.classList.remove("auth-mode");
      if (sidebar) sidebar.style.display = "";
      onSuccess(result.user);
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      submit.disabled = false;
    }
  });

  root.querySelector("#login-username").focus();
}
