import assert from "node:assert/strict";
import { test } from "node:test";
import { planSteps } from "./task-plan.ts";

test("a checklist plan reads as steps, each done, doing or next", () => {
  assert.deepEqual(planSteps("- [x] Read the reference\n* [~] Draw the overlay \n\n- [ ] Record the video"), [
    { step: "Read the reference", state: "done" },
    { step: "Draw the overlay", state: "doing" },
    { step: "Record the video", state: "pending" },
  ]);
});

test("a plan with any other line is free text, and an empty one has no steps", () => {
  assert.equal(planSteps("1. [Done] Worktree ready\n- [ ] Next"), undefined);
  assert.equal(planSteps("  \n"), undefined);
  assert.equal(planSteps(undefined), undefined);
});
