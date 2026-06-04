import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ENGINES,
  findSessionAcrossEngines,
  findSessionInEngine,
} from "../src/interfaces/cli/commands/sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "src", "interfaces", "cli", "index.js");

function encode(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, "-");
}

function makeFakeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-sessions-home-"));
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("claude engine lists sessions for a directory with ai-title", () => {
  const home = makeFakeHome();
  const projectDir = "/Volumes/work/demo-project";
  const folder = path.join(home, ".claude", "projects", encode(projectDir));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "sess-aaa.jsonl"),
    JSON.stringify({ type: "ai-title", aiTitle: "Refactor the parser" }) + "\n"
  );
  fs.writeFileSync(
    path.join(folder, "sess-bbb.jsonl"),
    JSON.stringify({ type: "last-prompt", lastPrompt: "fix the bug" }) + "\n"
  );

  const result = ENGINES.claude.listSessions(projectDir, { home });
  assert.equal(result.found, true);
  assert.equal(result.sessions.length, 2);
  const titles = result.sessions.map((s) => s.title);
  assert.ok(titles.includes("Refactor the parser"));
  assert.ok(titles.includes("fix the bug"));
});

test("claude engine reports not found for an unknown directory", () => {
  const home = makeFakeHome();
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  const result = ENGINES.claude.listSessions("/nowhere/nope", { home });
  assert.equal(result.found, false);
});

test("codex engine lists sessions filtered by cwd", () => {
  const home = makeFakeHome();
  const projectDir = "/Volumes/work/codex-demo";
  const dayDir = path.join(home, ".codex", "sessions", "2026", "05", "20");
  fs.mkdirSync(dayDir, { recursive: true });
  fs.writeFileSync(
    path.join(dayDir, "rollout-2026-05-20T10-00-00-abc.jsonl"),
    JSON.stringify({
      timestamp: "2026-05-20T10:00:00Z",
      type: "session_meta",
      payload: { id: "abc-id", cwd: projectDir },
    }) + "\n"
  );
  fs.writeFileSync(
    path.join(dayDir, "rollout-2026-05-20T11-00-00-xyz.jsonl"),
    JSON.stringify({
      timestamp: "2026-05-20T11:00:00Z",
      type: "session_meta",
      payload: { id: "xyz-id", cwd: "/other/place" },
    }) + "\n"
  );
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    JSON.stringify({ id: "abc-id", thread_name: "Codex demo thread" }) + "\n"
  );

  const result = ENGINES.codex.listSessions(projectDir, { home });
  assert.equal(result.found, true);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, "abc-id");
  assert.equal(result.sessions[0].title, "Codex demo thread");
});

test("apx engine lists registered projects from config.json", () => {
  const home = makeFakeHome();
  const projectDir = path.join(home, "my-apc-project");
  fs.mkdirSync(path.join(projectDir, ".apc"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, ".apc", "project.json"),
    JSON.stringify({ name: "iacrmar", apx_id: "f5ec4cdc258b" })
  );
  fs.mkdirSync(path.join(home, ".apx"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".apx", "config.json"),
    JSON.stringify({ projects: [{ path: projectDir }] })
  );

  const projects = ENGINES.apx.listProjects({ home });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].key, "iacrmar");
  assert.equal(projects[0].dir, projectDir);
});

test("antigravity engine is registered but not implemented", () => {
  assert.equal(ENGINES.antigravity.implemented, false);
});

test("sessions --help prints usage without executing", () => {
  const result = runCli(["sessions", "--help"]);
  const out = stripAnsi(result.stdout);
  assert.equal(result.status, 0);
  assert.match(out, /apx sessions/);
  assert.match(out, /--engine <id>/);
  assert.equal(result.stderr, "");
});

test("sessions list rejects an unknown engine", () => {
  const result = runCli(["sessions", "list", "--engine", "bogus"]);
  assert.notEqual(result.status, 0);
  assert.match(stripAnsi(result.stdout + result.stderr), /unknown engine/);
});

// ── new: cross-engine lookup ────────────────────────────────────────────────

test("claude findSessionById locates a session across project folders", () => {
  const home = makeFakeHome();
  const cwd = "/Volumes/work/example";
  const dir = path.join(home, ".claude", "projects", encode(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "abc-123.jsonl"),
    JSON.stringify({ type: "ai-title", aiTitle: "Some task" }) + "\n"
  );
  const hit = ENGINES.claude.findSessionById("abc-123", { home });
  assert.ok(hit, "expected to find session");
  assert.equal(hit.engine, "claude");
  assert.equal(hit.id, "abc-123");
  assert.equal(hit.title, "Some task");
});

test("codex findSessionById walks rollouts and returns the path", () => {
  const home = makeFakeHome();
  const dayDir = path.join(home, ".codex", "sessions", "2026", "05", "20");
  fs.mkdirSync(dayDir, { recursive: true });
  const file = path.join(dayDir, "rollout-2026-05-20T10-00-00-abc.jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: "session_meta",
      payload: { id: "codex-xyz", cwd: "/proj/x" },
    }) + "\n"
  );
  const hit = ENGINES.codex.findSessionById("codex-xyz", { home });
  assert.ok(hit, "expected to find codex session");
  assert.equal(hit.engine, "codex");
  assert.equal(hit.path, file);
  assert.equal(hit.cwd, "/proj/x");
});

test("apx findSessionById finds a session by frontmatter id", () => {
  const home = makeFakeHome();
  const projectDir = path.join(home, "myproj");
  fs.mkdirSync(path.join(projectDir, ".apc"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, ".apc", "project.json"),
    JSON.stringify({ name: "myproj", apx_id: "apx-test-id" })
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
    "apx-test-id",
    "agents",
    "reviewer",
    "sessions"
  );
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(
    path.join(sdir, "2026-05-09-42.md"),
    `---\nid: 2026-05-09-42\ntitle: Hi\nagent: reviewer\nstatus: open\n---\n\n# Hi\n`
  );
  const hit = ENGINES.apx.findSessionById("2026-05-09-42", { home });
  assert.ok(hit);
  assert.equal(hit.engine, "apx");
  assert.equal(hit.agentSlug, "reviewer");
  assert.equal(hit.title, "Hi");
});

test("findSessionAcrossEngines returns multiple hits on id collision", () => {
  const home = makeFakeHome();
  // Plant the same id in both claude and codex stores.
  const claudeDir = path.join(home, ".claude", "projects", "encoded-x");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "collide-id.jsonl"),
    JSON.stringify({ type: "ai-title", aiTitle: "from claude" }) + "\n"
  );
  const codexDir = path.join(home, ".codex", "sessions", "2026", "05", "20");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, "rollout-2026-05-20T10-00-00.jsonl"),
    JSON.stringify({
      type: "session_meta",
      payload: { id: "collide-id", cwd: "/somewhere" },
    }) + "\n"
  );
  const hits = findSessionAcrossEngines("collide-id", { home });
  const engines = hits.map((h) => h.engine).sort();
  assert.deepEqual(engines, ["claude", "codex"]);
});

test("findSessionInEngine restricts the search to one engine", () => {
  const home = makeFakeHome();
  const dir = path.join(home, ".claude", "projects", "encoded-y");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "only-claude.jsonl"),
    JSON.stringify({ type: "ai-title", aiTitle: "x" }) + "\n"
  );
  assert.ok(findSessionInEngine("claude", "only-claude", { home }));
  assert.equal(findSessionInEngine("codex", "only-claude", { home }), null);
});

test("claude readSession returns raw + tail", () => {
  const home = makeFakeHome();
  const dir = path.join(home, ".claude", "projects", "encoded-z");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "read-me.jsonl");
  const body = "line-a\nline-b\nline-c\n".repeat(200);
  fs.writeFileSync(file, body);
  const reading = ENGINES.claude.readSession(
    { path: file },
    { tailBytes: 64 }
  );
  assert.equal(reading.found, true);
  assert.equal(reading.size, body.length);
  assert.ok(reading.tail.length <= 64);
  assert.ok(body.endsWith(reading.tail));
});

test("sessions list without --engine prints every detected engine", () => {
  // Smoke-test the CLI dispatch path. We can't easily fake HOME here for the
  // child process, so we just assert it exits 0 and mentions APX (always
  // available).
  const result = runCli(["sessions", "list"]);
  assert.equal(result.status, 0);
  const out = stripAnsi(result.stdout);
  assert.match(out, /APX/i);
});
