import assert from "node:assert/strict";
import { test } from "node:test";
import { setUnfolded, unfoldedOf } from "./unfolded.ts";

test("a card is drawn again as it was left, whatever it starts as", () => {
  assert.equal(unfoldedOf("thread_a", false), false);
  assert.equal(unfoldedOf("thread_b", true), true);
  setUnfolded("thread_a", true);
  setUnfolded("thread_b", false);
  assert.equal(unfoldedOf("thread_a", false), true);
  assert.equal(unfoldedOf("thread_b", true), false);
});
