import assert from "node:assert/strict";
import { test } from "node:test";
import { modeBlock } from "./context.ts";

test("an agent on Total is told what still waits for the owner (DECISIONS.md#d-143)", () => {
  const total = modeBlock("total");
  // "Nothing waits" had it try changes to the owner's setup and their browser session as if no card came.
  assert.match(total, /what they set up in APX/);
  assert.match(total, /browser session/);
});
