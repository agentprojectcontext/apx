// `apx update` has to leave the daemon running the version it just installed.
//
// It did not. It asked `apx daemon status --json` whether the daemon was up — a
// flag that command never had — so the parse always failed and the answer was
// always "no". The daemon was never stopped and never restarted: npm replaced
// the files under a process still holding the old code, the panel kept showing
// the old version through F5, and the agents and chats went missing until a
// manual `apx restart`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { daemonPlan } from "#interfaces/cli/commands/update.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(ROOT, "src/interfaces/cli/commands/update.js"), "utf8");

test("a running daemon is restarted onto the new install", () => {
  for (const platform of ["darwin", "linux"]) {
    assert.deepEqual(daemonPlan({ running: true, platform }), { stopBefore: false, after: "restart" });
  }
});

test("outside Windows the daemon is not stopped before the install", () => {
  // launchd/systemd respawn a stopped daemon at once — from the tree npm is
  // still in the middle of replacing.
  assert.equal(daemonPlan({ running: true, platform: "darwin" }).stopBefore, false);
});

test("on Windows it is stopped first, because Node holds its files open", () => {
  assert.deepEqual(daemonPlan({ running: true, platform: "win32" }), { stopBefore: true, after: "start" });
});

test("a daemon that was not running is left alone", () => {
  assert.deepEqual(daemonPlan({ running: false, platform: "darwin" }), { stopBefore: false, after: null });
});

test("whether the daemon runs is asked of the daemon, not parsed from CLI output", () => {
  // `apx daemon status` prints a coloured block for a person to read. Parsing
  // it was the bug; asking /api/health is what every other command does.
  assert.doesNotMatch(source, /"status",\s*"--json"/);
  assert.match(source, /daemonPlan\(\{\s*running:\s*await http\.ping\(\)\s*\}\)/);
  assert.match(source, /spawnSync\("apx", \["restart"\]/);
});
