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

test("browse: per-gren gruppering — en grens undergruppering kan skiftes", async ({ page }) => {
  await installApiMock(page, {
    "endpoints/details": {
      items: [
        { id: "e1", mac: "AA:BB:CC:00:00:01", name: "AA:BB:CC:00:00:01", group_name: "Corp", profiler_name: "Windows", vendor: "Dell" },
        { id: "e2", mac: "AA:BB:CC:00:00:02", name: "AA:BB:CC:00:00:02", group_name: "Corp", profiler_name: "Windows", vendor: "HP" },
      ],
      total: 2,
    },
  });
  await page.goto("/#/browse");
  await page.locator("#view-mode-tree").click();

  // Standard: Gruppe(Corp) → Profil(Windows). Fold Corp ud.
  const corp = page.locator('#browse-tree-wrap .tree-branch[data-path="//0:Corp"]');
  await expect(corp).toBeVisible({ timeout: 10000 });
  await corp.click();

  // Skift Corps undergruppering fra Profil (standard) til Vendor.
  const sub = page.locator('.tree-subgroup-select[data-path="//0:Corp"]');
  await expect(sub).toBeVisible();
  await sub.selectOption("vendor");

  // Corps børn er nu grupperet efter vendor → Dell- og HP-grene, + custom-badge på Corp.
  await expect(page.locator('#browse-tree-wrap .tree-branch[data-path="//0:Corp//1:Dell"]')).toBeVisible();
  await expect(page.locator('#browse-tree-wrap .tree-branch[data-path="//0:Corp//1:HP"]')).toBeVisible();
  await expect(corp.locator(".tree-custom-badge")).toBeVisible();

  // Fjern Corps egen gruppering igen med ✕ → tilbage til standard (badge + vendor-grene væk).
  await page.locator('.tree-subgroup-clear[data-clear-path="//0:Corp"]').click();
  await expect(page.locator('#browse-tree-wrap .tree-branch[data-path="//0:Corp//1:Dell"]')).toHaveCount(0);
  await expect(corp.locator(".tree-custom-badge")).toHaveCount(0);
  await expect(page.locator("#view-container")).not.toContainText("View error");
});

test("browse: gren-bulk — vælg en gren aktiverer bulk-toolbaren", async ({ page }) => {
  await installApiMock(page, {
    "endpoints/details": {
      items: [
        { id: "e1", mac: "AA:BB:CC:00:00:01", name: "AA:BB:CC:00:00:01", group_name: "Corp", profiler_name: "Windows" },
        { id: "e2", mac: "AA:BB:CC:00:00:02", name: "AA:BB:CC:00:00:02", group_name: "Corp", profiler_name: "Windows" },
      ],
      total: 2,
    },
  });
  await page.goto("/#/browse");
  await page.locator("#view-mode-tree").click();
  const corp = page.locator('#browse-tree-wrap .tree-branch[data-path="//0:Corp"]');
  await expect(corp).toBeVisible({ timeout: 10000 });

  await expect(page.locator("#bulk-edit-btn")).toBeDisabled();
  // Vælg hele Corp-grenen → alle 2 endpoints under den vælges + bulk-toolbaren aktiveres.
  await corp.locator(".tree-branch-cb").click();
  await expect(page.locator("#bulk-edit-btn")).toBeEnabled();
  await expect(page.locator("#bulk-coa-btn")).toBeEnabled();
  await expect(page.locator("#selection-count")).toContainText("2");

  // Fravælg igen → bulk-toolbaren deaktiveres.
  await corp.locator(".tree-branch-cb").click();
  await expect(page.locator("#bulk-edit-btn")).toBeDisabled();
  await expect(page.locator("#view-container")).not.toContainText("View error");
});

test("browse: Fase 3 — drag et endpoint til en anden gruppe → updateEndpoint m. ny group_id", async ({ page }) => {
  let putGid: string | null = null;
  await installApiMock(page, {
    "endpoints/details": {
      items: [
        { id: "e1", mac: "AA:BB:CC:00:00:01", name: "AA:BB:CC:00:00:01", group_name: "Corp", group_id: "g-corp", profiler_name: "Windows" },
        { id: "e2", mac: "AA:BB:CC:00:00:02", name: "AA:BB:CC:00:00:02", group_name: "Guest", group_id: "g-guest", profiler_name: "Windows" },
      ],
      total: 2,
    },
  });
  // Fang PUT /endpoints/e1 (flyt-kaldet). Registreres efter installApiMock → vinder.
  await page.route("**/api/endpoints/e1", async (route) => {
    if (route.request().method() === "PUT") {
      try { putGid = JSON.parse(route.request().postData() || "{}").group_id; } catch { /* ignore */ }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fallback();
  });
  page.on("dialog", (d) => d.accept());  // bekræft flyt

  await page.goto("/#/browse");
  await page.locator("#view-mode-tree").click();
  await expect(page.locator('#browse-tree-wrap .tree-branch[data-drop-gid="g-guest"]')).toBeVisible({ timeout: 10000 });
  await page.locator("#tree-expand-all").click();

  const leaf = page.locator('#browse-tree-wrap .tree-leaf-row[data-id="e1"]');
  const guest = page.locator('#browse-tree-wrap .tree-branch[data-drop-gid="g-guest"]');
  await expect(leaf).toBeVisible();
  await leaf.dragTo(guest);

  await expect.poll(() => putGid, { timeout: 5000 }).toBe("g-guest");
});
