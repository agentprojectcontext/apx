// A routine can ask for its own model, and when that model fails the run goes
// to the AGENT's own model first — the owner's choice for that agent — and
// only then to the router. Asked for on 2026-09-23: "tiene luna pero una
// rutina quiero que la haga con big pickle; si falla, va a la configuración
// del agente o al router".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-model-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runAgent } = await import("#core/agent/run-agent.js");
const { routineModelOf } = await import("#core/routines/runner.js");
const { _resetQuotaCooldowns, markQuotaExhausted } = await import("#core/agent/quota.js");
const { CHANNELS } = await import("#core/constants/channels.js");

beforeEach(() => _resetQuotaCooldowns());

const cfg = { super_agent: { model: "mock:router", model_fallback: { enabled: true, models: ["mock:last"] }, stuck_detection: { enabled: false } }, engines: {} };
const run = (extra) => {
  const events = [];
  return runAgent({
    globalConfig: cfg, system: "s", prompt: "hola", toolSchemas: [], makeToolHandlers: () => ({}),
    toolHandlerCtx: { channel: CHANNELS.ROUTINE }, onEvent: (e) => events.push(e), ...extra,
  }).then((out) => ({ out, events }));
};

test("only a full provider:model id is a routine model", () => {
  assert.equal(routineModelOf({ spec: { model: "zen:big-pickle" } }), "zen:big-pickle");
  assert.equal(routineModelOf({ spec: { model: "inherit" } }), null);
  assert.equal(routineModelOf({ spec: {} }), null);
});

test("routine model fails → the agent's own model, before the router", async () => {
  const { events } = await run({ overrideModel: "mock:fail-503", retryFirst: ["mock:agent"] });
  const failed = events.find((e) => e.type === "engine_failed");
  assert.equal(failed.retry_with, "mock:agent");
});

test("the agent's own model then falls to the router, unless the agent made it strict", async () => {
  const chain = await run({ overrideModel: "mock:fail-503", retryFirst: ["mock:fail-500"] });
  assert.deepEqual(chain.events.filter((e) => e.type === "engine_failed").map((e) => e.retry_with), ["mock:fail-500", "mock:router"]);
  await assert.rejects(run({ overrideModel: "mock:fail-503", retryFirst: ["mock:fail-500"], fallback: false }), /mock 500/);
});

test("a spent routine model on an unwatched run still reaches the agent's own model", async () => {
  const { events } = await run({ overrideModel: "mock:quota-exhausted", retryFirst: ["mock:agent"] });
  assert.equal(events.find((e) => e.type === "engine_failed").retry_with, "mock:agent");
  // …and a routine model already known to be spent starts on the agent's.
  markQuotaExhausted("mock:quota-exhausted", new Error("usage limit reached"));
  const again = await run({ overrideModel: "mock:quota-exhausted", retryFirst: ["mock:agent"] });
  assert.equal(again.events.find((e) => e.type === "model_start").model, "mock:agent");
});

test("without an owner's choice left, an unwatched run still stops before the router", async () => {
  await assert.rejects(run({ overrideModel: "mock:quota-exhausted" }), (e) => e.code === "QUOTA_EXHAUSTED");
});
