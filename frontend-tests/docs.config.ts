import { defineConfig, devices } from "@playwright/test";

// Genererer manualens skærmbilleder (docs/img/*.png) mod SPA'en med mocket API.
// Kør:  npx playwright test -c docs.config.ts   (ikke en del af smoke-suiten)
export default defineConfig({
  testDir: "./docs-shots",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8080",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "da-DK",
  },
  webServer: {
    command: "python -m http.server 8080 --directory ../frontend",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
