import { defineConfig, devices } from "@playwright/test";

// Smoke-tests kører mod SPA'en serveret statisk fra ../frontend. Alle /api/**-kald
// mockes i den enkelte test (se fixtures.ts) — ingen live backend eller ISE kræves.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Statisk fil-server for frontend/. Python er allerede en projekt-afhængighed.
    command: "python -m http.server 8080 --directory ../frontend",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
