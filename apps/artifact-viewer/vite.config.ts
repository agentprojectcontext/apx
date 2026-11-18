import { defineConfig, loadEnv } from "vite";
import { viewerConfig } from "./src/config.ts";

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      {
        name: "artifact-target",
        configResolved() {
          viewerConfig({ ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env });
        },
      },
    ],
    build: { sourcemap: true },
    server: { port: 7496, strictPort: true },
  };
});
