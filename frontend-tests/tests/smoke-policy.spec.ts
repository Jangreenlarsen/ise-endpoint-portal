import { test, expect } from "@playwright/test";
import { installApiMock, seedAdminSession } from "../fixtures";

test.beforeEach(async ({ page }) => {
  await seedAdminSession(page);
  await installApiMock(page, {
    // Tom policy-set-liste er en gyldig tilstand → viewet renderer sit skelet uden crash.
    "policy/sets": [],
  });
});

test("policy-view: navigerer og renderer uden crash", async ({ page }) => {
  await page.goto("/#/policy");

  await expect(page.locator("#view-container")).not.toBeEmpty();
  await expect(page.locator("#view-container")).not.toContainText("View error");
});
