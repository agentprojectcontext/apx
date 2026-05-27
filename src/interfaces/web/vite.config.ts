import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite config for the APX admin panel.
//
// - Single SPA, no SSR (this is a local admin tool).
// - During `vite dev`, proxy /api → the running daemon on :7430 so we can
//   develop the UI with hot reload while talking to the real APX daemon.
// - `vite build` emits to ./dist; the daemon serves that folder when present.
export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 7431,
    strictPort: false,
    proxy: {
      "/api":      { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/projects": { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/telegram": { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/engines":  { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/runtimes": { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/messages": { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/sessions": { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/tools":    { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/admin":    { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/voice":    { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/tts":      { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/overlay":  { target: "http://127.0.0.1:7430", changeOrigin: false },
      "/health":   { target: "http://127.0.0.1:7430", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
