import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import codex, { linkedWorktreeWritableDirs } from "#core/runtimes/codex.js";
import cursorAgent from "#core/runtimes/cursor-agent.js";
import geminiCli from "#core/runtimes/gemini-cli.js";
import qwenCode from "#core/runtimes/qwen-code.js";
import claudeCode from "#core/runtimes/claude-code.js";
import { RUNTIME_IDS, getRuntime } from "#core/runtimes/index.js";

async function withFakeBinary(name, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-bin-"));
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, body, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const oldPath = process.env.PATH || "";
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  try {
    return await fn({
      PATH: process.env.PATH,
      APX_FAKE_ARGS_FILE: path.join(dir, "args.json"),
    });
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A ceiling, not a stopwatch. These tests assert what the adapter PASSES to the
// binary and what it makes of the output; the number only has to be past the
// worst case for a fake to start and exit. `node --test` runs ~220 files in
// parallel with V8 coverage on, and a cold Node start under that load has gone
// past five seconds — which killed the fake mid-run and failed an assertion
// about its arguments, on every machine slow enough to notice. Named, so nobody
// reads it back as "codex must answer within N".
const SPAWN_TIMEOUT_MS = 60_000;

function fakeNodeScript(output) {
  return `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.APX_FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(output)});
`;
}

test("runtime registry includes external CLI adapters", () => {
  assert.deepEqual(RUNTIME_IDS, [
    "claude-code",
    "codex",
    "opencode",
    "aider",
    "cursor-agent",
    "gemini-cli",
    "qwen-code",
    "antigravity",
  ]);
  assert.equal(getRuntime("cursor-agent").binary, "cursor-agent");
  assert.equal(getRuntime("gemini-cli").binary, "gemini");
  assert.equal(getRuntime("qwen-code").binary, "qwen");
  assert.equal(getRuntime("antigravity").binary, "agy");
});

test("codex runtime uses exec mode that works outside git repos", async () => {
  // Not process.cwd(): the suite may run from a linked worktree, which adds --add-dir.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-cwd-"));
  await withFakeBinary("codex", fakeNodeScript("codex output\n"), async (env) => {
    const r = await codex.run({
      system: "system text",
      prompt: "do work",
      cwd,
      env,
      timeoutMs: SPAWN_TIMEOUT_MS,
    });
    const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
    assert.deepEqual(args.slice(0, 4), [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
    ]);
    // `--json` rides along because the thread id it prints is the only way a
    // later turn can resume this same conversation. The prompt stays last.
    assert.equal(args[4], "--json");
    assert.match(args[5], /system text/);
    assert.match(args[5], /do work/);
    // A build that emits no parsable event still gets its stdout through.
    assert.equal(r.output, "codex output");
  });
});

// A main checkout with a linked worktree, built with real git. Every GIT_*
// variable is dropped: inside a git hook they would point git at this repo.
function linkedWorktreeFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-wt-")));
  const env = { GIT_CONFIG_NOSYSTEM: "1" };
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  const main = path.join(root, "main");
  const g = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  fs.mkdirSync(main);
  g(main, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(main, "a.txt"), "a\n");
  g(main, "add", "a.txt");
  g(main, "-c", "user.name=Dev", "-c", "user.email=dev@example.com", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "init");
  const worktree = path.join(root, "feature");
  g(main, "worktree", "add", "-q", "-b", "feature", worktree);
  const common = path.join(main, ".git");
  return { root, main, worktree, common, gitDir: path.join(common, "worktrees", "feature") };
}

function argValues(args, flag) {
  return args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
}

test("codex in a linked worktree can write its git metadata, and only that", async () => {
  const fx = linkedWorktreeFixture();
  try {
    const expected = [fx.gitDir, ...["objects", "refs", "logs"].map((d) => path.join(fx.common, d))];
    assert.deepEqual(await linkedWorktreeWritableDirs(fx.worktree), expected);
    await withFakeBinary("codex", fakeNodeScript("ok\n"), async (env) => {
      await codex.run({ prompt: "commit it", cwd: fx.worktree, env, timeoutMs: SPAWN_TIMEOUT_MS });
      const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
      assert.deepEqual(args.slice(0, 3), ["exec", "--sandbox", "workspace-write"]);
      assert.deepEqual(argValues(args, "--add-dir"), expected);
      // Not the common dir's root (config, hooks), nor the main checkout.
      for (const p of [fx.common, fx.main, path.join(fx.common, "hooks")]) {
        assert.ok(!args.includes(p), `${p} must stay read-only`);
      }
      assert.equal(args.at(-1), "commit it");
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("codex grants no git dirs for a main checkout, a non-repo, or a chat", async () => {
  const fx = linkedWorktreeFixture();
  try {
    assert.deepEqual(await linkedWorktreeWritableDirs(fx.main), []);
    assert.deepEqual(await linkedWorktreeWritableDirs(fx.root), []);
    for (const [cwd, mode] of [[fx.main, "code"], [fx.root, "code"], [fx.worktree, "chat"]]) {
      await withFakeBinary("codex", fakeNodeScript("ok\n"), async (env) => {
        await codex.run({ prompt: "hi", cwd, env, timeoutMs: SPAWN_TIMEOUT_MS, mode });
        const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
        assert.ok(!args.includes("--add-dir"), `${mode} in ${cwd}: ${args.join(" ")}`);
        assert.equal(args[2], mode === "chat" ? "read-only" : "workspace-write");
      });
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a resumed codex turn in a linked worktree names the git dirs through -c", async () => {
  // `exec resume` takes no --add-dir and does not keep the first turn's roots.
  const fx = linkedWorktreeFixture();
  try {
    await withFakeBinary("codex", fakeNodeScript("ok\n"), async (env) => {
      await codex.run({ prompt: "again", cwd: fx.worktree, env, timeoutMs: SPAWN_TIMEOUT_MS, resumeSessionId: "thread-1" });
      const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
      assert.deepEqual(args.slice(0, 2), ["exec", "resume"]);
      assert.ok(!args.includes("--add-dir") && !args.includes("--sandbox"));
      const roots = [fx.gitDir, ...["objects", "refs", "logs"].map((d) => path.join(fx.common, d))];
      assert.deepEqual(argValues(args, "-c"), [`sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`]);
      assert.deepEqual(args.slice(-2), ["thread-1", "again"]);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("cursor-agent runtime uses headless print mode", async () => {
  await withFakeBinary("cursor-agent", fakeNodeScript("cursor output\n"), async (env) => {
    const r = await cursorAgent.run({
      system: "system text",
      prompt: "do work",
      cwd: process.cwd(),
      env,
      timeoutMs: SPAWN_TIMEOUT_MS,
    });
    const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
    assert.deepEqual(args.slice(0, 5), [
      "--print",
      "--output-format",
      "text",
      "--trust",
      "--force",
    ]);
    assert.match(args[5], /system text/);
    assert.match(args[5], /do work/);
    assert.equal(r.output, "cursor output");
  });
});

test("gemini-cli runtime uses headless prompt mode", async () => {
  await withFakeBinary("gemini", fakeNodeScript("gemini output\n"), async (env) => {
    const r = await geminiCli.run({
      system: "system text",
      prompt: "do work",
      cwd: process.cwd(),
      env,
      timeoutMs: SPAWN_TIMEOUT_MS,
    });
    const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
    assert.deepEqual(args.slice(0, 2), ["--prompt", "system text\n\n---\n\ndo work"]);
    assert.deepEqual(args.slice(2), ["--output-format", "text", "--approval-mode", "yolo"]);
    assert.equal(r.output, "gemini output");
  });
});

test("qwen-code runtime passes system prompt separately", async () => {
  await withFakeBinary("qwen", fakeNodeScript("qwen output\n"), async (env) => {
    const r = await qwenCode.run({
      system: "system text",
      prompt: "do work",
      cwd: process.cwd(),
      env,
      timeoutMs: SPAWN_TIMEOUT_MS,
    });
    const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
    assert.deepEqual(args, [
      "--output-format",
      "text",
      "--approval-mode",
      "yolo",
      "--append-system-prompt",
      "system text",
      "do work",
    ]);
    assert.equal(r.output, "qwen output");
  });
});

test("claude-code: a coding run may edit — `-p` has nobody to approve a prompt", async () => {
  // Without a permission mode, headless Claude Code refused every edit and a
  // delegated fix came back untouched. Full trust in APX also lets it run shell.
  const out = JSON.stringify({ result: "ok", session_id: "s1" });
  for (const [permissionMode, expected] of [[null, "acceptEdits"], ["automatico", "acceptEdits"], ["total", "bypassPermissions"]]) {
    await withFakeBinary("claude", fakeNodeScript(out), async (env) => {
      await claudeCode.run({ prompt: "fix it", cwd: process.cwd(), env, timeoutMs: SPAWN_TIMEOUT_MS, permissionMode });
      const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
      assert.equal(args[args.indexOf("--permission-mode") + 1], expected);
    });
  }
  await withFakeBinary("claude", fakeNodeScript(out), async (env) => {
    await claudeCode.run({ prompt: "hi", cwd: process.cwd(), env, timeoutMs: SPAWN_TIMEOUT_MS, mode: "chat", permissionMode: "total" });
    const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
    assert.equal(args[args.indexOf("--permission-mode") + 1], "plan", "a chat stays read-only whatever the trust");
  });
});
