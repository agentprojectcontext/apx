// Content-based routing (RouterLLM pattern): rule matching, preferredModel
// resolution with health fallback, and the runSuperAgent wiring. Offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routing-home-"));

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { selectModelByRules, resolveActiveModel } = await import("#core/agent/model-router.js");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

function cfgWithRules(rules, extra = {}) {
  return {
    super_agent: {
      enabled: true,
      model: "mock:base",
      permission_mode: "total",
      model_fallback: { enabled: false },
      routing: { enabled: true, rules },
      ...extra,
    },
    engines: {},
  };
}

test("routing disabled or empty rules → null", () => {
  assert.equal(selectModelByRules({ prompt: "hola" }, { super_agent: {} }), null);
  assert.equal(selectModelByRules({ prompt: "hola" }, cfgWithRules([])), null);
  const off = cfgWithRules([{ model: "mock:x", when: {} }]);
  off.super_agent.routing.enabled = false;
  assert.equal(selectModelByRules({ prompt: "hola" }, off), null);
});

test("first matching rule wins; invalid models are skipped", () => {
  const cfg = cfgWithRules([
    { model: "no-colon", when: {} },
    { model: "mock:first", when: { keywords: ["deploy"] } },
    { model: "mock:catchall", when: {} },
  ]);
  assert.deepEqual(selectModelByRules({ prompt: "please DEPLOY now" }, cfg), {
    model: "mock:first",
    ruleIndex: 1,
  });
  assert.deepEqual(selectModelByRules({ prompt: "unrelated" }, cfg), {
    model: "mock:catchall",
    ruleIndex: 2,
  });
});

test("prompt/context size and channel conditions", () => {
  const cfg = cfgWithRules([
    { model: "mock:cheap", when: { max_prompt_chars: 20, channels: ["telegram"] } },
    { model: "mock:big", when: { min_context_chars: 100 } },
  ]);
  assert.equal(
    selectModelByRules({ prompt: "short", channel: "telegram" }, cfg).model,
    "mock:cheap"
  );
  // Wrong channel → falls through; not enough context → no match at all.
  assert.equal(selectModelByRules({ prompt: "short", channel: "web" }, cfg), null);
  const bigContext = [{ role: "user", content: "x".repeat(150) }];
  assert.equal(
    selectModelByRules({ prompt: "short", channel: "web", previousMessages: bigContext }, cfg).model,
    "mock:big"
  );
});

test("has_image matches channelMeta flag and content parts", () => {
  const cfg = cfgWithRules([{ model: "mock:vision", when: { has_image: true } }]);
  assert.equal(selectModelByRules({ prompt: "look" }, cfg), null);
  assert.equal(
    selectModelByRules({ prompt: "look", channelMeta: { has_image: true } }, cfg).model,
    "mock:vision"
  );
  const withImagePart = [
    { role: "user", content: [{ type: "image_url", image_url: { url: "data:..." } }] },
  ];
  assert.equal(
    selectModelByRules({ prompt: "look", previousMessages: withImagePart }, cfg).model,
    "mock:vision"
  );
});

test("resolveActiveModel: healthy preferred model leads the chain, tagged routed_by", async () => {
  const cfg = {
    super_agent: {
      model: "mock:base",
      model_fallback: { enabled: true, models: [], health_timeout_ms: 100 },
    },
    engines: {},
  };
  const r = await resolveActiveModel(cfg, { preferredModel: "mock:vision" });
  assert.equal(r.modelId, "mock:vision");
  assert.equal(r.routedBy, "content_rules");
  assert.equal(r.fromFallback, false);
});

test("resolveActiveModel: unhealthy preferred model falls back to the primary", async () => {
  const cfg = {
    super_agent: {
      model: "mock:base",
      model_fallback: { enabled: true, models: [], health_timeout_ms: 100 },
    },
    engines: { ollama: { base_url: "http://127.0.0.1:59998" } },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("59998")) throw new Error("connection refused");
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const r = await resolveActiveModel(cfg, { preferredModel: "ollama:whatever" });
    assert.equal(r.modelId, "mock:base");
    assert.equal(r.routedBy, undefined);
    assert.equal(r.tried[0].modelId, "ollama:whatever");
    assert.equal(r.tried[0].healthy, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveActiveModel: overrideModel beats preferredModel", async () => {
  const r = await resolveActiveModel(
    { super_agent: { model: "mock:base" }, engines: {} },
    { overrideModel: "mock:forced", preferredModel: "mock:vision" }
  );
  assert.equal(r.modelId, "mock:forced");
  assert.equal(r.forced, true);
});

test("runSuperAgent routes by content and reports the routed model", async () => {
  const root = makeTempProject({ name: "Routing Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];
  try {
    const result = await runSuperAgent({
      globalConfig: cfgWithRules(
        [{ model: "mock:router-pick", when: { keywords: ["translate"] } }],
        { model_fallback: { enabled: true, models: [], health_timeout_ms: 100 } }
      ),
      projects,
      plugins: null,
      registries: null,
      prompt: "please translate this sentence",
      channel: "api",
      onEvent: (e) => events.push(e),
      maxIters: 2,
    });
    assert.equal(result.model, "mock:router-pick");
    const routed = events.find((e) => e.type === "model_routed");
    assert.ok(routed, "model_routed event must fire");
    assert.equal(routed.routed_by, "content_rules");
  } finally {
    cleanupTempProject(root);
  }
});
