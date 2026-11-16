import assert from "node:assert/strict";
import { test } from "node:test";
import { CallFrame } from "./call-methods.ts";

test("a preparing frame carries how far the voice got and the seconds left, or nothing", () => {
  assert.deepEqual(CallFrame.parse({ type: "preparing", progress: 0.4, left_s: 18 }), {
    type: "preparing",
    progress: 0.4,
    left_s: 18,
  });
  assert.deepEqual(CallFrame.parse({ type: "preparing" }), { type: "preparing" });
  assert.equal(CallFrame.safeParse({ type: "preparing", progress: 2 }).success, false);
});
