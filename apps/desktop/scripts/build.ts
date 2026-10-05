// Bundles main (ESM) and the panel preload (CJS: sandboxed preloads cannot be ESM) into dist/.
import fs from "node:fs";
import path from "node:path";
import { type BuildOptions, build } from "esbuild";
import { buildVersion } from "../../../scripts/version.ts";

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
  define: {
    APX_VERSION: JSON.stringify(
      buildVersion(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version, root),
    ),
  },
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
// The menu-bar icon (a macOS template image: black on transparent, tinted by the system).
for (const f of ["trayTemplate.png", "trayTemplate@2x.png", "icon.png"])
  fs.copyFileSync(path.join(root, "assets", f), path.join(out, f));
console.log("built apps/desktop/dist");
