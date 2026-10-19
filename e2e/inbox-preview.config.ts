import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./preview",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:7491", locale: "en-US", screenshot: "only-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: "node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 7491 --strictPort",
    env: { VITE_APX_INBOX_PREVIEW: "1" },
    url: "http://127.0.0.1:7491",
    reuseExistingServer: !process.env.CI,
  },
});
