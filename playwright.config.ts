import { defineConfig, devices } from "@playwright/test";
import { claimSandbox } from "./e2e/sandbox.ts";

// The whole app against its own core (e2e/env.ts): a temp home, a fake model and an emulated Telegram. One worker,
// files in order: they share that core, as one owner would, from the first-run setup on. CI splits the files into
// parts (`--shard`), each with a core of its own, so what every spec may build on is the setup project's: the first
// run, the owner's Telegram and the WhatsApp line, replayed first in every part. Nothing else carries across specs.
// Free ports and an id of this run's own: a core already on a usual port (a scratch one, another checkout's) is never
// the one the specs talk to.
await claimSandbox();
const port = Number(process.env.E2E_PORT);
// A machine with another Chromium than the one this Playwright pins (a container, a distro package) names it here.
const executablePath = process.env.E2E_CHROMIUM || undefined;
const SETUP = /(01-setup|06-telegram|10-whatsapp)\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
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
    launchOptions: { executablePath },
  },
  projects: [
    { name: "setup", testDir: "e2e/specs", testMatch: SETUP, use: { ...devices["Desktop Chrome"], locale: "es-AR" } },
    {
      name: "chromium",
      testDir: "e2e/specs",
      testIgnore: SETUP,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], locale: "es-AR" },
    },
    // The Electron app itself (`pnpm e2e:desktop`; on Linux under a display such as xvfb-run).
    { name: "desktop", testDir: "e2e/desktop", timeout: 60_000 },
  ],
  webServer: {
    command: "node --no-warnings e2e/env.ts",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
  },
});
