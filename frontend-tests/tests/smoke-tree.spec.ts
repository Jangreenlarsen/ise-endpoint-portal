import { test, expect } from "@playwright/test";
import { installApiMock, seedAdminSession } from "../fixtures";

test.beforeEach(async ({ page }) => {
  await seedAdminSession(page);
});

// Verificerer at det nye gruppetræ-view kan slås til og renderer uden crash.
test("browse: Træ-toggle renderer gruppetræet + group-by-chips uden crash", async ({ page }) => {
  await installApiMock(page);
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

test("browse: Træ-leaves render'es som tabel med kolonner + MAC-værdier", async ({ page }) => {
  await installApiMock(page, {
    "endpoints/details": {
      items: [
        { id: "e1", mac: "AA:BB:CC:00:00:01", name: "AA:BB:CC:00:00:01", group_name: "Corp", profiler_name: "Windows", vendor: "Dell", owner: "alice" },
        { id: "e2", mac: "AA:BB:CC:00:00:02", name: "AA:BB:CC:00:00:02", group_name: "Corp", profiler_name: "Windows", vendor: "HP", owner: "bob" },
      ],
      total: 2,
    },
  });
  await page.goto("/#/browse");
  await page.locator("#view-mode-tree").click();
  // Vent til endpoint-data er loadet og træet har grene (load() -> applyFilter -> renderTree).
  await expect(page.locator("#browse-tree-wrap .tree-branch").first()).toBeVisible({ timeout: 10000 });
  await page.locator("#tree-expand-all").click();

  const leafTable = page.locator("#browse-tree-wrap .tree-leaf-table").first();
  await expect(leafTable).toBeVisible();
  await expect(leafTable).toContainText("AA:BB:CC:00:00:01");
  await expect(leafTable).toContainText("Dell");            // ikke-grupperet kolonne render'es
  await expect(page.locator("#view-container")).not.toContainText("View error");
});
