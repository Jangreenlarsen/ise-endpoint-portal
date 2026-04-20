import { api } from "../api.js";

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
    <h2>ACL — Cisco ISE Downloadable ACLs</h2>
    <p class="hint">
      Listen viser alle DACL'er fra ISE — både dem oprettet i denne portal og dem
      en ISE-administrator har lagt ind direkte. Editoren bruger Cisco IOS
      access-list syntaks (én ACE per linje). Kommentarer starter med
      <code>!</code>. Backend tjekker syntaksen mens du skriver; ISE laver det
      endelige tjek når du gemmer.
    </p>
    <div class="dacl-layout">
      <aside class="dacl-list-pane">
        <div class="dacl-list-toolbar">
          <button id="dacl-new-btn">Ny ACL</button>
          <button id="dacl-refresh-btn" class="secondary small">Refresh</button>
        </div>
        <input type="search" id="dacl-filter" placeholder="Filter..." class="dacl-filter" />
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
  let selected = null;          // currently displayed DaclDetail
  let dirty = false;            // editor has unsaved changes
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
      listEl.innerHTML = `<div class="empty hint">Ingen DACL'er.</div>`;
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
    listEl.innerHTML = `<div class="empty hint">Indlæser fra ISE...</div>`;
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
          <p class="hint">Vælg en ACL til venstre eller klik <strong>Ny ACL</strong>.</p>
        </div>
      `;
      return;
    }
    const isNew = !selected.id;
    editorEl.innerHTML = `
      <div class="card">
        <div class="dacl-form">
          <div class="field">
            <label for="dacl-name">Navn</label>
            <input type="text" id="dacl-name" value="${esc(selected.name)}"
                   ${isNew ? "" : "readonly"} placeholder="MIN_ACL"
                   pattern="[A-Za-z0-9_\\-]+" maxlength="100" />
            ${isNew ? '<div class="hint">Bogstaver, tal, _ og -. Kan ikke ændres efter oprettelse.</div>' : ""}
          </div>
          <div class="field">
            <label for="dacl-description">Beskrivelse</label>
            <input type="text" id="dacl-description" value="${esc(selected.description)}" />
          </div>
          <div class="field">
            <label for="dacl-type">Type</label>
            <select id="dacl-type">
              ${DACL_TYPES.map((t) =>
                `<option value="${t.value}"${t.value === selected.dacl_type ? " selected" : ""}>${t.label}</option>`,
              ).join("")}
            </select>
          </div>
          <div class="field">
            <label for="dacl-body">Access-list (Cisco IOS syntaks)</label>
            <textarea id="dacl-body" class="dacl-body mono" spellcheck="false"
                      placeholder="permit tcp any any eq 80\npermit udp any any eq 53\ndeny ip any any log">${esc(selected.dacl)}</textarea>
          </div>
          <div id="dacl-validation" class="dacl-validation"></div>
          <div class="actions">
            <button id="dacl-save">${isNew ? "Opret" : "Gem ændringer"}</button>
            ${isNew
              ? '<button id="dacl-cancel" class="secondary">Annuller</button>'
              : '<button id="dacl-delete" class="danger">Slet ACL</button>'}
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
        if (box) box.innerHTML = `<div class="alert error">Validering fejlede: ${esc(err.message)}</div>`;
      }
    };
    if (immediate) fire();
    else validateTimer = setTimeout(fire, 350);
  }

  function renderValidation(res) {
    const box = editorEl.querySelector("#dacl-validation");
    if (!box) return;
    if (!res.issues.length) {
      box.innerHTML = `<div class="alert success small">Syntaks OK.</div>`;
      return;
    }
    const errors = res.issues.filter((i) => i.severity === "error");
    const warns = res.issues.filter((i) => i.severity === "warning");
    const banner = errors.length
      ? `<div class="alert error small">${errors.length} fejl, ${warns.length} advarsler</div>`
      : `<div class="alert info small">${warns.length} advarsler (ingen fejl)</div>`;
    const items = res.issues.map((i) => `
      <li class="dacl-issue dacl-issue-${esc(i.severity)}">
        <span class="dacl-issue-line">${i.line ? `linje ${i.line}` : "—"}</span>
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
        setMsg(`<div class="alert error">Navn er påkrævet.</div>`);
        return;
      }
      saveBtn.disabled = true;
      setMsg(`<div class="alert info">Gemmer i ISE...</div>`);
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
        setMsg(`<div class="alert success">ACL "${esc(result.name)}" gemt.</div>`);
      } catch (err) {
        setMsg(`<div class="alert error">${esc(err.message)}</div>`);
      } finally {
        saveBtn.disabled = false;
      }
    });

    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        if (!confirm(
          `Slet ACL "${selected.name}" i ISE?\n\n` +
          `Endpoints der refererer til navnet via AuthzACL bliver IKKE ` +
          `automatisk ryddet — de vil bare miste opslag indtil navnet eksisterer igen.`,
        )) return;
        delBtn.disabled = true;
        setMsg(`<div class="alert info">Sletter...</div>`);
        try {
          await api.deleteDacl(selected.id);
          selected = null;
          dirty = false;
          await loadList(false);
          renderEditor();
          setMsg(`<div class="alert success">ACL slettet.</div>`);
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

  // Wire global controls
  container.querySelector("#dacl-new-btn").addEventListener("click", () => {
    if (dirty && !confirm("Du har ugemte ændringer. Forkast og opret ny?")) return;
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
    if (dirty && !confirm("Du har ugemte ændringer. Forkast og åbn anden ACL?")) return;
    const id = item.dataset.id;
    setMsg(`<div class="alert info">Henter ACL...</div>`);
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
