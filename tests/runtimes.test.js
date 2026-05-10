import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import codex from "../src/daemon/runtimes/codex.js";
import cursorAgent from "../src/daemon/runtimes/cursor-agent.js";
import geminiCli from "../src/daemon/runtimes/gemini-cli.js";
import qwenCode from "../src/daemon/runtimes/qwen-code.js";
import { RUNTIME_IDS, getRuntime } from "../src/daemon/runtimes/index.js";

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
  ]);
  assert.equal(getRuntime("cursor-agent").binary, "cursor-agent");
  assert.equal(getRuntime("gemini-cli").binary, "gemini");
  assert.equal(getRuntime("qwen-code").binary, "qwen");
});

test("codex runtime uses exec mode that works outside git repos", async () => {
  await withFakeBinary("codex", fakeNodeScript("codex output\n"), async (env) => {
    const r = await codex.run({
      system: "system text",
      prompt: "do work",
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
    });
    const args = JSON.parse(fs.readFileSync(env.APX_FAKE_ARGS_FILE, "utf8"));
    assert.deepEqual(args.slice(0, 4), [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
    ]);
    assert.match(args[4], /system text/);
    assert.match(args[4], /do work/);
    assert.equal(r.output, "codex output");
  });
});

test("cursor-agent runtime uses headless print mode", async () => {
  await withFakeBinary("cursor-agent", fakeNodeScript("cursor output\n"), async (env) => {
    const r = await cursorAgent.run({
      system: "system text",
      prompt: "do work",
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
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
      timeoutMs: 5000,
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
      timeoutMs: 5000,
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
