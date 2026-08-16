import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Vite config for the APX admin panel.
//
// - Single SPA, no SSR (this is a local admin tool).
// - During `vite dev`, /api is proxied to the running daemon so we develop the
//   UI with hot reload against REAL data. Frontend routes (/, /settings,
//   /p/:id) live outside /api, so vite serves index.html for them (SPA
//   routing). `ws: true` also carries the /api/desktop/ws upgrade through.
// - `vite build` emits to ./dist; the daemon serves that folder when present.
//
// This used to be a hand-maintained list of every daemon prefix, kept in sync
// by hand with two other copies (the SPA fallback and the auth allowlist) —
// and it drifted. Now the daemon mounts everything under /api
// (src/host/daemon/api/prefix.js), so one entry covers the whole surface and
// a new route can never be missed here.

const DAEMON_TARGET = process.env.APX_DAEMON_URL || "http://127.0.0.1:7430";

const proxy = {
  "/api": { target: DAEMON_TARGET, changeOrigin: false, ws: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 7431,
    strictPort: false,
    proxy,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
