// Which model a runtime CLI is asked for (#54). The documented default stays:
// `inherit` = the CLI's own config. What is new is a way to SAY otherwise —
// per call, per config, or by opting into APX's selection when its provider is
// native to the runtime — and a record of requested vs passed vs effective.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-model-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { resolveRuntimeModel, splitRuntimeModel } = await import("#core/runtimes/model.js");
const { getRuntime } = await import("#core/runtimes/index.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const codex = getRuntime("codex");
const claude = getRuntime("claude-code");
const aider = getRuntime("aider");

test("no pin: the CLI keeps its own default, and the result says so", () => {
  const r = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, config: {} });
  assert.deepEqual([r.model, r.effort, r.source], [null, null, "runtime_default"]);
});

test("an explicit model is split, never passed as provider:model@effort", () => {
  assert.deepEqual(splitRuntimeModel("chatgpt-codex:gpt-6-luna@high"), { provider: "chatgpt-codex", model: "gpt-6-luna", effort: "high" });
  const a = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, model: "chatgpt-codex:gpt-6-luna@high" });
  assert.deepEqual([a.model, a.effort, a.source], ["gpt-6-luna", "high", "call"]);
  const b = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, model: "gpt-6-luna", effort: "low" });
  assert.deepEqual([b.model, b.effort], ["gpt-6-luna", "low"]);
});

test("incompatible requests are specific errors, not silently dropped flags", () => {
  assert.match(resolveRuntimeModel({ runtimeId: "codex", adapter: codex, model: "anthropic:claude-opus-4-6" }).error, /anthropic model; codex cannot run it/);
  assert.match(resolveRuntimeModel({ runtimeId: "aider", adapter: aider, model: "gpt-4o" }).error, /does not take a model/);
  assert.match(resolveRuntimeModel({ runtimeId: "claude-code", adapter: claude, model: "claude-opus-4-6", effort: "high" }).error, /does not take a reasoning effort/);
  assert.match(resolveRuntimeModel({ runtimeId: "codex", adapter: codex, effort: "turbo" }).error, /unknown effort/);
  // A model id goes on a command line: something that reads as a flag is refused.
  assert.match(resolveRuntimeModel({ runtimeId: "codex", adapter: codex, model: "--dangerously-bypass" }).error, /not a valid model id/);
  assert.match(resolveRuntimeModel({ runtimeId: "codex", adapter: codex, model: "gpt 6" }).error, /not a valid model id/);
});

test("config pins a runtime; inherit_apx_model follows APX only for a native provider", () => {
  const pinned = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, config: { runtimes: { codex: { model: "gpt-6-luna", effort: "high" } } } });
  assert.deepEqual([pinned.model, pinned.effort, pinned.source], ["gpt-6-luna", "high", "config"]);

  const cfg = { runtimes: { codex: { inherit_apx_model: true } } };
  const inherit = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, config: cfg, apxModelId: "chatgpt-codex:gpt-6-luna@high" });
  assert.deepEqual([inherit.model, inherit.effort, inherit.source], ["gpt-6-luna", "high", "apx_inherit"]);

  const foreign = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, config: cfg, apxModelId: "groq:llama-3.3-70b" });
  assert.equal(foreign.model, null);
  assert.equal(foreign.source, "runtime_default");
  assert.match(foreign.note, /not native to codex/);

  // An explicit call still wins over config.
  const call = resolveRuntimeModel({ runtimeId: "codex", adapter: codex, config: cfg, model: "gpt-5.5", apxModelId: "chatgpt-codex:gpt-6-luna" });
  assert.equal(call.model, "gpt-5.5");
});

// ── the flags actually reach the CLI ────────────────────────────────────────

async function withFakeCodex(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-fake-codex-"));
  const bin = path.join(dir, "codex");
  // Prints its own argv, one per line, so the test reads what codex received.
  fs.writeFileSync(bin, '#!/bin/sh\ncase "$*" in *--version*) echo "codex 0.0.0"; exit 0;; esac\nfor a in "$@"; do echo "ARG:$a"; done\n', { mode: 0o755 });
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  try { return await fn(); } finally { process.env.PATH = old; fs.rmSync(dir, { recursive: true, force: true }); }
}

const argv = (out) => String(out).split("\n").filter((l) => l.startsWith("ARG:")).map((l) => l.slice(4));

test("codex gets -m and the effort override on exec AND on resume, and nothing when unpinned", async () => {
  await withFakeCodex(async () => {
    const pinned = await codex.run({ prompt: "hola", cwd: TMP_HOME, timeoutMs: 10_000, model: "gpt-6-luna", effort: "high" });
    const a = argv(pinned.output);
    assert.ok(a.includes("-m") && a[a.indexOf("-m") + 1] === "gpt-6-luna");
    assert.ok(a.includes('model_reasoning_effort="high"'));
    assert.ok(a.includes("--sandbox"), "the sandbox is unchanged");

    const resumed = await codex.run({ prompt: "seguí", cwd: TMP_HOME, timeoutMs: 10_000, resumeSessionId: "th_1", model: "gpt-6-luna" });
    const b = argv(resumed.output);
    assert.equal(b[1], "resume");
    assert.ok(b.includes("-m"));
    assert.ok(!b.includes("--sandbox"));

    const plain = argv((await codex.run({ prompt: "x", cwd: TMP_HOME, timeoutMs: 10_000 })).output);
    assert.ok(!plain.includes("-m") && !plain.some((x) => x.includes("model_reasoning_effort")));
  });
});

test("call_runtime records requested/passed/effective and refuses before spawning", async () => {
  const root = makeTempProject({ name: "acme", agents: [] });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const h = makeToolHandlers({
    projects, plugins: null, registries: null, channel: "cli",
    globalConfig: { super_agent: { permission_mode: "total" } },
  });
  try {
    await withFakeCodex(async () => {
      const r = await h.call_runtime({ runtime: "codex", prompt: "x", model: "gpt-6-luna", effort: "high", background: false });
      assert.equal(r.model.passed, "gpt-6-luna");
      assert.equal(r.model.effort, "high");
      assert.equal(r.model.source, "call");
      assert.equal(r.model.effective, "gpt-6-luna");
      const entry = projects.list().find((e) => e.path === root);
      const sessDir = path.join(projects.get(entry.id).storagePath, "agents", "apx", "sessions");
      const file = fs.readdirSync(sessDir).map((f) => fs.readFileSync(path.join(sessDir, f), "utf8")).find((t) => t.includes(r.apc_session));
      assert.match(file, /model: gpt-6-luna@high \(call\)/);

      const plain = await h.call_runtime({ runtime: "codex", prompt: "x", background: false });
      assert.equal(plain.model.source, "runtime_default");
      assert.match(plain.model.effective, /runtime default/);

      const before = fs.readdirSync(sessDir).length;
      const bad = await h.call_runtime({ runtime: "codex", prompt: "x", model: "anthropic:claude-opus-4-6", background: false });
      assert.match(bad.error, /codex cannot run it/);
      assert.equal(fs.readdirSync(sessDir).length, before, "nothing was spawned or recorded");
    });
  } finally {
    cleanupTempProject(root);
  }
});
