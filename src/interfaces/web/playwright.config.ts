import { defineConfig, devices } from "@playwright/test";

// E2E config for the APX web admin panel.
//
// Runs against `vite dev` on :7431, which proxies every daemon API prefix to
// the real daemon on :7430 (see vite.config.ts). Auth is automatic: the panel
// fetches /admin/web-token over the loopback proxy, and the fixture also seeds
// localStorage with the token captured in global-setup.
//
// global-setup registers a throwaway project (temp dir + `apx init`) so the
// mutating CRUD specs never touch the user's real projects; global-teardown
// unregisters it and removes the temp dir.
const WEB_URL = process.env.APX_WEB_URL || "http://localhost:7431";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // CRUD specs share one throwaway project and assert on ordered state, so we
  // run serially with a single worker rather than in parallel.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/.playwright-report" }],
    ["./e2e/reporter-dated.ts"],
  ],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm exec vite --port 7431 --strictPort",
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
