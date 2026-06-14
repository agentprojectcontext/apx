// Integration tests for the CLI version/update BANNER wiring.
//
// Regression guard for QA finding BUG-BRAND-1/2 (v1.36.0): the branding helpers
// existed but `apx --version` and `apx update` did not show the big ASCII
// wordmark. These tests pin the wiring:
//   - `apx --version` prints the bare version to STDOUT (scripts parse it)
//     AND the big banner to STDERR (humans see the brand).
//   - APX_QUIET / APX_NO_BANNER suppress the banner but keep the bare version.
//   - `apx update` shows the banner before doing anything.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI = path.join(__dirname, "..", "src", "interfaces", "cli", "index.js");
const ROOT = path.join(__dirname, "..");

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// The banner is box-drawing ASCII art. Match a char that only appears there.
const BANNER_RE = /█|╗|╝/;
const SEMVER_RE = /^\d+\.\d+\.\d+/m;

test("`apx --version` prints bare version to stdout and the banner to stderr", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  // stdout: bare, parseable version — NO banner art
  assert.match(r.stdout, SEMVER_RE, "stdout should carry the bare version");
  assert.doesNotMatch(r.stdout, BANNER_RE, "stdout must stay clean (no banner art) for scripts");
  // stderr: the big wordmark
  assert.match(r.stderr, BANNER_RE, "stderr should carry the big ASCII banner");
  assert.match(r.stderr, /Agent Project Context/, "banner should name the product");
});

test("`apx -v` alias behaves the same", () => {
  const r = run(["-v"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, SEMVER_RE);
  assert.match(r.stderr, BANNER_RE);
});

test("APX_QUIET suppresses the banner but keeps the bare version", () => {
  const r = run(["--version"], { APX_QUIET: "1" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, SEMVER_RE, "version still printed for scripts");
  assert.doesNotMatch(r.stderr, BANNER_RE, "APX_QUIET must silence the banner");
});

test("APX_NO_BANNER suppresses the banner too", () => {
  const r = run(["--version"], { APX_NO_BANNER: "1" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, SEMVER_RE);
  assert.doesNotMatch(r.stderr, BANNER_RE);
});

// `apx update` reaches the network to check npm; we don't want that in CI, so
// we only assert the banner is emitted to stderr BEFORE the check. We force
// APX_NO_BANNER off and give it a tiny timeout-free run by stubbing the
// registry via env is overkill — instead assert on the synchronous banner that
// prints before any await. We bound the run so a slow registry can't hang us.
test("`apx update` emits the big banner before checking", () => {
  const r = spawnSync(process.execPath, [CLI, "update"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env },
    input: "n\n", // decline any prompt
  });
  // Regardless of network outcome, the banner is printed synchronously first.
  assert.match(r.stderr, BANNER_RE, "update should show the banner on stderr");
});
