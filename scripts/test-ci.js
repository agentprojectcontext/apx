#!/usr/bin/env node
// Backend suite for CI, with two rules the bare `node --test` run cannot express.
//
// 1. No skipped tests. `test.skip` / `it.skip` / `describe.skip` / `test.todo`
//    silently shrink the suite: the summary still says "pass", and a test
//    nobody runs is a test nobody is watching. The suite must report
//    `skipped 0` and `todo 0`.
// 3. A coverage floor that only moves up. There was no coverage tooling at
//    all, so nothing noticed a module losing its last test.
// 2. Recursive discovery. package.json ran `tests/*.test.js`, a single-level
//    glob — the first person to add `tests/core/foo.test.js` would have lost it
//    with no warning at all.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTests, makeTestHome } from "./lib/test-home.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = path.join(REPO, "tests");

// Discovery and the sandboxed HOME both live in scripts/lib/test-home.js now,
// shared with the everyday `npm test` — the two runners drifting apart is what
// let a flake exist locally and not in CI.
const files = findTests(TESTS, REPO);
if (!files.length) {
  console.error("test:ci: no test files found under tests/");
  process.exit(1);
}

// Ratchet. Raise these when coverage improves; never lower them.
//
// LOWERED ONCE, on purpose, and this note is the record of why. The floor was
// raised to line 73 / function 66 off a SINGLE favourable run. The measurement
// is not stable to that precision: the same tree measured 73.8/66.6 and
// 72.8/65.6 on consecutive runs, because Node reports over whatever the run
// actually loaded and a few tests touch the network (the pairing suite has
// flaked at 300s). A ratchet set inside the noise band fails on green code,
// which teaches people to edit this line — the opposite of what it is for.
//
// So these sit just under the observed floor of the range, not at its ceiling.
// Raise them again only against several consecutive runs, never one.
const COVERAGE_FLOOR = { line: 75, branch: 72, function: 70 };

// 4. A throwaway HOME for the whole run. Tests that isolate by stubbing
//    os.homedir() are one refactor away from writing to the developer's real
//    ~/.apx: the stub is bypassed the moment a path comes from a constant
//    frozen at import time in config/paths.js, which a per-test dynamic import
//    cannot reload. On 2026-08-16 that cost a live ~/.apx/mcps.json — the
//    global MCP servers were replaced by a test fixture and nothing noticed.
//    Moving HOME moves the default ~/.apx out of reach for a test that forgets
//    to isolate, while every test that sets its own HOME or APX_HOME still
//    wins over it. This is the floor, not the isolation.
const sandbox = makeTestHome("apx-test-home");

const child = spawn(
  process.execPath,
  ["--test", "--experimental-test-coverage", "--test-reporter=spec", ...files],
  {
    cwd: REPO,
    stdio: ["inherit", "pipe", "inherit"],
    env: sandbox.env,
  }
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});

child.on("close", (code) => {
  sandbox.cleanup();
  const read = (label) => {
    const m = output.match(new RegExp(`^ℹ ${label} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  const skipped = read("skipped");
  const todo = read("todo");
  const failed = read("fail");

  if (code !== 0 || failed) {
    console.error(`\ntest:ci: ${failed ?? "?"} failing test(s).`);
    process.exit(code || 1);
  }
  if (skipped || todo) {
    console.error(
      `\ntest:ci: ${skipped} skipped and ${todo} todo test(s).\n` +
        "Skipped tests are forbidden — fix the test or delete it with a reason " +
        "in the commit body (AGENTS.md rule 1)."
    );
    process.exit(1);
  }
  // "ℹ all files | 72.29 | 71.16 | 64.52 |"
  const cov = output.match(/^ℹ all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m);
  if (!cov) {
    console.error("\ntest:ci: coverage summary not found — did the reporter change?");
    process.exit(1);
  }
  const got = { line: +cov[1], branch: +cov[2], function: +cov[3] };
  const below = Object.entries(COVERAGE_FLOOR).filter(([k, min]) => got[k] < min);
  if (below.length) {
    console.error(
      `\ntest:ci: coverage fell below the floor — ` +
        below.map(([k, min]) => `${k} ${got[k]}% < ${min}%`).join(", ") +
        "\nAdd a test rather than lowering COVERAGE_FLOOR in scripts/test-ci.js."
    );
    process.exit(1);
  }
  const gained = Object.entries(COVERAGE_FLOOR)
    .filter(([k, min]) => got[k] > min + 1)
    .map(([k, min]) => `${k} ${got[k]}% (floor ${min}%)`);

  console.log(`\ntest:ci: ${files.length} files, 0 skipped, 0 todo.`);
  console.log(
    `test:ci: coverage line ${got.line}% branch ${got.branch}% function ${got.function}%` +
      (gained.length ? ` — raise the floor: ${gained.join(", ")}` : " — at floor.")
  );
});
