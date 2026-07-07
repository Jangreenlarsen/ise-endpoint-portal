import { test, expect } from "@playwright/test";
import { installApiMock, seedAdminSession } from "../fixtures";

test.beforeEach(async ({ page }) => {
  await seedAdminSession(page);
  await installApiMock(page, {
    "settings/backend": {
      ise_base_url: "https://ise-primary.example",
      ise_read_base_url: "https://ise-secondary.example",
      ise_username: "ers-admin",
      ise_password_set: true,
      ise_verify_tls: true,
      ise_timeout: 30,
      ise_api_type: "ers",
    },
  });
});

// Validerer at Fase B's nye "ISE læse-host"-felt er wired ind i settings-templaten.
test("settings → ISE-forbindelse indeholder base_url + det nye read_base_url-felt", async ({ page }) => {
  await page.goto("/#/settings");

  await expect(page.locator("#view-container")).not.toContainText("View error");
  await expect(page.locator("#base_url")).toHaveCount(1);
  await expect(page.locator("#read_base_url")).toHaveCount(1);
});
