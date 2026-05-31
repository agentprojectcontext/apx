import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI = path.join(__dirname, "..", "src", "interfaces", "cli", "index.js");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
}

const stripAnsi = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");

test("`apx overlay --help` advertises the rename to `apx desktop`", () => {
  const result = run(["overlay", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx overlay \(deprecated\)/);
  assert.match(out, /Renamed to `apx desktop`/);
  assert.match(out, /still works and forwards/i);
});

test("`apx desktop --help` documents the floating window subcommands", () => {
  const result = run(["desktop", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx desktop/);
  assert.match(out, /start\b/);
  assert.match(out, /stop\b/);
  assert.match(out, /status\b/);
  assert.match(out, /install\b/);
  assert.match(out, /uninstall\b/);
});
