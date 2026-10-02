import assert from "node:assert/strict";
import { test } from "node:test";
import { contextWindow } from "./windows.ts";

test("context windows by model family; unknown models get none", () => {
  assert.equal(contextWindow("anthropic/claude-sonnet-4-5"), 200_000);
  assert.equal(contextWindow("google/gemini-2.5-pro"), 1_048_576);
  assert.equal(contextWindow("openai/gpt-4o-mini"), 128_000);
  assert.equal(contextWindow("openai/o3"), 128_000);
  assert.equal(contextWindow("acme/house-model"), undefined);
});
