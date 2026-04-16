import { api } from "../api.js";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

/**
 * Build a <select> + inline "add new" for a custom attribute.
 */
function buildAttrField(label, attrName, values) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  wrapper.innerHTML = `
    <label for="ca-${attrName}">${label} (valgfri)</label>
    <div class="ca-row">
      <select id="ca-${attrName}">
        <option value="">— ingen —</option>
        ${values.map((v) => `<option value="${v}">${v}</option>`).join("")}
        <option value="__add__">+ Tilføj ny…</option>
      </select>
      <div class="ca-add hidden" id="ca-add-${attrName}">
        <input type="text" placeholder="Ny værdi" id="ca-new-${attrName}" />
        <button type="button" class="small" id="ca-save-${attrName}">Gem</button>
        <button type="button" class="small secondary" id="ca-cancel-${attrName}">Annuller</button>
      </div>
    </div>
  `;
  return wrapper;
}

function wireAttrField(container, attrName, refreshSelects) {
  const select = container.querySelector(`#ca-${attrName}`);
  const addDiv = container.querySelector(`#ca-add-${attrName}`);
  const input = container.querySelector(`#ca-new-${attrName}`);
  const saveBtn = container.querySelector(`#ca-save-${attrName}`);
  const cancelBtn = container.querySelector(`#ca-cancel-${attrName}`);

  select.addEventListener("change", () => {
    if (select.value === "__add__") {
      addDiv.classList.remove("hidden");
      input.focus();
    } else {
      addDiv.classList.add("hidden");
    }
  });

  cancelBtn.addEventListener("click", () => {
    select.value = "";
    addDiv.classList.add("hidden");
    input.value = "";
  });

  saveBtn.addEventListener("click", async () => {
    const val = input.value.trim();
    if (!val) return;
    try {
      await api.addCustomAttributeValue(attrName, val);
      input.value = "";
      addDiv.classList.add("hidden");
      await refreshSelects();
      const sel = container.querySelector(`#ca-${attrName}`);
      sel.value = val;
    } catch (err) {
      const msg = container.querySelector("#msg");
      msg.innerHTML = `<div class="alert error">Kunne ikke tilføje ${attrName}-værdi: ${err.message}</div>`;
    }
  });
}

export async function renderCreate(container) {
  container.innerHTML = `
    <h2>Opret endpoint</h2>
    <div class="card">
      <div id="msg"></div>
      <form id="create-form">
        <div class="field">
          <label for="mac">MAC adresse</label>
          <input type="text" id="mac" required placeholder="AA:BB:CC:DD:EE:FF" />
          <div class="hint">Format: <code>AA:BB:CC:DD:EE:FF</code> (kolon eller bindestreg)</div>
        </div>
        <div class="field">
          <label for="group">Endpoint Group (valgfri)</label>
          <select id="group">
            <option value="">— ingen (ISE default) —</option>
          </select>
        </div>
        <div class="field">
          <label for="description">Beskrivelse (valgfri)</label>
          <input type="text" id="description" />
        </div>
        <div id="custom-attrs"></div>
        <div class="actions">
          <button type="submit">Opret endpoint</button>
          <button type="reset" class="secondary">Ryd</button>
        </div>
      </form>
    </div>
  `;

  const groupSelect = container.querySelector("#group");
  const msg = container.querySelector("#msg");
  const caContainer = container.querySelector("#custom-attrs");

  // Load groups — add as options after the default empty option
  try {
    const groups = await api.listGroups();
    const options = groups
      .map((g) => `<option value="${g.id}">${g.name}</option>`)
      .join("");
    groupSelect.innerHTML = `<option value="">— ingen (ISE default) —</option>${options}`;
  } catch (err) {
    msg.innerHTML = `<div class="alert error">Kunne ikke hente groups: ${err.message}</div>`;
  }

  // Map of ISE attribute name → display label
  const attrLabels = {
    Owner: "Ejer (Owner)",
    Lokation: "Lokation",
    AuthzVlan: "Authz VLAN",
  };

  async function refreshSelects() {
    try {
      const data = await api.listCustomAttributes();
      const attrMap = {};
      for (const a of data.attributes) {
        attrMap[a.name] = a.values;
      }
      caContainer.innerHTML = "";
      for (const [name, label] of Object.entries(attrLabels)) {
        const values = attrMap[name] || [];
        const field = buildAttrField(label, name, values);
        caContainer.appendChild(field);
        wireAttrField(container, name, refreshSelects);
      }
    } catch (err) {
      caContainer.innerHTML = `<div class="alert error">Kunne ikke hente custom attributes: ${err.message}</div>`;
    }
  }

  await refreshSelects();

  container.querySelector("#create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const mac = container.querySelector("#mac").value.trim().toUpperCase();
    if (!MAC_RE.test(mac)) {
      msg.innerHTML = `<div class="alert error">Ugyldig MAC adresse.</div>`;
      return;
    }

    const ca = {};
    let hasCA = false;
    for (const name of Object.keys(attrLabels)) {
      const sel = container.querySelector(`#ca-${name}`);
      const val = sel ? sel.value : "";
      if (val && val !== "__add__") {
        ca[name] = val;
        hasCA = true;
      }
    }

    const payload = {
      mac,
      group_id: groupSelect.value,
      description: container.querySelector("#description").value.trim(),
    };
    if (hasCA) {
      payload.custom_attributes = ca;
    }

    try {
      await api.createEndpoint(payload);
      msg.innerHTML = `<div class="alert success">Endpoint ${mac} oprettet.</div>`;
      e.target.reset();
      await refreshSelects();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Fejl: ${err.message}</div>`;
    }
  });
}
