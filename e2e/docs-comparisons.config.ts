import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./preview/docs",
  outputDir: "../test-results/docs-comparisons",
  use: { baseURL: "http://127.0.0.1:4410", reducedMotion: "reduce" },
  projects: [
    // Titles tagged @desktop or @phone, and phone.spec.ts, run only in that project.
    {
      name: "desktop",
      grepInvert: /@phone/,
      testIgnore: /phone\.spec\.ts/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "phone",
      grepInvert: /@desktop/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: "pnpm --dir apps/docs exec astro preview --host 127.0.0.1 --port 4410",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: "http://127.0.0.1:4410/compare/",
    reuseExistingServer: true,
  },
});
