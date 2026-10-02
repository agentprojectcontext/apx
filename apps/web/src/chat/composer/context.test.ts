import assert from "node:assert/strict";
import { test } from "node:test";
import type { Run } from "@apx/protocol";
import { contextOf, tokens } from "./context.ts";

const run = (id: string, usage?: Run["usage"]) => ({ id, usage }) as Run;

test("the context figure comes from the newest run that reported one", () => {
  assert.equal(contextOf([]), undefined);
  assert.equal(contextOf([run("a", { input: 9, output: 1 })]), undefined, "no context: no figure");
  assert.equal(
    contextOf([run("b", { input: 9, output: 1 }), run("a", { input: 9, output: 1, context: 9 })]),
    undefined,
    "the newest run had none: no stale figure",
  );
  assert.deepEqual(contextOf([run("b"), run("a", { input: 50_000, output: 10, context: 38_400, window: 200_000 })]), {
    used: 38_400,
    window: 200_000,
  });
});

test("token counts are short: 950, 38k, 1.0M", () => {
  assert.equal(tokens(950), "950");
  assert.equal(tokens(38_400), "38k");
  assert.equal(tokens(1_048_576), "1.0M");
});
