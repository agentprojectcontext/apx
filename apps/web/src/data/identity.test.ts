import assert from "node:assert/strict";
import { test } from "node:test";
import { isPending, isWorking } from "./identity.ts";

test("a queued delegation is pending but not at work", () => {
  assert.equal(isPending("queued"), true);
  assert.equal(isWorking("queued"), false);
});

test("submitted and working are both at work and pending", () => {
  for (const state of ["submitted", "working"] as const) {
    assert.equal(isWorking(state), true);
    assert.equal(isPending(state), true);
  }
});

test("finished, failed, canceled and unknown states are neither", () => {
  for (const state of ["completed", "failed", "canceled", undefined] as const) {
    assert.equal(isWorking(state), false);
    assert.equal(isPending(state), false);
  }
});
