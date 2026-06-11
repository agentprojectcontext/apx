import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findClaudeSessionById,
  findCodexSessionById,
  findApxSessionById,
  findEngineSessionById,
  readEngineSessionContext,
} from "#host/daemon/engine-sessions.js";

function encode(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, "-");
}

function fakeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-engine-sessions-"));
}

// Helper that wraps a call so opts.home is forwarded. The production helpers
// look at HOME, so we monkey-patch the env around the call instead of changing
// the public signature.
function withHome(home, fn) {
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn();
  } finally {
    process.env.HOME = old;
  }
}

test("findClaudeSessionById locates the transcript across project folders", () => {
  const home = fakeHome();
  const dir = path.join(home, ".claude", "projects", encode("/x/y"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "abc-123.jsonl"), "{}\n");

  const hit = withHome(home, () => findClaudeSessionById("abc-123"));
  assert.ok(hit, "expected a hit");
  assert.equal(hit.engine, "claude");
  assert.equal(hit.id, "abc-123");
});

test("findCodexSessionById walks rollouts and matches by id", () => {
  const home = fakeHome();
  const dayDir = path.join(home, ".codex", "sessions", "2026", "05", "20");
  fs.mkdirSync(dayDir, { recursive: true });
  const file = path.join(dayDir, "rollout-2026-05-20T10-00-00-x.jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({ type: "session_meta", payload: { id: "codex-xyz", cwd: "/proj/x" } }) + "\n"
  );
  const hit = withHome(home, () => findCodexSessionById("codex-xyz"));
  assert.ok(hit);
  assert.equal(hit.engine, "codex");
  assert.equal(hit.cwd, "/proj/x");
  assert.equal(hit.path, file);
});

test("findApxSessionById finds session by filename id", () => {
  const home = fakeHome();
  const sdir = path.join(home, ".apx", "projects", "apx-id", "agents", "roby", "sessions");
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, "2026-05-09-42.md"), "---\ntitle: Hi\n---\n");
  const hit = withHome(home, () => findApxSessionById("2026-05-09-42"));
  assert.ok(hit);
  assert.equal(hit.engine, "apx");
  assert.equal(hit.agentSlug, "roby");
  assert.equal(hit.apxId, "apx-id");
});

test("findEngineSessionById returns null when nothing matches", () => {
  const home = fakeHome();
  const hit = withHome(home, () => findEngineSessionById("nope-id"));
  assert.equal(hit, null);
});

test("readEngineSessionContext extracts aiTitle + lastPrompt from a claude transcript", () => {
  const home = fakeHome();
  const dir = path.join(home, ".claude", "projects", "encoded");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "ctx-123.jsonl");
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ type: "ai-title", aiTitle: "Hunt the bug" }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "what about feature flags?" }),
    ].join("\n") + "\n"
  );
  const ctx = readEngineSessionContext({ engine: "claude", path: file });
  assert.equal(ctx.title, "Hunt the bug");
  assert.equal(ctx.lastPrompt, "what about feature flags?");
});

test("readEngineSessionContext on apx returns the frontmatter title", () => {
  const home = fakeHome();
  const file = path.join(home, "sess.md");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, "---\nid: 2026-01-01-01\ntitle: APX work\n---\n\n# body\n");
  const ctx = readEngineSessionContext({ engine: "apx", path: file });
  assert.equal(ctx.title, "APX work");
  assert.equal(ctx.lastPrompt, null);
});
