// The super-agent's own model, apart from the router default.
//
// `super_agent.model` is the #1 of the router, and it is also what every agent
// with `Model: inherit` runs on. On 2026-09-22 it was pointed at the ChatGPT
// plan so the super-agent could use it — which moved the whole fleet onto that
// plan, and the next morning's cascade spent it. `self_model` lets the owner
// give the super-agent a model without handing it to everybody.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-self-model-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { resolveAgentModel } = await import("#core/agent/agent-model.js");
const { markQuotaExhausted, _resetQuotaCooldowns } = await import("#core/agent/quota.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { CHANNELS } = await import("#core/constants/channels.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

beforeEach(() => _resetQuotaCooldowns());

const cfg = (extra = {}) => ({
  super_agent: {
    enabled: true, model: "mock:router", permission_mode: "total",
    model_fallback: { enabled: true, models: [] }, stuck_detection: { enabled: false }, ...extra,
  },
  memory: { enabled: false },
  engines: {},
});

async function superAgentModel(config) {
  const root = makeTempProject({ name: "Self Model" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];
  try {
    await runSuperAgent({
      projects, plugins: null, registries: null, prompt: "hola",
      globalConfig: config, channel: CHANNELS.WEB, onEvent: (e) => events.push(e),
    });
  } finally {
    cleanupTempProject(root);
  }
  return events.find((e) => e.type === "model_start")?.model;
}

test("unset, the super-agent runs on the router default like everybody else", async () => {
  assert.equal(await superAgentModel(cfg()), "mock:router");
});

test("set, the super-agent runs on its own model and inheriting agents do not", async () => {
  const config = cfg({ self_model: "mock:self" });
  assert.equal(await superAgentModel(config), "mock:self");
  assert.equal(await resolveAgentModel({ agent: { fields: { Model: "inherit" } }, config }), "mock:router");
});

test("its own model is a preference: out of quota, the router takes over", async () => {
  markQuotaExhausted("mock:self", new Error("usage limit reached"));
  assert.equal(await superAgentModel(cfg({ self_model: "mock:self" })), "mock:router");
});

// The owner's choice for a pinned model: keep answering on the router chain
// when it fails (default), or fail rather than answer on something else.
test("a strict own model fails instead of walking the router chain", async () => {
  await assert.rejects(
    superAgentModel(cfg({ self_model: "mock:fail-503", self_model_fallback: false })),
    /mock 503/,
  );
  // Default: the same failure lands on the router default.
  const events = [];
  const root = makeTempProject({ name: "Self Model Fallback" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    await runSuperAgent({
      projects, plugins: null, registries: null, prompt: "hola",
      globalConfig: cfg({ self_model: "mock:fail-503" }), channel: CHANNELS.WEB,
      onEvent: (e) => events.push(e),
    });
  } finally { cleanupTempProject(root); }
  assert.equal(events.find((e) => e.type === "engine_failed")?.retry_with, "mock:router");
});

test("an agent's pinned model can be made strict, and the file only says so when it is", async () => {
  const { setAgentConfig } = await import("#core/apc/agent-write.js");
  const { readAgents } = await import("#core/apc/parser.js");
  const { agentModelFallback } = await import("#core/agent/agent-model.js");
  const { agentToResponse } = await import("#host/daemon/api/shared.js");
  const root = makeTempProject({ name: "Pinned", agents: [{ slug: "magui" }] });
  try {
    const read = () => readAgents(root).find((a) => a.slug === "magui");
    const file = () => fs.readFileSync(path.join(root, ".apc", "agents", "magui.md"), "utf8");
    setAgentConfig({ path: root }, "magui", { model: "chatgpt-codex:gpt-5.6-luna@high" });
    assert.equal(agentModelFallback(read()), true, "absent means it falls back");
    assert.doesNotMatch(file(), /model_fallback/);
    setAgentConfig({ path: root }, "magui", { model_fallback: false });
    assert.equal(agentModelFallback(read()), false);
    assert.equal(agentToResponse(read()).model_fallback, false);
    assert.ok(!("Model_fallback" in agentToResponse(read()).extra));
    setAgentConfig({ path: root }, "magui", { model_fallback: true });
    assert.doesNotMatch(file(), /model_fallback/, "back to default leaves no trace");
  } finally {
    cleanupTempProject(root);
  }
});

test("runAgent with fallback off does not rotate", async () => {
  const { runAgent } = await import("#core/agent/run-agent.js");
  await assert.rejects(runAgent({
    globalConfig: cfg(), system: "s", prompt: "hola", toolSchemas: [], makeToolHandlers: () => ({}),
    toolHandlerCtx: { channel: CHANNELS.WEB }, overrideModel: "mock:fail-503", fallback: false,
  }), /mock 503/);
});
