import assert from "node:assert/strict";
import { test } from "node:test";
import { planStatus, runEnded, toolStatus } from "./runEnded.ts";

test("only a completed, failed or canceled run has ended; an unknown one has not", () => {
  for (const s of ["completed", "failed", "canceled"] as const) assert.equal(runEnded(s), true);
  for (const s of ["queued", "submitted", "working", "input-required", undefined] as const)
    assert.equal(runEnded(s), false);
});

test("a tool call still running when its run ended shows as stopped, not spinning", () => {
  assert.equal(toolStatus("running", true), "stopped");
  assert.equal(toolStatus("running", false), "running");
  assert.equal(toolStatus("ok", true), "done");
  assert.equal(toolStatus("error", false), "failed");
});

test("the plan step under way when its run ended shows as stopped; pending and done keep theirs", () => {
  assert.equal(planStatus("doing", true), "stopped");
  assert.equal(planStatus("doing", false), "running");
  assert.equal(planStatus("pending", true), "pending");
  assert.equal(planStatus("done", true), "done");
});
