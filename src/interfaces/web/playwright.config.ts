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
  // Retries on CI, none locally.
  //
  // This suite drives a real browser against a real daemon, single-worker, and
  // the heaviest spec (16-task-workspace) runs last — so on a runner ~2.5x
  // slower than a laptop it loses races a developer never sees: a `fill` that
  // React overwrites mid-render, a click on a button that is re-rendering
  // underneath it. Three consecutive CI runs failed at three DIFFERENT points
  // of the same spec while the whole suite passed 77/77 locally, which is the
  // signature of a timing margin, not of a broken screen.
  //
  // A retry does not hide a real break: a genuine one fails all three attempts.
  // What it does fix is the diagnostic gap — `trace: "on-first-retry"` below was
  // already written as if retries existed, so with none configured NO trace was
  // ever captured on CI and every failure arrived as a bare screenshot.
  //
  // Zero locally on purpose: a flake in front of the person who wrote it should
  // be visible, not smoothed over.
  retries: process.env.CI ? 2 : 0,
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
