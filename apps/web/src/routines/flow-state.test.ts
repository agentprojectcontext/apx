import assert from "node:assert/strict";
import { test } from "node:test";
import { flowRunStateKey } from "./flow-state.ts";

test("Flow run states use localized labels and never expose unknown protocol statuses as labels", () => {
  for (const [state, key] of Object.entries({
    queued: "run.queued",
    submitted: "run.submitted",
    working: "run.working",
    "input-required": "run.waiting",
    completed: "run.done",
    failed: "run.failed",
    canceled: "run.canceled",
  }))
    assert.equal(flowRunStateKey(state), key);
  for (const state of [null, "future-status", "toString", "__proto__"])
    assert.equal(flowRunStateKey(state), "flow.unknownState");
});
