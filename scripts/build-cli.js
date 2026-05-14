#!/usr/bin/env node
// Build script: compiles src/cli-ts/ and src/tui/ → dist/ using esbuild
import { build, context } from "esbuild";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { solidPlugin } from "esbuild-plugin-solid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const watch = process.argv.includes("--watch");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  "node:*",
];

// CLI management commands (no JSX)
const cliConfig = {
  entryPoints: [resolve(root, "src/cli-ts/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outdir: resolve(root, "dist/cli"),
  external,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
};

// TUI — bundle solid-js and @opentui/* so esbuild resolves browser builds
const tuiExternal = external.filter(
  (e) => !e.startsWith("solid-js") && !e.startsWith("@opentui")
);
const tuiConfig = {
  entryPoints: [resolve(root, "src/tui/launch.ts")],
  bundle: true,
  platform: "browser",
  target: "node18",
  format: "esm",
  outdir: resolve(root, "dist/tui"),
  external: tuiExternal,
  conditions: ["browser", "import"],
  plugins: [solidPlugin()],
  logLevel: "info",
};

if (watch) {
  const [ctxCli, ctxTui] = await Promise.all([
    context(cliConfig),
    context(tuiConfig),
  ]);
  await Promise.all([ctxCli.watch(), ctxTui.watch()]);
  console.log("Watching src/cli-ts/ and src/tui/ for changes...");
} else {
  await Promise.all([build(cliConfig), build(tuiConfig)]);
  console.log("Build complete → dist/cli/  dist/tui/");
}
