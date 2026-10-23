import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { COVERAGE_CHUNKS_FILE } from "../../scripts/coverage-maps.ts";
import { buildVersion } from "../../scripts/version.ts";

const core = process.env.APX_URL ?? "http://127.0.0.1:7440";

const coverageProvenance: Plugin = {
  name: "coverage-chunk-provenance",
  apply: "build",
  generateBundle(_options, bundle) {
    if (process.env.APX_TEST_COVERAGE !== "1") return;
    const chunks = Object.fromEntries(
      Object.values(bundle).flatMap((entry) => (entry.type === "chunk" ? [[entry.fileName, entry.moduleIds]] : [])),
    );
    this.emitFile({ type: "asset", fileName: COVERAGE_CHUNKS_FILE, source: JSON.stringify(chunks) });
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  return {
    plugins: [react(), coverageProvenance],
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
      sourcemap: process.env.APX_TEST_COVERAGE === "1",
      // Agent avatars stay files: fetched and cached as images, never inlined as base64 into the first script.
      assetsInlineLimit: (file) => (file.endsWith(".webp") ? false : undefined),
      // What the first page imports is one chunk: otherwise each module a lazy screen also uses becomes a small chunk
      // of its own, fetched and compressed apart (the perf budget's initial bundle). The rest of the data layer is one
      // chunk too, not a dozen tiny ones the screens fetch one by one.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // The panel updater identifies its entry through the shared index-*.js contract.
              { name: "index", tags: ["$initial"] },
              { name: "data", test: /apps\/web\/src\/data\//, minShareCount: 2 },
            ],
          },
        },
      },
    },
    server: {
      port: 7441,
      proxy:
        env.VITE_APX_INBOX_PREVIEW === "1"
          ? undefined
          : {
              "/rpc": core,
              "/health": core,
              // Published surfaces (surfaces.share → /a/<token>).
              "/a/": core,
              // The APX Kit, for pages opened outside a widget frame (inside one it is already inline).
              "/_apx/": core,
              "/ws": { target: core.replace(/^http/, "ws"), ws: true },
            },
    },
  };
});
