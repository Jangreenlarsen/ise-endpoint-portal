import { api } from "../api.js";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

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
          <label for="group">Endpoint Group</label>
          <select id="group" required></select>
        </div>
        <div class="field">
          <label for="description">Beskrivelse (valgfri)</label>
          <input type="text" id="description" />
        </div>
        <div class="actions">
          <button type="submit">Opret endpoint</button>
          <button type="reset" class="secondary">Ryd</button>
        </div>
      </form>
    </div>
  `;

  const groupSelect = container.querySelector("#group");
  const msg = container.querySelector("#msg");

  try {
    const groups = await api.listGroups();
    if (!groups.length) {
      msg.innerHTML = `<div class="alert info">Ingen endpoint groups hentet fra ISE.</div>`;
    }
    groupSelect.innerHTML = groups
      .map((g) => `<option value="${g.id}">${g.name}</option>`)
      .join("");
  } catch (err) {
    msg.innerHTML = `<div class="alert error">Kunne ikke hente groups: ${err.message}</div>`;
  }

  container.querySelector("#create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const mac = container.querySelector("#mac").value.trim().toUpperCase();
    if (!MAC_RE.test(mac)) {
      msg.innerHTML = `<div class="alert error">Ugyldig MAC adresse.</div>`;
      return;
    }
    const payload = {
      mac,
      group_id: groupSelect.value,
      description: container.querySelector("#description").value.trim(),
    };
    try {
      await api.createEndpoint(payload);
      msg.innerHTML = `<div class="alert success">Endpoint ${mac} oprettet.</div>`;
      e.target.reset();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Fejl: ${err.message}</div>`;
    }
  });
}
