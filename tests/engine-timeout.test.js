// One silence budget for every provider.
//
// 2026-09-23: with the paid accounts spent and Gemini overloaded, routines
// fell to a local model; with tools it does not stream, so Node waited 300 s
// for headers and failed with a bare "fetch failed" the chain did not rotate
// on — holding the routine queue five minutes each time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-engine-timeout-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { callEngine, engineTimeoutMs, ENGINE_TIMEOUT_S } = await import("#core/engines/index.js");
const { runAgent } = await import("#core/agent/run-agent.js");
const { isRetryableEngineError } = await import("#core/agent/retry.js");

const slow = [{ role: "user", content: "[mock:slow:2000] hola" }];

test("the budget is per provider, then global, then the default — never per engine type", () => {
  assert.equal(engineTimeoutMs({}, "ollama"), ENGINE_TIMEOUT_S * 1000);
  assert.equal(engineTimeoutMs({ super_agent: { engine_timeout_s: 60 } }, "ollama"), 60_000);
  assert.equal(engineTimeoutMs({ super_agent: { engine_timeout_s: 60 }, engines: { ollama: { timeout_s: 20 } } }, "ollama"), 20_000);
  assert.ok(ENGINE_TIMEOUT_S < 300, "it must fire before Node's own opaque 300 s");
});

test("a call that goes quiet fails clearly, and the chain may rotate on it", async () => {
  const started = Date.now();
  await assert.rejects(
    callEngine({ modelId: "mock:test", system: "s", messages: slow, config: { engines: { mock: { timeout_s: 0.05 } } } }),
    (e) => {
      assert.equal(e.code, "ENGINE_TIMEOUT");
      assert.match(e.message, /mock:test: no answer within 0 s/);
      assert.ok(isRetryableEngineError(e));
      return true;
    },
  );
  assert.ok(Date.now() - started < 1500, "cut at the budget, not at the model's pace");
});

test("the caller's own abort is still an abort, not a timeout", async () => {
  const ctrl = new AbortController();
  const p = callEngine({ modelId: "mock:test", system: "s", messages: slow, config: {}, signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === "AbortError");
});

test("a turn whose model goes quiet moves on to the next one", async () => {
  const events = [];
  const out = await runAgent({
    globalConfig: {
      super_agent: { model: "mock:test", model_fallback: { enabled: true, models: ["mock:spare"] }, stuck_detection: { enabled: false } },
      engines: { mock: { timeout_s: 0.05 } },
    },
    system: "s", prompt: "[mock:slow:2000] hola", toolSchemas: [], makeToolHandlers: () => ({}),
    toolHandlerCtx: { channel: "routine" }, onEvent: (e) => events.push(e),
  }).catch((e) => e);
  const failed = events.find((e) => e.type === "engine_failed");
  assert.ok(failed, "the timeout rotated instead of ending the turn");
  assert.match(failed.reason, /no answer within/);
  assert.equal(failed.retry_with, "mock:spare");
  void out;
});
