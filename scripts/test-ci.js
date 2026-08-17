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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = path.join(REPO, "tests");

function findTests(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(abs));
    else if (entry.name.endsWith(".test.js")) out.push(path.relative(REPO, abs));
  }
  return out.sort();
}

const files = findTests(TESTS);
if (!files.length) {
  console.error("test:ci: no test files found under tests/");
  process.exit(1);
}

// Ratchet. Raise these when coverage improves; never lower them. Node reports
// line/branch/function percentages over everything it loaded.
const COVERAGE_FLOOR = { line: 72, branch: 71, function: 64 };

const child = spawn(
  process.execPath,
  ["--test", "--experimental-test-coverage", "--test-reporter=spec", ...files],
  { cwd: REPO, stdio: ["inherit", "pipe", "inherit"] }
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});

child.on("close", (code) => {
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
