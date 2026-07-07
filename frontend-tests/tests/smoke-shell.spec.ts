import { test, expect } from "@playwright/test";
import { installApiMock, seedAdminSession, ADMIN } from "../fixtures";

test.beforeEach(async ({ page }) => {
  await seedAdminSession(page);
  await installApiMock(page);
});

test("autentificeret shell: sidebar + bruger-badge renderes uden crash", async ({ page }) => {
  await page.goto("/#/browse");

  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("#user-name")).toHaveText(ADMIN.username);
  // View-containeren skal rendere noget og IKKE vise crash-handlerens fejlboks.
  await expect(page.locator("#view-container")).not.toBeEmpty();
  await expect(page.locator("#view-container")).not.toContainText("View error");
});
