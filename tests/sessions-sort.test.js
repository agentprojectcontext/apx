// Backups (Time Machine and friends) clobber mtime, so the engine listers now
// prefer the timestamp embedded inside each transcript line. These tests force
// the two signals to disagree and assert ordering follows the internal one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENGINES } from "../src/interfaces/cli/commands/sessions.js";

function encode(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, "-");
}

function fakeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-sessions-sort-"));
}

test("claude listSessions orders by internal jsonl timestamp, not mtime", () => {
  const home = fakeHome();
  const projectDir = "/Volumes/work/timestamp-demo";
  const folder = path.join(home, ".claude", "projects", encode(projectDir));
  fs.mkdirSync(folder, { recursive: true });

  const older = path.join(folder, "older.jsonl");
  fs.writeFileSync(
    older,
    [
      JSON.stringify({ type: "ai-title", aiTitle: "older" }),
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z" }),
    ].join("\n") + "\n"
  );

  const newer = path.join(folder, "newer.jsonl");
  fs.writeFileSync(
    newer,
    [
      JSON.stringify({ type: "ai-title", aiTitle: "newer" }),
      JSON.stringify({ type: "user", timestamp: "2026-05-01T00:00:00Z" }),
    ].join("\n") + "\n"
  );

  // Make mtimes lie: bump the *older* file's mtime to "now" so it's the
  // most-recently-touched on disk, while keeping the internal timestamp old.
  // The sort must still surface "newer" first because the JSONL says so.
  const future = new Date();
  fs.utimesSync(older, future, future);
  const past = new Date(2025, 0, 1);
  fs.utimesSync(newer, past, past);

  const result = ENGINES.claude.listSessions(projectDir, { home });
  assert.equal(result.found, true);
  assert.equal(result.sessions.length, 2);
  assert.equal(
    result.sessions[0].id,
    "newer",
    "internal timestamp must win over clobbered mtime"
  );
});

test("apx listSessions orders by frontmatter completed/started, not mtime", () => {
  const home = fakeHome();
  const projectDir = path.join(home, "myproj");
  fs.mkdirSync(path.join(projectDir, ".apc"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, ".apc", "project.json"),
    JSON.stringify({ name: "myproj", apx_id: "apx-sort-test" })
  );
  fs.mkdirSync(path.join(home, ".apx"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".apx", "config.json"),
    JSON.stringify({ projects: [{ path: projectDir }] })
  );

  const sdir = path.join(
    home,
    ".apx",
    "projects",
    "apx-sort-test",
    "agents",
    "roby",
    "sessions"
  );
  fs.mkdirSync(sdir, { recursive: true });

  const older = path.join(sdir, "2026-01-01-01.md");
  fs.writeFileSync(
    older,
    "---\nid: 2026-01-01-01\ntitle: older\nstarted: 2026-01-01T00:00:00Z\ncompleted: 2026-01-01T01:00:00Z\n---\n"
  );
  const newer = path.join(sdir, "2026-05-01-01.md");
  fs.writeFileSync(
    newer,
    "---\nid: 2026-05-01-01\ntitle: newer\nstarted: 2026-05-01T00:00:00Z\ncompleted: 2026-05-01T01:00:00Z\n---\n"
  );

  // Same trick — give the older file a future mtime and the newer one an
  // ancient mtime so the sort can only be right if it reads the frontmatter.
  const future = new Date();
  fs.utimesSync(older, future, future);
  const past = new Date(2024, 0, 1);
  fs.utimesSync(newer, past, past);

  const result = ENGINES.apx.listSessions(projectDir, { home });
  assert.equal(result.found, true);
  assert.equal(result.sessions[0].id, "2026-05-01-01");
});
