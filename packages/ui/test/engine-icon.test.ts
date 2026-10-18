import assert from "node:assert/strict";
import { test } from "node:test";
import { engineBrand } from "../dist/index.js";
import { ACP_MARKS } from "../dist/marks.js";

test("the one-shot CLIs map to their own marks, not the neutral bot", () => {
  // Antigravity draws its colour mark on the first screen; Aider's one-colour mark arrives with the late marks.
  assert.equal(engineBrand("antigravity"), "antigravity");
  assert.equal(engineBrand("agy"), "antigravity");
  assert.equal(engineBrand("aider"), "aider");
  assert.ok(ACP_MARKS.aider.paths[0]?.d.startsWith("M"));
  assert.ok(!("antigravity" in ACP_MARKS));
});
