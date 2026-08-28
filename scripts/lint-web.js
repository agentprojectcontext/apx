#!/usr/bin/env node
// Ratcheting lint for the web panel.
//
// Background: the panel is its own pnpm workspace and the root eslint.config.js
// ignores it wholesale, so ~47k lines of TS/TSX had a type check and no linter
// at all. Turning one on found 13 errors and 38 warnings. The errors included
// two real crashes — a React hook called after an early return, in two separate
// components — that tsc cannot see by construction.
//
// The errors are fixed and stay at zero: eslint's own exit code enforces that,
// and this script does not soften it. What this script adds is a ceiling on the
// WARNINGS, which are the two categories that need per-site judgment rather
// than a blanket fix:
//
//   @typescript-eslint/no-explicit-any   — typing work
//   react-hooks/exhaustive-deps          — each one is a decision about whether
//                                          the effect should re-run
//
// Clearing 38 of those in the same change that installs the linter would be a
// refactor wearing a guardrail's clothes. So they ratchet, exactly like the
// vendored TUI's type errors do in typecheck-tui.js: the count may fall freely,
// any increase fails the build. Lower BASELINE when you fix some — never raise
// it to make a build pass.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = path.join(REPO, "src", "interfaces", "web");
const BASELINE = 32;

const res = spawnSync("npx", ["--no-install", "eslint", ".", "-f", "json"], {
  cwd: PANEL,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  // No parseable report means eslint itself failed to run — a missing install,
  // a broken config, a crash. That is the silent-failure mode this script has
  // to treat as fatal: "0 problems" from a linter that never ran looks green.
  console.error("lint:web: eslint did not produce a report — it failed to run.\n");
  console.error((res.stderr || res.stdout || "(no output)").trim().slice(0, 4000));
  console.error("\nIs the panel installed? cd src/interfaces/web && pnpm install");
  process.exit(1);
}

const problems = report.flatMap((f) =>
  f.messages.map((m) => ({
    where: `${path.relative(PANEL, f.filePath)}:${m.line}`,
    rule: m.ruleId || "(unused eslint-disable)",
    text: m.message,
    error: m.severity === 2,
  })),
);

const errors = problems.filter((p) => p.error);
const warnings = problems.filter((p) => !p.error);
const line = (p) => `  ${p.where}  [${p.rule}] ${p.text}`;

// Errors are absolute. There is no baseline for them, by design.
if (errors.length) {
  console.error(`lint:web: ${errors.length} error(s). These are not ratcheted — fix them.\n`);
  console.error(errors.slice(0, 40).map(line).join("\n"));
  process.exit(1);
}

if (warnings.length > BASELINE) {
  console.error(
    `lint:web: ${warnings.length} warnings, baseline is ${BASELINE} — ${warnings.length - BASELINE} new.\n`,
  );
  console.error(warnings.slice(0, 40).map(line).join("\n"));
  console.error(
    `\nFix the new warnings. Do not raise BASELINE in ${path.relative(REPO, fileURLToPath(import.meta.url))}.`,
  );
  process.exit(1);
}

if (warnings.length < BASELINE) {
  console.log(
    `lint:web: 0 errors, ${warnings.length} warnings (baseline ${BASELINE}) — ` +
      `${BASELINE - warnings.length} fixed. Lower BASELINE to ${warnings.length} to lock the win in.`,
  );
} else {
  console.log(`lint:web: 0 errors, ${warnings.length} warnings, at baseline.`);
}
