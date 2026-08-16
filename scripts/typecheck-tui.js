#!/usr/bin/env node
// Ratcheting typecheck for the vendored OpenCode TUI.
//
// Background: src/interfaces/tui/tsconfig.json extended a `tsconfig.cli.json`
// that had never been committed, so `tsc -p` failed to load its config at all.
// ~24k lines across 152 files were unverifiable, and since nothing ran the
// check, the breakage was invisible. The config is fixed; the fork it wraps
// still has type mismatches against @opentui / the opencode SDK shims.
//
// Fixing all of them at once in vendored code is out of proportion and risky
// (the shims are deliberately `any`). So this gate is a ratchet: the error
// count may go DOWN freely, and any increase fails. Lower BASELINE whenever
// you fix errors — never raise it.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "src/interfaces/tui";
const BASELINE = 176;

const res = spawnSync(
  "npx",
  ["--no-install", "tsc", "-p", PROJECT, "--noEmit"],
  { cwd: REPO, encoding: "utf8" }
);

const output = `${res.stdout || ""}${res.stderr || ""}`;
const errors = output.split("\n").filter((l) => /error TS\d+/.test(l));
const count = errors.length;

// A config that fails to load reports TS5083/TS6053 and zero real diagnostics —
// exactly the silent failure this script exists to prevent. Treat it as fatal
// regardless of the count.
if (/error TS(5083|6053)/.test(output)) {
  console.error("tui typecheck: tsconfig failed to load\n");
  console.error(output.trim());
  process.exit(1);
}

if (count > BASELINE) {
  console.error(
    `tui typecheck: ${count} errors, baseline is ${BASELINE} — ${count - BASELINE} new.\n`
  );
  console.error(errors.slice(0, 40).join("\n"));
  console.error(
    `\nFix the new errors. Do not raise BASELINE in ${path.relative(REPO, fileURLToPath(import.meta.url))}.`
  );
  process.exit(1);
}

if (count < BASELINE) {
  console.log(
    `tui typecheck: ${count} errors (baseline ${BASELINE}) — ${BASELINE - count} fixed. ` +
      `Lower BASELINE to ${count} to lock the win in.`
  );
} else {
  console.log(`tui typecheck: ${count} errors, at baseline.`);
}
