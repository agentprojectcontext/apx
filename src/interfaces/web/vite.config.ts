import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Vite config for the APX admin panel.
//
// - Single SPA, no SSR (this is a local admin tool).
// - During `vite dev`, every daemon API prefix is proxied to the running
//   daemon so we develop the UI with hot reload against REAL data. Frontend
//   routes (/, /settings, /p/:id) are NOT listed, so vite serves index.html
//   for them (SPA routing).
// - `vite build` emits to ./dist; the daemon serves that folder when present.

const DAEMON_TARGET = process.env.APX_DAEMON_URL || "http://127.0.0.1:7430";

// Keep in sync with API_PREFIXES in src/host/daemon/api/shared.js — that's the
// source of truth for what is a daemon route. A missing prefix means `vite dev`
// silently serves the SPA shell for that call instead of the real response
// (e.g. an empty /pair/list).
const API_PREFIXES = [
  "/health", "/admin", "/projects", "/telegram", "/engines", "/runtimes",
  "/messages", "/sessions", "/tools", "/mcp", "/voice", "/tts", "/overlay",
  "/transcribe", "/run", "/files", "/memory", "/env", "/pair", "/deck",
  "/super-agent", "/identity", "/agents", "/tasks",
];

const proxy = Object.fromEntries(
  API_PREFIXES.map((p) => [p, { target: DAEMON_TARGET, changeOrigin: false, ws: true }])
);

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
