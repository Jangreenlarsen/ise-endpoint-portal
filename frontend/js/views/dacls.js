// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import { api } from "../api.js";
import { t } from "../i18n.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const DACL_TYPES = [
  { value: "IPV4",        label: "IPv4" },
  { value: "IPV6",        label: "IPv6" },
  { value: "IP_AGNOSTIC", label: "IP agnostic" },
];

const EMPTY_DACL = {
  id: "",
  name: "",
  description: "",
  dacl: "permit ip any any\n",
  dacl_type: "IPV4",
};

export async function renderDacls(container) {
  container.innerHTML = `
    <h2>${t("dacl.title")}</h2>
    <p class="hint">${t("dacl.hint")}</p>
    <div class="dacl-layout">
      <aside class="dacl-list-pane">
        <div class="dacl-list-toolbar">
          <button id="dacl-new-btn">${t("dacl.btn_new")}</button>
          <button id="dacl-refresh-btn" class="secondary small">${t("dacl.btn_refresh")}</button>
        </div>
        <input type="search" id="dacl-filter" placeholder="${t("dacl.filter_placeholder")}" class="dacl-filter" />
        <div id="dacl-list" class="dacl-list"></div>
      </aside>
      <section class="dacl-editor-pane">
        <div id="dacl-msg"></div>
        <div id="dacl-editor" class="dacl-editor"></div>
      </section>
    </div>
  `;

  const listEl = container.querySelector("#dacl-list");
  const editorEl = container.querySelector("#dacl-editor");
  const msgEl = container.querySelector("#dacl-msg");
  const filterEl = container.querySelector("#dacl-filter");

  let dacls = [];
  let selected = null;
  let dirty = false;
  let validateTimer = null;

  function setMsg(html) {
    msgEl.innerHTML = html;
  }

  function renderList() {
    const q = filterEl.value.trim().toLowerCase();
    const filtered = q
      ? dacls.filter(
          (d) =>
            (d.name || "").toLowerCase().includes(q) ||
            (d.description || "").toLowerCase().includes(q),
        )
      : dacls;
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty hint">${t("dacl.list_empty")}</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((d) => {
      const sel = selected && selected.id === d.id ? " selected" : "";
      return `
        <div class="dacl-item${sel}" data-id="${esc(d.id)}">
          <div class="dacl-item-name">${esc(d.name)}</div>
          ${d.description ? `<div class="dacl-item-desc">${esc(d.description)}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  async function loadList(preserveSelection = true) {
    listEl.innerHTML = `<div class="empty hint">${t("dacl.list_loading")}</div>`;
    try {
      dacls = await api.listDacls();
      if (preserveSelection && selected) {
        const match = dacls.find((d) => d.id === selected.id);
        if (!match) selected = null;
      }
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  function renderEditor() {
    if (!selected) {
      editorEl.innerHTML = `
        <div class="card empty-editor">
          <p class="hint">${t("dacl.editor_empty")}</p>
        </div>
      `;
      return;
    }
    const isNew = !selected.id;
    editorEl.innerHTML = `
      <div class="card">
        <div class="dacl-form">
          <div class="field">
            <label for="dacl-name">${t("dacl.label_name")}</label>
            <input type="text" id="dacl-name" value="${esc(selected.name)}"
                   ${isNew ? "" : "readonly"} placeholder="MIN_ACL"
                   pattern="[A-Za-z0-9_\\-]+" maxlength="100" />
            ${isNew ? `<div class="hint">${t("dacl.name_hint")}</div>` : ""}
          </div>
          <div class="field">
            <label for="dacl-description">${t("dacl.label_description")}</label>
            <input type="text" id="dacl-description" value="${esc(selected.description)}" />
          </div>
          <div class="field">
            <label for="dacl-type">${t("dacl.label_type")}</label>
            <select id="dacl-type">
              ${DACL_TYPES.map((tp) =>
                `<option value="${tp.value}"${tp.value === selected.dacl_type ? " selected" : ""}>${tp.label}</option>`,
              ).join("")}
            </select>
          </div>
          <div class="field">
            <label for="dacl-body">${t("dacl.label_body")}</label>
            <textarea id="dacl-body" class="dacl-body mono" spellcheck="false"
                      placeholder="permit tcp any any eq 80\npermit udp any any eq 53\ndeny ip any any log">${esc(selected.dacl)}</textarea>
          </div>
          <div id="dacl-validation" class="dacl-validation"></div>
          <div class="actions">
            <button id="dacl-save">${isNew ? t("dacl.btn_create") : t("dacl.btn_save")}</button>
            ${isNew
              ? `<button id="dacl-cancel" class="secondary">${t("dacl.btn_cancel")}</button>`
              : `<button id="dacl-delete" class="danger">${t("dacl.btn_delete")}</button>`}
          </div>
        </div>
      </div>
    `;
    wireEditor();
    queueValidate(true);
  }

  function readEditor() {
    return {
      name: editorEl.querySelector("#dacl-name").value.trim(),
      description: editorEl.querySelector("#dacl-description").value,
      dacl: editorEl.querySelector("#dacl-body").value,
      dacl_type: editorEl.querySelector("#dacl-type").value,
    };
  }

  function queueValidate(immediate = false) {
    if (validateTimer) clearTimeout(validateTimer);
    const fire = async () => {
      const cur = readEditor();
      try {
        const res = await api.validateDacl(cur.dacl, cur.dacl_type);
        renderValidation(res);
      } catch (err) {
        const box = editorEl.querySelector("#dacl-validation");
        if (box) box.innerHTML = `<div class="alert error">${t("dacl.err_validation").replace("{msg}", esc(err.message))}</div>`;
      }
    };
    if (immediate) fire();
    else validateTimer = setTimeout(fire, 350);
  }

  function renderValidation(res) {
    const box = editorEl.querySelector("#dacl-validation");
    if (!box) return;
    if (!res.issues.length) {
      box.innerHTML = `<div class="alert success small">${t("dacl.syntax_ok")}</div>`;
      return;
    }
    const errors = res.issues.filter((i) => i.severity === "error");
    const warns = res.issues.filter((i) => i.severity === "warning");
    const banner = errors.length
      ? `<div class="alert error small">${t("dacl.validation_errors").replace("{n}", errors.length).replace("{w}", warns.length)}</div>`
      : `<div class="alert info small">${t("dacl.validation_warnings").replace("{w}", warns.length)}</div>`;
    const items = res.issues.map((i) => `
      <li class="dacl-issue dacl-issue-${esc(i.severity)}">
        <span class="dacl-issue-line">${i.line ? t("dacl.issue_line").replace("{n}", i.line) : "—"}</span>
        <span class="dacl-issue-text">${esc(i.message)}</span>
        ${i.text ? `<code>${esc(i.text)}</code>` : ""}
      </li>
    `).join("");
    box.innerHTML = `${banner}<ul class="dacl-issue-list">${items}</ul>`;
  }

  function wireEditor() {
    const body = editorEl.querySelector("#dacl-body");
    const type = editorEl.querySelector("#dacl-type");
    const saveBtn = editorEl.querySelector("#dacl-save");
    const delBtn = editorEl.querySelector("#dacl-delete");
    const cancelBtn = editorEl.querySelector("#dacl-cancel");

    body.addEventListener("input", () => { dirty = true; queueValidate(false); });
    type.addEventListener("change", () => { dirty = true; queueValidate(true); });
    editorEl.querySelector("#dacl-description").addEventListener("input", () => { dirty = true; });
    if (!selected.id) {
      editorEl.querySelector("#dacl-name").addEventListener("input", () => { dirty = true; });
    }

    saveBtn.addEventListener("click", async () => {
      const payload = readEditor();
      if (!payload.name) {
        setMsg(`<div class="alert error">${t("dacl.err_name_required")}</div>`);
        return;
      }
      saveBtn.disabled = true;
      setMsg(`<div class="alert info">${t("dacl.saving")}</div>`);
      try {
        let result;
        if (selected.id) {
          result = await api.updateDacl(selected.id, {
            description: payload.description,
            dacl: payload.dacl,
            dacl_type: payload.dacl_type,
          });
        } else {
          result = await api.createDacl(payload);
        }
        selected = result;
        dirty = false;
        await loadList(true);
        renderEditor();
        setMsg(`<div class="alert success">${t("dacl.saved").replace("{name}", esc(result.name))}</div>`);
      } catch (err) {
        setMsg(`<div class="alert error">${esc(err.message)}</div>`);
      } finally {
        saveBtn.disabled = false;
      }
    });

    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        if (!confirm(t("dacl.confirm_delete").replace("{name}", selected.name))) return;
        delBtn.disabled = true;
        setMsg(`<div class="alert info">${t("dacl.deleting")}</div>`);
        try {
          await api.deleteDacl(selected.id);
          selected = null;
          dirty = false;
          await loadList(false);
          renderEditor();
          setMsg(`<div class="alert success">${t("dacl.deleted")}</div>`);
        } catch (err) {
          setMsg(`<div class="alert error">${esc(err.message)}</div>`);
          delBtn.disabled = false;
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        selected = null;
        dirty = false;
        renderEditor();
        renderList();
        setMsg("");
      });
    }
  }

  container.querySelector("#dacl-new-btn").addEventListener("click", () => {
    if (dirty && !confirm(t("dacl.confirm_discard"))) return;
    selected = { ...EMPTY_DACL };
    dirty = false;
    renderEditor();
    renderList();
    setMsg("");
  });

  container.querySelector("#dacl-refresh-btn").addEventListener("click", () => loadList(true));

  filterEl.addEventListener("input", () => renderList());

  listEl.addEventListener("click", async (e) => {
    const item = e.target.closest(".dacl-item");
    if (!item) return;
    if (dirty && !confirm(t("dacl.confirm_discard_open"))) return;
    const id = item.dataset.id;
    setMsg(`<div class="alert info">${t("alert.loading")}</div>`);
    try {
      selected = await api.getDacl(id);
      dirty = false;
      renderEditor();
      renderList();
      setMsg("");
    } catch (err) {
      setMsg(`<div class="alert error">${esc(err.message)}</div>`);
    }
  });

  await loadList(false);
  renderEditor();
}
