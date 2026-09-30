import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const core = process.env.APX_URL ?? "http://127.0.0.1:7440";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7441,
    proxy: {
      "/rpc": core,
      "/health": core,
      "/ws": { target: core.replace(/^http/, "ws"), ws: true },
    },
  },
});
