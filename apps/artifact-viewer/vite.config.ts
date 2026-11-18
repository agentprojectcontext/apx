import { defineConfig } from "vite";

export default defineConfig({
  build: { sourcemap: true },
  server: { port: 7496, strictPort: true },
});
