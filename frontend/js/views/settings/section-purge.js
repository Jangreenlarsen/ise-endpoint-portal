import { t } from "../../i18n.js";
import { esc } from "./shared.js";

export async function initPurgeProtectSection(container) {
  // Copy-knapper i vejledning-card'et: lægger den specificerede streng på
  // udklipsholderen så admin hurtigt kan paste ind i ISE-formularen.
  const msg = container.querySelector("#purge-protect-msg");
  container.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
        if (msg) msg.innerHTML = `<span style="color:#166534;">${t("settings.purge_copied").replace("{text}", `<code>${esc(text)}</code>`)}</span>`;
        const original = btn.textContent;
        btn.textContent = t("settings.purge_copy_ok");
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (err) {
        if (msg) msg.innerHTML = `<span style="color:#b91c1c;">${t("settings.purge_copy_err").replace("{msg}", esc(err.message))}</span>`;
      }
    });
  });
}
