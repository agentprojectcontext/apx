import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildVersion } from "../../scripts/version.ts";

const core = process.env.APX_URL ?? "http://127.0.0.1:7440";

export default defineConfig({
  plugins: [react()],
  define: {
    // The build's own version when pnpm package names it (APX_VERSION), else the last tag and the commits past it.
    "import.meta.env.VITE_APX_VERSION": JSON.stringify(
      process.env.APX_VERSION ||
        buildVersion(
          JSON.parse(fs.readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")).version,
          import.meta.dirname,
        ),
    ),
    // "beta" while v2 is not yet the release people get by default (release.yml sets it).
    "import.meta.env.VITE_APX_CHANNEL": JSON.stringify(process.env.APX_CHANNEL ?? ""),
  },
  build: {
    // Agent avatars stay files: fetched and cached as images, never inlined as base64 into the first script.
    assetsInlineLimit: (file) => (file.endsWith(".webp") ? false : undefined),
    // The data layer is one chunk, not a dozen tiny ones the first screen fetches one by one.
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: "data", test: /apps\/web\/src\/data\//, minShareCount: 2 }] } },
    },
  },
  server: {
    port: 7441,
    proxy: {
      "/rpc": core,
      "/health": core,
      // Published surfaces (surfaces.share → /a/<token>).
      "/a/": core,
      "/ws": { target: core.replace(/^http/, "ws"), ws: true },
    },
  },
});
