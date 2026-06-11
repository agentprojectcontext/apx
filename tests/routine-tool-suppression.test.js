// Tool suppression for routines that already pipe output through post_commands.
// See src/core/agent/tools-overlap.js + spec/backlog/01-routine-output-coherence.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POSTCMD_TOOL_OVERLAP,
  computeSuppressedTools,
  filterToolSchemas,
} from "#core/agent/tools-overlap.js";

test("POSTCMD_TOOL_OVERLAP is a frozen, non-empty map", () => {
  assert.ok(Object.isFrozen(POSTCMD_TOOL_OVERLAP));
  const keys = Object.keys(POSTCMD_TOOL_OVERLAP);
  assert.ok(keys.length >= 5);
  assert.ok(keys.includes("apx telegram send"));
});

test("computeSuppressedTools — no post_commands → empty", () => {
  assert.deepEqual(computeSuppressedTools(null), []);
  assert.deepEqual(computeSuppressedTools([]), []);
  assert.deepEqual(computeSuppressedTools(undefined), []);
});

test("computeSuppressedTools — apx telegram send prefix suppresses send_telegram", () => {
  const out = computeSuppressedTools([`apx telegram send "$APX_LLM_OUTPUT"`]);
  assert.deepEqual(out, ["send_telegram"]);
});

test("computeSuppressedTools — multiple matching commands de-duplicate", () => {
  const out = computeSuppressedTools([
    `apx telegram send "hi"`,
    `apx telegram notify "bye"`,
  ]);
  assert.deepEqual(out, ["send_telegram"]);
});

test("computeSuppressedTools — walks through && and | chains", () => {
  const out = computeSuppressedTools([
    `curl -s https://example.com | apx telegram send "$APX_LLM_OUTPUT"`,
  ]);
  assert.deepEqual(out, ["send_telegram"]);

  const out2 = computeSuppressedTools([
    `echo hi && apx telegram notify "$APX_LLM_OUTPUT"`,
  ]);
  assert.deepEqual(out2, ["send_telegram"]);
});

test("computeSuppressedTools — unrelated commands do not match", () => {
  const out = computeSuppressedTools([
    `echo nope`,
    `cp /tmp/x /tmp/y`,
    `git status`,
  ]);
  assert.deepEqual(out, []);
});

test("computeSuppressedTools — apx voice say maps to say_voice", () => {
  const out = computeSuppressedTools([`apx voice say "$APX_LLM_OUTPUT"`]);
  assert.deepEqual(out, ["say_voice"]);
});

test("computeSuppressedTools — ignores non-string entries", () => {
  const out = computeSuppressedTools([null, 42, `apx telegram send "x"`]);
  assert.deepEqual(out, ["send_telegram"]);
});

test("filterToolSchemas — removes by function.name (OpenAI shape)", () => {
  const schemas = [
    { type: "function", function: { name: "send_telegram", description: "x" } },
    { type: "function", function: { name: "read_file", description: "y" } },
  ];
  const out = filterToolSchemas(schemas, ["send_telegram"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].function.name, "read_file");
});

test("filterToolSchemas — removes by bare name shape", () => {
  const schemas = [{ name: "send_telegram" }, { name: "read_file" }];
  const out = filterToolSchemas(schemas, ["send_telegram"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "read_file");
});

test("filterToolSchemas — empty/missing suppress returns input untouched", () => {
  const schemas = [{ name: "a" }, { name: "b" }];
  assert.equal(filterToolSchemas(schemas, null), schemas);
  assert.equal(filterToolSchemas(schemas, []), schemas);
});

test("filterToolSchemas — keeps unknown shapes as-is", () => {
  const schemas = [{ weird: "shape" }, { name: "send_telegram" }];
  const out = filterToolSchemas(schemas, ["send_telegram"]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { weird: "shape" });
});
