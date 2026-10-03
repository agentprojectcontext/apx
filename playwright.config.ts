import { defineConfig, devices } from "@playwright/test";

// The whole app against its own core (e2e/env.ts): a temp home, a fake model and an emulated Telegram. One worker,
// files in order: they share that core, as one owner would, from the first-run setup on.
const port = Number(process.env.E2E_PORT ?? 7460);

export default defineConfig({
  testDir: "e2e/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "es-AR",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], locale: "es-AR" } }],
  webServer: {
    command: "node --no-warnings e2e/env.ts",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
  },
});
