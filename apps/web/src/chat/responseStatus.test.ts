import assert from "node:assert/strict";
import { test } from "node:test";
import { responseStatus, responseTitle } from "./responseStatus.ts";

test("a completed report is not done when it has no answer or failed actions", () => {
  assert.equal(responseStatus({ state: "completed" }).label, "run.done");
  assert.equal(responseTitle({ state: "completed" }), "chat.agentResponse");
  assert.deepEqual(responseStatus({ state: "completed", issue: "no_answer" }), {
    status: "waiting",
    label: "subthread.noAnswer",
  });
  assert.equal(responseTitle({ state: "completed", issue: "no_answer" }), "chat.agentMessage");
  assert.equal(responseStatus({ state: "completed", issue: "actions_failed" }).label, "subthread.actionsFailed");
});

test("errors and cancellation remain explicit rather than being titled an answer", () => {
  for (const state of ["failed", "canceled"] as const) {
    assert.equal(responseStatus({ state }).label, `run.${state}`);
    assert.equal(responseTitle({ state }), "chat.agentMessage");
  }
});

test("step and deadline limits identify progress even when the run says completed", () => {
  for (const end_reason of ["step_limit", "deadline"] as const) {
    assert.equal(responseStatus({ state: "completed", end_reason }).status, "waiting");
    assert.equal(responseTitle({ state: "completed", end_reason }), "chat.agentProgress");
  }
  assert.equal(responseStatus({ state: "completed", end_reason: "step_limit" }).label, "usage.state.stepLimit");
  assert.equal(responseStatus({ state: "failed", end_reason: "deadline" }).label, "usage.state.outOfTime");
});
