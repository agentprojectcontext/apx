#!/usr/bin/env node
// The everyday test run: `npm test`.
//
// Two things it does that a bare `node --test tests/*.test.js` did not.
//
// 1. An isolated HOME. Otherwise the suite runs against the developer's real
//    ~/.apx — reading the config on this machine, writing into the ledger the
//    running daemon uses, and racing itself over both, since the runner
//    executes files in parallel. That is where the admin-reload and
//    commitments-api flakes came from.
// 2. Recursive discovery, matching test:ci. The old single-level glob meant the
//    first `tests/core/foo.test.js` anyone added would be silently skipped in
//    the dev loop and only noticed in CI.
//
// Extra arguments are passed through as the file list, so
// `npm test -- tests/config.test.js` runs one file with the same isolation.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTests, makeTestHome } from "./lib/test-home.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const files = args.length ? args : findTests(path.join(REPO, "tests"), REPO);

if (!files.length) {
  console.error("test: no test files found under tests/");
  process.exit(1);
}

const sandbox = makeTestHome("apx-test-home");
const child = spawn(process.execPath, ["--test", "--test-reporter=spec", ...files], {
  cwd: REPO,
  stdio: "inherit",
  env: sandbox.env,
});
child.on("close", (code) => {
  sandbox.cleanup();
  process.exit(code ?? 1);
});
