import { api } from "./api.js";

const statusDot = document.getElementById("status-dot");
const groupsBody = document.querySelector("#groups-table tbody");
const endpointsBody = document.querySelector("#endpoints-table tbody");

async function checkHealth() {
  try {
    await api.health();
    statusDot.textContent = "ok";
    statusDot.className = "ok";
  } catch (err) {
    statusDot.textContent = "down";
    statusDot.className = "err";
  }
}

function renderRows(tbody, rows, cols) {
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${cols.length}" class="empty">No results</td>`;
    tbody.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = cols
      .map((c) => `<td>${(row[c] ?? "").toString().replace(/</g, "&lt;")}</td>`)
      .join("");
    tbody.appendChild(tr);
  }
}

async function loadGroups() {
  try {
    const data = await api.listGroups();
    renderRows(groupsBody, data, ["name", "id", "description"]);
  } catch (err) {
    renderRows(groupsBody, [{ name: `error: ${err.message}`, id: "", description: "" }], [
      "name",
      "id",
      "description",
    ]);
  }
}

async function loadEndpoints() {
  try {
    const data = await api.listEndpoints();
    renderRows(endpointsBody, data, ["name", "id", "description"]);
  } catch (err) {
    renderRows(
      endpointsBody,
      [{ name: `error: ${err.message}`, id: "", description: "" }],
      ["name", "id", "description"],
    );
  }
}

document.getElementById("refresh-groups").addEventListener("click", loadGroups);
document.getElementById("refresh-endpoints").addEventListener("click", loadEndpoints);

checkHealth();
loadGroups();
loadEndpoints();
