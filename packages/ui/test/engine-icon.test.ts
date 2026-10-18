import assert from "node:assert/strict";
import { test } from "node:test";
import { engineBrand } from "../dist/index.js";
import { ACP_MARKS } from "../dist/marks.js";

test("the one-shot CLIs map to their own marks, not the neutral bot", () => {
  for (const [engine, brand] of [
    ["antigravity", "antigravity"],
    ["agy", "antigravity"],
    ["aider", "aider"],
  ] as const) {
    assert.equal(engineBrand(engine), brand);
    assert.ok(ACP_MARKS[brand].paths[0]?.d.startsWith("M"), `${brand} has a drawn mark`);
  }
});
