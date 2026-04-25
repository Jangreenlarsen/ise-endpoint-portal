// Offline-kø til registreringer (M8).
//
// Registrering kan ske i felten på en mobil med ustabil/ingen forbindelse.
// Når api.createEndpoint() fejler med en netværksfejl gemmer vi payloaden
// i localStorage og forsøger at sende dem igen ved næste 'online'-event
// eller ved manuelt klik fra registreringsviewet.

import { api } from "./api.js";

const KEY = "hv_ise_register_queue";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export const offlineQueue = {
  size() { return load().length; },
  list() { return load(); },
  enqueue(payload) {
    const items = load();
    items.push({
      id: Date.now() + ":" + Math.random().toString(36).slice(2, 8),
      payload,
      enqueued_at: new Date().toISOString(),
    });
    save(items);
    return items.length;
  },
  removeById(id) {
    save(load().filter((it) => it.id !== id));
  },
  clear() {
    save([]);
  },
  // Flush a single item; throws if api-call fails (caller decides retry).
  async flushOne(item) {
    await api.createEndpoint(item.payload);
    this.removeById(item.id);
  },
  // Forsøg at sende alle items. Stopper ved første netværksfejl så de
  // resterende ikke mister deres plads. Returnerer { sent, failed, kept }.
  async flushAll() {
    const items = load();
    let sent = 0;
    let failed = 0;
    let kept = 0;
    for (const it of items) {
      try {
        await api.createEndpoint(it.payload);
        this.removeById(it.id);
        sent++;
      } catch (err) {
        // Netværksfejl → stop, behold resten. Auth/validerings-fejl
        // (ikke-2xx response) markeres failed og fjernes så de ikke
        // blokerer køen for evigt.
        const isNetwork = err && typeof err.message === "string"
          && !/^\d{3}:/.test(err.message);
        if (isNetwork) {
          kept = load().length - sent + failed;
          break;
        }
        this.removeById(it.id);
        failed++;
      }
    }
    return { sent, failed, kept: load().length };
  },
};

// Auto-flush ved online-event så field-tech ikke selv skal trykke.
window.addEventListener("online", () => {
  if (offlineQueue.size() > 0) {
    offlineQueue.flushAll().then((res) => {
      if (res.sent > 0) {
        window.dispatchEvent(new CustomEvent("offlinequeue:flushed", { detail: res }));
      }
    }).catch(() => {});
  }
});
