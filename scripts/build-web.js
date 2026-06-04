#!/usr/bin/env node
// Build the APX admin web bundle into src/interfaces/web/dist/ so the
// daemon's GET / serves the latest UI. Runs in `prepack` (so `npm install
// -g .` / `npm pack` always ship a fresh bundle) and is also exposed as the
// `build:web` script so anyone can re-run it on demand without remembering
// the cd dance.
//
// We deliberately install the web's deps first — the web package.json is
// NOT part of any pnpm workspace, so a fresh clone has no node_modules in
// src/interfaces/web/. The install is idempotent + cached, so re-runs are
// fast when nothing changed.
//
// SKIP it with APX_SKIP_WEB_BUILD=1 (useful for routine dev tarball flows
// that don't touch UI code).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.APX_SKIP_WEB_BUILD) {
  console.log("build-web: skipped (APX_SKIP_WEB_BUILD set)");
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "src", "interfaces", "web");

// pnpm preferred (matches the rest of the repo); fall back to npm if pnpm
// isn't on PATH for whoever happens to be packaging.
const PKG_MGR = (() => {
  const probe = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
  return probe.status === 0 ? "pnpm" : "npm";
})();

function run(cmd, args, label) {
  console.log(`build-web: ${label}…`);
  const r = spawnSync(cmd, args, { cwd: WEB_DIR, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`build-web: ${label} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

run(PKG_MGR, ["install", "--prefer-offline"], `installing web deps via ${PKG_MGR}`);
run(PKG_MGR, ["run", "build"], "vite build");
console.log("build-web: dist/ is fresh ✓");
