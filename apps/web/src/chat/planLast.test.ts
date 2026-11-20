import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Part } from "@apx/protocol";
import { latestPlan, planLast } from "./planLast.ts";

const plan: Part = { type: "plan", steps: [{ step: "Check prices", state: "doing" }] };
const said: Part = { type: "text", text: "Looking now." };
const notice: Part = { type: "notice", level: "info", code: "c", text: "Asked first." };

test("while the run works, its plan is drawn under everything it wrote since", () => {
  const blocks = [plan, said, notice].map((part) => ({ part }));
  assert.deepEqual(
    planLast(true, true, blocks).map((b) => b.part.type),
    ["text", "notice", "plan"],
  );
});

test("a run cut short with steps left keeps its plan last, under what it wrote", () => {
  const blocks = [plan, said, notice].map((part) => ({ part }));
  assert.deepEqual(
    planLast(false, true, blocks).map((b) => b.part.type),
    ["text", "notice", "plan"],
  );
});

test("once the run ends with every step done, the plan goes on top and the answer closes the turn", () => {
  const finished: Part = { type: "plan", steps: [{ step: "Check prices", state: "done" }] };
  const blocks = [said, finished].map((part) => ({ part }));
  assert.deepEqual(
    planLast(false, true, blocks).map((b) => b.part.type),
    ["plan", "text"],
  );
  assert.deepEqual(
    planLast(true, true, blocks).map((b) => b.part.type),
    ["text", "plan"],
  );
});

test("a plan a newer message replaced is not drawn, finished or not", () => {
  const blocks = [plan, said].map((part) => ({ part }));
  assert.deepEqual(
    planLast(false, false, blocks).map((b) => b.part.type),
    ["text"],
  );
  assert.deepEqual(
    planLast(true, false, blocks).map((b) => b.part.type),
    ["text"],
  );
});

test("only the chat's newest message with a plan draws it", () => {
  const msg = (id: string, parts: Part[]) => ({ id, parts }) as Message;
  assert.equal(latestPlan([msg("a", [plan]), msg("b", [said, plan]), msg("c", [said])]), "b");
  assert.equal(latestPlan([msg("c", [said])]), undefined);
});
