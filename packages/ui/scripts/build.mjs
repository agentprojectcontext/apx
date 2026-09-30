// Build @apx/ui: ESM bundle (deps external) + .d.ts tree + one stylesheet.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  external: [...Object.keys(pkg.peerDependencies ?? {}), ...Object.keys(pkg.dependencies ?? {}), "react/jsx-runtime"],
  logLevel: "warning",
});

execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.json", "--emitDeclarationOnly"], { stdio: "inherit" });

const css = ["tokens.css", "components.css"].map((f) => readFileSync(`src/styles/${f}`, "utf8")).join("\n");
writeFileSync("dist/styles.css", css);
console.log("built dist/ (index.js, index.d.ts, styles.css)");
