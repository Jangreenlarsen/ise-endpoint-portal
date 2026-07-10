import { test, expect } from "@playwright/test";
import { installApiMock, seedAdminSession } from "../fixtures";

test.beforeEach(async ({ page }) => {
  await seedAdminSession(page);
  await installApiMock(page);
});

// Verificerer at det nye gruppetræ-view kan slås til og renderer uden crash.
test("browse: Træ-toggle renderer gruppetræet + group-by-chips uden crash", async ({ page }) => {
  await page.goto("/#/browse");
  await expect(page.locator("#view-mode-tree")).toBeVisible();
  await page.locator("#view-mode-tree").click();

  await expect(page.locator("#browse-tree-wrap")).toBeVisible();
  await expect(page.locator("#tree-add-btn")).toBeVisible();
  await expect(page.locator("#browse-tree-wrap .tree-chip").first()).toBeVisible();
  await expect(page.locator("#view-container")).not.toContainText("View error");

  // Skift tilbage til tabel
  await page.locator("#view-mode-table").click();
  await expect(page.locator("#browse-tree-wrap")).toBeHidden();
});
