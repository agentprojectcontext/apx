import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { planLast } from "./planLast.ts";

const plan: Part = { type: "plan", steps: [{ step: "Check prices", state: "doing" }] };
const said: Part = { type: "text", text: "Looking now." };
const notice: Part = { type: "notice", level: "info", code: "c", text: "Asked first." };

test("while the run works, its plan is drawn under everything it wrote since", () => {
  const blocks = [plan, said, notice].map((part) => ({ part }));
  assert.deepEqual(
    planLast(true, blocks).map((b) => b.part.type),
    ["text", "notice", "plan"],
  );
});

test("once the run ends, the plan keeps the place it was last marked in", () => {
  const blocks = [plan, said].map((part) => ({ part }));
  assert.deepEqual(planLast(false, blocks), blocks);
});
