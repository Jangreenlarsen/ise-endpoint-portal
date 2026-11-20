import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installApiMock, seedAdminSession } from "../fixtures";
import { CUSTOM_ATTRS, DASHBOARD, DIAG_QUICK, ISE_CONN, ENDPOINTS, GROUPS, PSK_POLICY, ROLES, TEMPLATES, trends } from "./demo-data";

const OUT = path.resolve(__dirname, "../../docs/img");
const V = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../version.json"), "utf-8"));
const VERSION = `${V.version}.${V.build}`;
const shot = (page: Page, name: string, opts: Parameters<Page["screenshot"]>[0] = {}) =>
  page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });

const COMMON = {
  "health": { status: "ok", full: VERSION },
  "groups": GROUPS,
  "custom-attributes": CUSTOM_ATTRS,
  "endpoint-roles": ROLES,
  "endpoints/details": { items: ENDPOINTS, total: ENDPOINTS.length },
  "endpoints/session-macs": { macs: ENDPOINTS.filter((e) => e.active_status === "Aktiv").map((e) => e.mac) },
  "settings/psk-policy": PSK_POLICY,
  "templates": TEMPLATES,
  "dacls": [{ id: "d1", name: "DACL-IoT-Camera" }, { id: "d2", name: "DACL-Printer" }],
};

test.beforeEach(async ({ page }) => {
  await seedAdminSession(page);
});

test("dashboard", async ({ page }) => {
  await installApiMock(page, { ...COMMON, "dashboard": DASHBOARD, "trends": trends(), "lifecycle/stale": { stale_count: 37, threshold_days: 90, total_cached: 4812 }, "diagnostics/quick": DIAG_QUICK, "ise/connection": ISE_CONN, "logs": { entries: [] } });
  await page.goto("/#/dashboard");
  await page.waitForTimeout(1500);
  await shot(page, "dashboard");
});

test("browse", async ({ page }) => {
  await installApiMock(page, COMMON);
  await page.goto("/#/browse");
  await page.waitForTimeout(2000);
  await shot(page, "browse");
});

test("endpoint-detalje med PSK", async ({ page }) => {
  await installApiMock(page, { ...COMMON, "endpoints/e06": ENDPOINTS[5] });
  await page.goto("/#/browse");
  await page.waitForTimeout(2000);
  await page.getByText("A4:83:E7:0F:12:06").first().click();
  await page.waitForTimeout(1500);
  await shot(page, "endpoint-detalje-psk");
});

test("opret endpoint", async ({ page }) => {
  await installApiMock(page, COMMON);
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.goto("/#/register");
  await page.waitForTimeout(1500);
  await page.locator("#r-mac").fill("B8:27:EB:5C:44:11");
  await page.locator("#r-group").selectOption({ label: "IoT-Sensorer" });
  for (const [k, v] of [["Type", "Sensor"], ["Owner", "drift"], ["Lokation", "Kontor 1.12"], ["AuthzVlan", "250"], ["PlatformType", "Linux"]]) {
    await page.locator(`#r-ca-${k}`).selectOption(v).catch(() => {});
  }
  if (await page.locator("#r-psk-section").isVisible()) {
    await page.locator("#r-psk-mode").check();
    await page.locator("#r-psk-key").fill("Sensor-Kontor-112");
  }
  await page.locator("#r-mac").blur();
  await page.waitForTimeout(800);
  await shot(page, "opret-endpoint");
});

test("settings psk-politik", async ({ page }) => {
  await installApiMock(page, COMMON);
  await page.goto("/#/settings");
  await page.waitForTimeout(1000);
  await page.locator('.settings-tab[data-tab="portal-config"]').click();
  await page.waitForTimeout(500);
  await shot(page, "settings-psk-politik", { fullPage: true });
});

test("selvregistrering", async ({ page }) => {
  await installApiMock(page, {
    "selfregister/config": { enabled: true, intro_text: "Registrér din enhed for at få adgang til gæstenettet.", success_text: "Din enhed er nu registreret.", terms: "Jeg accepterer virksomhedens retningslinjer for brug af netværket.", redirect_url: "", ipsk_enabled: true, psk_hint: "12-63 tegn, mindst ét stort bogstav og ét tal", expiry_enabled: true, expiry_mode: "period", expiry_days: 30 },
    "selfregister/session": { found: true, mac: "DA:A1:19:7C:55:08", nas_ip: "10.0.0.2", client_ip: "10.90.4.17" },
  });
  await page.goto("/selfregister.html");
  await page.waitForTimeout(1500);
  await shot(page, "selvregistrering", { fullPage: true });
});

test("settings gaeste-selvregistrering", async ({ page }) => {
  await installApiMock(page, {
    ...COMMON,
    "settings/backend": {
      selfregister_enabled: true, selfregister_group_id: "g6", selfregister_ipsk_enabled: true,
      selfregister_intro_text: "Registrér din enhed for at få adgang til gæstenettet.",
      selfregister_success_text: "Din enhed er nu registreret.",
      selfregister_terms: "Jeg accepterer virksomhedens retningslinjer for brug af netværket.",
      selfregister_authz_vlan: "900", selfregister_expiry_enabled: true, selfregister_expiry_mode: "period",
      selfregister_expiry_days: 30, selfregister_expiry_coa_enabled: true, selfregister_expiry_coa_type: "disconnect",
      guest_expiry_check_interval_seconds: 60, selfregister_redirect_url: "https://www.example.com",
    },
  });
  await page.setViewportSize({ width: 1440, height: 2600 });
  await page.goto("/#/settings");
  await page.waitForTimeout(1000);
  await page.locator('.settings-tab[data-tab="portal-config"]').click();
  await page.locator('[data-subtab-btn="pc-advanced"], .settings-subtab:has-text("Avanceret")').first().click();
  await page.waitForTimeout(800);
  await page.locator("#guest-reg-card").scrollIntoViewIfNeeded();
  await page.locator("#guest-reg-card").screenshot({ path: path.join(OUT, "settings-gaeste-selvregistrering.png") });
});
