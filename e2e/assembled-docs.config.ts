import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./preview/assembled-docs",
  outputDir: "../test-results/assembled-docs",
  workers: 1,
  use: { reducedMotion: "reduce" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
