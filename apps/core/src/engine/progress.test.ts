import assert from "node:assert/strict";
import { test } from "node:test";
import type { Step } from "../domain/runs.ts";
import { stalled } from "./progress.ts";

let n = 0;
const step = (tool: string, args: object, o: Partial<Step> = {}): Step => ({
  call_id: `c${n++}`,
  tool,
  args: args as Record<string, unknown>,
  effect: "local",
  state: "ok",
  result: undefined,
  ...o,
});
const edits = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => step("file_edit", { path: `src/f${from + i}.ts` }));

test("a part that changed new things, mostly with success, is progress", () => {
  const before = edits(0, 10);
  const part = [...edits(10, 8), step("file_read", { path: "src/a.ts" }, { effect: "none" })];
  assert.equal(stalled(part, before), undefined);
  // Reading what the last part read is fine: what counts is what it got done.
  assert.equal(stalled([...edits(30, 3), ...before.map((s) => ({ ...s, effect: "none" as const }))]), undefined);
});

test("a part that got nothing done, or only looked things up, made no progress", () => {
  assert.equal(stalled([]), "none of its calls worked");
  assert.equal(stalled([step("shell", { command: "npm test" }, { state: "error" })]), "none of its calls worked");
  const fails = [...edits(0, 1), ...Array.from({ length: 9 }, (_, i) => step("shell", { i }, { state: "error" }))];
  assert.equal(stalled(fails), "most of its calls failed");
  const looks = Array.from({ length: 20 }, (_, i) => step("memory_search", { q: `q${i}` }, { effect: "none" }));
  assert.equal(stalled(looks), "it only looked things up and changed nothing");
});

test("a part that goes round the same calls, or redoes the last part's changes, is a loop", () => {
  const same = Array.from({ length: 12 }, () => step("shell", { command: "npm run build" }, { effect: "external" }));
  assert.equal(stalled(same), "it kept repeating the same calls");
  const before = edits(0, 10);
  assert.equal(stalled(edits(0, 10), before), "it redid what its last part had done");
  assert.equal(stalled(edits(5, 10), before), undefined, "half of it is new work");
});
