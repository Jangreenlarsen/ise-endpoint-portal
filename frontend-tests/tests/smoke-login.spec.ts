import { test, expect } from "@playwright/test";
import { installApiMock } from "../fixtures";

// Uautentificeret: ingen session seedes, /auth/status siger not-authenticated.
test("login-siden renderes for uautentificeret bruger", async ({ page }) => {
  await installApiMock(page, {
    "auth/status": { authenticated: false, default_language: "da" },
  });
  await page.goto("/");

  await expect(page.locator("#login-username")).toBeVisible();
  await expect(page.locator("#login-password")).toBeVisible();
  await expect(page.locator("#login-submit")).toBeVisible();
});
