import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildVersion } from "../../scripts/version.ts";

const core = process.env.APX_URL ?? "http://127.0.0.1:7440";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APX_VERSION": JSON.stringify(
      buildVersion(
        JSON.parse(fs.readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")).version,
        import.meta.dirname,
      ),
    ),
  },
  build: {
    // Agent avatars stay files: fetched and cached as images, never inlined as base64 into the first script.
    assetsInlineLimit: (file) => (file.endsWith(".webp") ? false : undefined),
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
