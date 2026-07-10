import type { Page } from "@playwright/test";

// Admin-bruger brugt til autentificerede tests.
export const ADMIN = { username: "admin", role: "admin", auth_type: "local" };

function futureIso(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * Seed en gyldig (ikke-udløbet) admin-session i localStorage FØR app-scripts kører,
 * så `boot()` ser en logget-ind bruger. Token'et er normalt en httpOnly-cookie —
 * her simulerer vi kun de ikke-sensitive metadata portalen gemmer i localStorage.
 */
export async function seedAdminSession(page: Page, user = ADMIN): Promise<void> {
  await page.addInitScript(
    ([u, exp]) => {
      localStorage.setItem(
        "hv_ise_token_meta",
        JSON.stringify({ expires_at: exp, auth_type: "local" }),
      );
      localStorage.setItem("hv_ise_user", JSON.stringify(u));
    },
    [user, futureIso()] as const,
  );
}

/**
 * Mock ALLE /api/**-kald. Fælles boot-endpoints har fornuftige defaults; overskriv
 * eller tilføj pr. test via `custom` (nøgle = path efter /api/, værdi = JSON-body).
 * Ukendte stier svarer tomt `{}` 200, så intet view crasher på en 404.
 */
export async function installApiMock(
  page: Page,
  custom: Record<string, unknown> = {},
): Promise<void> {
  const defaults: Record<string, unknown> = {
    "auth/status": { authenticated: true, user: ADMIN, default_language: "da" },
    "auth/refresh": { expires_at: futureIso(), auth_type: "local", user: ADMIN },
    "auth/me": ADMIN,
    "health": { status: "ok", full: "6.31.0740" },
    "alerts": { count: 0, has_errors: false },
    "me/prefs": {},
    "me/views": [],
    // Browse-load læser disse direkte (uden shape-guard) → giv korrekte tomme former.
    "custom-attributes": { attributes: [] },
    "groups": [],
    "dacls": [],
    "endpoint-roles": { roles: [] },
    "platform-mapping": { mappings: [] },
    "endpoints/details": { items: [], total: 0 },
    "endpoints/stats": { laa_count: 0 },
  };
  const map = { ...defaults, ...custom };
  const keys = Object.keys(map).sort((a, b) => b.length - a.length); // længste-præfiks først

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\//, "");
    const key = keys.find((k) => path === k || path.startsWith(k));
    const body = key ? map[key] : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
