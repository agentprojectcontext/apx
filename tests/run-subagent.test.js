// run_subagent: sub-agents as a composable tool (OpenHands Task-tool pattern).
// Offline: mock engine, temp HOME set BEFORE imports (runSuperAgent's memory
// broker touches ~/.apx paths).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-subagent-home-"));

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { TOOL_SCHEMAS, makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { default: runSubagent } = await import("#core/agent/tools/handlers/run-subagent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const GLOBAL_CONFIG = {
  super_agent: {
    enabled: true,
    model: "mock:test",
    permission_mode: "total",
    model_fallback: { enabled: false },
  },
  memory: { enabled: false },
  engines: {},
};

test("run_subagent is registered with schema and category", () => {
  const schema = TOOL_SCHEMAS.find((s) => s.function?.name === "run_subagent");
  assert.ok(schema, "run_subagent schema must be in the registry");
  assert.deepEqual(schema.function.parameters.required, ["prompt"]);
  const handlers = makeToolHandlers({ globalConfig: {} });
  assert.equal(typeof handlers.run_subagent, "function");
});

test("depth guard: a sub-agent cannot spawn another sub-agent", async () => {
  const handler = runSubagent.makeHandler({ globalConfig: GLOBAL_CONFIG, subagentDepth: 1 });
  const r = await handler({ prompt: "do something" });
  assert.match(String(r.error), /nesting limit/);
});

test("empty prompt is rejected without spawning", async () => {
  const handler = runSubagent.makeHandler({ globalConfig: GLOBAL_CONFIG, subagentDepth: 0 });
  const r = await handler({ prompt: "   " });
  assert.match(String(r.error), /prompt is required/);
});

test("spawns an isolated child run and returns its final text", async () => {
  const root = makeTempProject({ name: "Subagent Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    const handler = runSubagent.makeHandler({
      globalConfig: GLOBAL_CONFIG,
      projects,
      plugins: null,
      registries: null,
      channel: "api",
      channelMeta: {},
      subagentDepth: 0,
    });
    const r = await handler({ prompt: "summarize the plan", description: "summarize plan" });
    assert.equal(r.ok, true);
    assert.equal(r.description, "summarize plan");
    assert.match(r.text, /\[mock:test\] received: summarize the plan/);
    assert.ok(Number.isFinite(r.duration_ms));
    assert.ok(r.usage && typeof r.usage.input_tokens === "number");
  } finally {
    cleanupTempProject(root);
  }
});

test("child gets run_subagent suppressed — a recursive call errors instead of nesting", async () => {
  const root = makeTempProject({ name: "Recursive Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    const handler = runSubagent.makeHandler({
      globalConfig: GLOBAL_CONFIG,
      projects,
      plugins: null,
      registries: null,
      channel: "api",
      channelMeta: {},
      subagentDepth: 0,
    });
    // The child model immediately tries run_subagent; the suppression proxy
    // answers with an error observation and the child still closes its run.
    const r = await handler({ prompt: "[mock:tool:run_subagent] delegate again" });
    assert.equal(r.ok, true);
    assert.ok(r.steps >= 1, "the suppressed call still shows up as a step");
    assert.ok(r.text && r.text.trim().length > 0);
  } finally {
    cleanupTempProject(root);
  }
});
