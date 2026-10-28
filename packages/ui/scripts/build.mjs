// Build @apx/ui: split ESM bundle (deps external) + .d.ts tree + one stylesheet.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

// Every component is an entry, split into its own file: a component the panel never imports is then dropped whole,
// instead of riding in one module into its first screen.
const components = Object.fromEntries(
  readdirSync("src/components")
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => [`components/${f.slice(0, -4)}`, `src/components/${f}`]),
);
// The ACP agents', model APIs' and integrations' marks are an entry of their own: the panel loads them after its
// first screen.
await build({
  entryPoints: { index: "src/index.ts", marks: "src/marks.ts", ...components },
  outdir: "dist",
  bundle: true,
  splitting: true,
  // Shared code lands beside index.js, where the blob bodies' relative URLs resolve.
  chunkNames: "[name]-[hash]",
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  external: [...Object.keys(pkg.peerDependencies ?? {}), ...Object.keys(pkg.dependencies ?? {}), "react/jsx-runtime"],
  logLevel: "warning",
});

// Blob bodies are named by `new URL("./bodies/…", import.meta.url)`: the same path from src/blobs and from dist.
cpSync("src/blobs/bodies", "dist/bodies", { recursive: true });

// tsc through node: node_modules/.bin/tsc is a shell script, which Windows cannot run directly.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.json", "--emitDeclarationOnly"], { stdio: "inherit" });

// components.css only lists the per-area sheets; inline them in that order so dist/ stays one file.
const sheets = [...readFileSync("src/styles/components.css", "utf8").matchAll(/@import "\.\/(.+?)";/g)].map(
  (m) => m[1],
);
const css = ["tokens.css", ...sheets].map((f) => readFileSync(`src/styles/${f}`, "utf8")).join("\n");
writeFileSync("dist/styles.css", css);
// Flow steps and run bars are only on the Flows screens, which load late: their sheet stays off the first load.
writeFileSync("dist/flow.css", readFileSync("src/styles/components/flow.css", "utf8"));
console.log("built dist/ (index.js, index.d.ts, styles.css, flow.css)");
