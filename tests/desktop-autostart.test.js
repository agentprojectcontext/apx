// Tests for the autostart-at-login feature (`apx desktop install/uninstall`)
// and the launchd/Windows-Run/Linux-autostart helpers in
// src/interfaces/cli/commands/desktop.js.
//
// We test the pure helpers directly (getApxRunner, buildPlist,
// buildElectronSpawn, findElectron) and the CLI surface end-to-end via
// spawnSync. The CLI integration tests skip on platforms whose autostart
// surface we can't safely poke without admin/registry side-effects.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  getApxRunner,
  buildPlist,
  buildElectronSpawn,
  findElectron,
  autostartIsOn,
} from "#interfaces/cli/commands/desktop.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CLI        = path.join(__dirname, "..", "src", "interfaces", "cli", "index.js");
const stripAnsi  = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
}

// ── getApxRunner ─────────────────────────────────────────────────────────

test("getApxRunner returns [node, abs-path-to-cli/index.js]", () => {
  const [bin, cli] = getApxRunner();
  assert.equal(bin, process.execPath, "first entry must be the current node binary (launchd-safe)");
  assert.ok(path.isAbsolute(cli), "cli script path must be absolute");
  assert.ok(cli.endsWith(path.join("src", "interfaces", "cli", "index.js")),
    `cli script should resolve to src/interfaces/cli/index.js; got: ${cli}`);
  assert.ok(fs.existsSync(cli), "cli script must exist on disk");
});

test("getApxRunner is stable across calls", () => {
  assert.deepEqual(getApxRunner(), getApxRunner());
});

// ── buildPlist ───────────────────────────────────────────────────────────

test("buildPlist embeds all runner args + log path as <string> entries", () => {
  const runner  = ["/usr/local/bin/node", "/abs/cli.js"];
  const logFile = "/Users/me/.apx/desktop-autostart.log";
  const xml = buildPlist(runner, logFile);

  // Header + plist root
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<!DOCTYPE plist /);
  assert.match(xml, /<plist version="1\.0">/);

  // Label + ProgramArguments
  assert.match(xml, /<key>Label<\/key><string>dev\.apx\.desktop<\/string>/);
  assert.match(xml, /<key>ProgramArguments<\/key>/);
  assert.match(xml, /<array>\s*<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(xml, /<string>\/abs\/cli\.js<\/string>/);
  assert.match(xml, /<string>desktop<\/string>/);
  assert.match(xml, /<string>start<\/string>/);

  // RunAtLoad + KeepAlive + ProcessType
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key><false\/>/);
  assert.match(xml, /<key>ProcessType<\/key><string>Interactive<\/string>/);

  // Log paths
  assert.match(xml, new RegExp(`<key>StandardOutPath</key><string>${escapeRe(logFile)}</string>`));
  assert.match(xml, new RegExp(`<key>StandardErrorPath</key><string>${escapeRe(logFile)}</string>`));
});

test("buildPlist escapes XML metacharacters in args", () => {
  const runner = ["/bin/node", "/path with & < > \" '/cli.js"];
  const xml = buildPlist(runner, "/log.log");
  // Make sure raw chars do not appear; only their escaped equivalents
  assert.ok(!/<string>[^<]*&\s/.test(xml), "raw ampersand should be escaped");
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;/);
  assert.match(xml, /&gt;/);
  assert.match(xml, /&quot;/);
  assert.match(xml, /&apos;/);
});

// ── findElectron + buildElectronSpawn ────────────────────────────────────

test("findElectron returns either the .bin shim, electron/cli.js, a global bin, or 'npx'", () => {
  const d = findElectron();
  assert.equal(typeof d, "string");
  if (d === "npx") return; // CI / weird env — that's the documented last resort
  // .bin/electron, electron/cli.js, or a discovered absolute path — must exist
  assert.ok(d === "npx" || fs.existsSync(d), `candidate path should exist: ${d}`);
});

test("buildElectronSpawn(npx-sentinel) wraps with `npx -y electron`", () => {
  const { cmd, argv } = buildElectronSpawn("npx", "/abs/main.js", "7430");
  assert.equal(cmd, "npx");
  assert.deepEqual(argv, ["-y", "electron", "/abs/main.js", "--port", "7430"]);
});

test("buildElectronSpawn(cli.js) runs it under node so launchd's minimal PATH still works", () => {
  const { cmd, argv } = buildElectronSpawn("/abs/electron/cli.js", "/abs/main.js", "7430");
  assert.equal(cmd, process.execPath);
  assert.deepEqual(argv, ["/abs/electron/cli.js", "/abs/main.js", "--port", "7430"]);
});

test("buildElectronSpawn(.bin shim) invokes the shim directly", () => {
  const { cmd, argv } = buildElectronSpawn("/abs/node_modules/.bin/electron", "/abs/main.js", "7430");
  assert.equal(cmd, "/abs/node_modules/.bin/electron");
  assert.deepEqual(argv, ["/abs/main.js", "--port", "7430"]);
});

// ── autostartIsOn (filesystem detection) ─────────────────────────────────

test("autostartIsOn() returns boolean for every supported platform", () => {
  // We don't assert true/false (state-dependent on the dev machine); only the
  // contract that it never throws and always returns a boolean.
  const v = autostartIsOn();
  assert.equal(typeof v, "boolean");
});

// ── CLI integration ──────────────────────────────────────────────────────

test("`apx desktop status` exits 0 and prints the autostart line", () => {
  const r = run(["desktop", "status"]);
  const out = stripAnsi(r.stdout);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(out, /APX Desktop/);
  assert.match(out, /autostart:/);
  // Must end on "on" or "off" (never empty / unknown)
  assert.match(out, /autostart:\s+(on|off)/);
});

test("unknown desktop subcommand fails with a usage hint listing install/uninstall", () => {
  const r = run(["desktop", "no-such-subcommand"]);
  const err = stripAnsi(r.stderr + r.stdout);
  assert.notEqual(r.status, 0);
  assert.match(err, /unknown desktop sub-command/i);
  assert.match(err, /start\|stop\|status\|install\|uninstall/);
});

test("`apx desktop install` is a no-op on unsupported platforms (graceful exit)", { skip: process.platform !== "freebsd" && process.platform !== "sunos" }, () => {
  // Only runs on platforms we explicitly don't support — confirms graceful path.
  const r = run(["desktop", "install"]);
  assert.notEqual(r.status, 0);
  assert.match(stripAnsi(r.stderr + r.stdout), /no soportado/i);
});

// ── helpers ──────────────────────────────────────────────────────────────

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
