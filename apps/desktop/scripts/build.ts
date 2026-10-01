// Bundles main (ESM) and the panel preload (CJS: sandboxed preloads cannot be ESM) into dist/.
import fs from "node:fs";
import path from "node:path";
import { type BuildOptions, build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });

const common: BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "warning",
};
await build({
  ...common,
  entryPoints: [path.join(root, "src/main/main.ts")],
  outfile: path.join(out, "main.js"),
  format: "esm",
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/panel/preload.ts")],
  outfile: path.join(out, "panel-preload.cjs"),
  format: "cjs",
});
console.log("built apps/desktop/dist");
