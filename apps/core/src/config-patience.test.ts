import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

test("APX_STEP_PATIENCE_MS sets the waits before the model list is asked again; unset keeps the default", () => {
  assert.deepEqual(loadConfig({ APX_STEP_PATIENCE_MS: "20, 40" }, false).stepPatienceMs, [20, 40]);
  assert.equal(loadConfig({}, false).stepPatienceMs, undefined);
});
