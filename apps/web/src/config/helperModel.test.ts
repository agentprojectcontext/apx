import assert from "node:assert/strict";
import { test } from "node:test";
import { helperValue, readHelper } from "./helperModel.ts";

test("no value is automatic", () => {
  assert.deepEqual(readHelper(undefined), { mode: "auto", refs: [] });
  assert.deepEqual(readHelper(""), { mode: "auto", refs: [] });
  assert.deepEqual(readHelper("  "), { mode: "auto", refs: [] });
});

test("off is off", () => {
  assert.deepEqual(readHelper("off"), { mode: "off", refs: [] });
});

test("one model is a chain of one", () => {
  assert.deepEqual(readHelper("ollama/qwen2.5:14b"), { mode: "pick", refs: ["ollama/qwen2.5:14b"] });
});

test("a comma chain keeps its order, without blanks, spaces or repeats", () => {
  assert.deepEqual(readHelper("chatgpt/gpt-6-luna,ollama/qwen3:4b-instruct"), {
    mode: "pick",
    refs: ["chatgpt/gpt-6-luna", "ollama/qwen3:4b-instruct"],
  });
  assert.deepEqual(readHelper(" b/x , ,a/y,b/x,"), { mode: "pick", refs: ["b/x", "a/y"] });
});

test("only commas is automatic", () => {
  assert.deepEqual(readHelper(", ,"), { mode: "auto", refs: [] });
});

test("a chain is saved first model first; an empty one is automatic", () => {
  assert.equal(
    helperValue(["chatgpt/gpt-6-luna", "ollama/qwen3:4b-instruct"]),
    "chatgpt/gpt-6-luna,ollama/qwen3:4b-instruct",
  );
  assert.equal(helperValue([]), undefined);
  assert.deepEqual(readHelper(helperValue(["a/1", "b/2"])), { mode: "pick", refs: ["a/1", "b/2"] });
});
