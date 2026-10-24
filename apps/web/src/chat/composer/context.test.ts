import assert from "node:assert/strict";
import { test } from "node:test";
import type { Run } from "@apx/protocol";
import { contextOf, spentOf, tokens, usageStamp } from "./context.ts";

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

test("what a chat spent is the core's totals, with what came from the cache", () => {
  assert.equal(spentOf(undefined), undefined, "not loaded yet");
  assert.equal(spentOf({ input: 0, output: 0, cached: 0 }), undefined, "no run reported tokens");
  assert.deepEqual(spentOf({ input: 32_000_000, output: 400_000, cached: 19_400_000 }), {
    input: 32_000_000,
    output: 400_000,
    cached: 19_400_000,
  });
});

test("the totals are asked again when a run starts or ends, not otherwise", () => {
  const at = (id: string, ended_at?: string) => ({ id, ended_at }) as Run;
  const working = [at("b"), at("a", "2026-10-01T10:00:00Z")];
  assert.equal(usageStamp(working), usageStamp([...working]), "same runs: same stamp");
  assert.notEqual(usageStamp([at("c"), ...working]), usageStamp(working), "a run started");
  assert.notEqual(
    usageStamp([at("b", "2026-10-01T10:05:00Z"), at("a", "2026-10-01T10:00:00Z")]),
    usageStamp(working),
    "a run ended",
  );
});
