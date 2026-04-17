import { api } from "../api.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const ATTR_LABELS = {
  Type: "Type",
  Owner: "Ejer (Owner)",
  Lokation: "Lokation",
  AuthzVlan: "Authz VLAN",
};

export async function renderAttributes(container) {
  container.innerHTML = `
    <h2>Attribut-vaerdier</h2>
    <p class="hint">
      Administrer de tilladte vaerdier for hvert custom attribute.
      Vaerdierne bruges i dropdowns ved oprettelse og redigering af endpoints.
    </p>
    <div id="attr-msg"></div>
    <div id="attr-sections"></div>
    <div class="card" style="margin-top:1rem;">
      <button id="sync-btn">Sync fra ISE</button>
      <span class="hint" style="margin-left:0.5rem;">Scanner endpoints i ISE og importerer fundne vaerdier.</span>
      <div id="sync-result"></div>
    </div>
  `;

  const sections = container.querySelector("#attr-sections");
  const attrMsg = container.querySelector("#attr-msg");

  async function render() {
    attrMsg.innerHTML = "";
    try {
      const data = await api.listCustomAttributes();
      const attrMap = {};
      for (const a of data.attributes) attrMap[a.name] = a.values;

      sections.innerHTML = Object.entries(ATTR_LABELS).map(([name, label]) => {
        const values = attrMap[name] || [];
        return `
          <div class="card" style="margin-bottom:0.75rem;">
            <h3>${esc(label)}</h3>
            <div class="attr-values" data-attr="${esc(name)}">
              ${values.length
                ? values.map((v) => `
                    <span class="attr-tag">
                      ${esc(v)}
                      <button class="attr-del" data-attr="${esc(name)}" data-value="${esc(v)}" title="Fjern">&times;</button>
                    </span>`).join("")
                : '<span class="hint">Ingen vaerdier endnu.</span>'}
            </div>
            <div class="attr-add-row" style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center;">
              <input type="text" class="attr-new-input" data-attr="${esc(name)}"
                     placeholder="Ny vaerdi..." style="padding:0.3rem 0.5rem;border:1px solid #d1d5db;border-radius:3px;flex:1;max-width:250px;" />
              <button class="attr-add-btn small" data-attr="${esc(name)}">Tilfoej</button>
            </div>
          </div>`;
      }).join("");
    } catch (err) {
      attrMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
    }
  }

  sections.addEventListener("click", async (e) => {
    if (e.target.classList.contains("attr-del")) {
      const attr = e.target.dataset.attr;
      const value = e.target.dataset.value;
      if (!confirm(`Fjern "${value}" fra ${attr}?`)) return;
      try {
        await api.removeCustomAttributeValue(attr, value);
        await render();
      } catch (err) {
        attrMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
    if (e.target.classList.contains("attr-add-btn")) {
      const attr = e.target.dataset.attr;
      const input = sections.querySelector(`.attr-new-input[data-attr="${attr}"]`);
      const val = input.value.trim();
      if (!val) return;
      try {
        await api.addCustomAttributeValue(attr, val);
        input.value = "";
        await render();
      } catch (err) {
        attrMsg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
  });

  // Allow Enter key in input fields
  sections.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.classList.contains("attr-new-input")) {
      e.preventDefault();
      const btn = sections.querySelector(`.attr-add-btn[data-attr="${e.target.dataset.attr}"]`);
      btn.click();
    }
  });

  container.querySelector("#sync-btn").addEventListener("click", async () => {
    const syncResult = container.querySelector("#sync-result");
    syncResult.innerHTML = `<div class="alert info">Synkroniserer...</div>`;
    try {
      const res = await api.syncCustomAttributes();
      const newCount = Object.values(res.new_values_found).reduce((s, v) => s + v.length, 0);
      syncResult.innerHTML = `<div class="alert success">
        Scannet ${res.scanned_endpoints} endpoints. ${newCount} nye vaerdier fundet.
      </div>`;
      await render();
    } catch (err) {
      syncResult.innerHTML = `<div class="alert error">${err.message}</div>`;
    }
  });

  await render();
}
