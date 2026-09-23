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
