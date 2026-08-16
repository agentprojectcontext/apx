#!/usr/bin/env node
// Backend suite for CI, with two rules the bare `node --test` run cannot express.
//
// 1. No skipped tests. `test.skip` / `it.skip` / `describe.skip` / `test.todo`
//    silently shrink the suite: the summary still says "pass", and a test
//    nobody runs is a test nobody is watching. The suite must report
//    `skipped 0` and `todo 0`.
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

const child = spawn(
  process.execPath,
  ["--test", "--test-reporter=spec", ...files],
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
  console.log(`\ntest:ci: ${files.length} files, 0 skipped, 0 todo.`);
});
