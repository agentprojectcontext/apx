// One HTML at the end: APX shows a single self-contained page, so every script and style is inlined.
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: { outDir: "dist", assetsInlineLimit: 100_000_000, cssCodeSplit: false },
});
