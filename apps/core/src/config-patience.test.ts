import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

test("APX_STEP_PATIENCE_MS sets the waits before the model list is asked again; unset keeps the default", () => {
  assert.deepEqual(loadConfig({ APX_STEP_PATIENCE_MS: "20, 40" }, false).stepPatienceMs, [20, 40]);
  assert.equal(loadConfig({}, false).stepPatienceMs, undefined);
});

test("APX_LLM_RETRY_MS sets the first wait before one model is tried again; unset or invalid keeps the default", () => {
  assert.equal(loadConfig({ APX_LLM_RETRY_MS: "10" }, false).llmRetryMs, 10);
  assert.equal(loadConfig({}, false).llmRetryMs, undefined);
  assert.equal(loadConfig({ APX_LLM_RETRY_MS: "soon" }, false).llmRetryMs, undefined);
});
