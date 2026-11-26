// The rules a workflow runs by: which step may start, what it is told, and whether its JSON fits. DECISIONS.md#d-273
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkOutput,
  jsonOf,
  keyOf,
  outputOf,
  readiness,
  refOf,
  resultOf,
  type StepView,
  stepsOf,
  taskText,
  WorkflowPlan,
} from "./workflow-plan.ts";

const plan = WorkflowPlan.parse({
  name: "Audit",
  items: [{ name: "auth", path: "src/auth" }, "billing"],
  stages: [
    { phase: "Find", agent: "scout", task: "Look at {{item.path}}", output: { type: "object" } },
    { phase: "Fix", agent: "scout", task: "Fix it", only_if: "real" },
  ],
  finish: { phase: "Report", agent: "scout", task: "Report" },
});

const views = (rows: Array<[string, StepView["state"], string?]>) =>
  new Map(rows.map(([key, state, output]) => [key, { key, state, output }]));

test("each item goes through its stages on its own; the finish stage waits for all", () => {
  assert.deepEqual(
    stepsOf(plan).map((s) => s.key),
    ["s0.i0", "s0.i1", "s1.i0", "s1.i1", "finish"],
  );
  const fix0 = refOf(plan, keyOf(1, 0));
  const finish = refOf(plan, "finish");
  assert.ok(fix0 && finish);
  // Item 0's fix may start while item 1 is still being looked at.
  const some = views([
    ["s0.i0", "done", '{"real":true}'],
    ["s0.i1", "working"],
    ["s1.i0", "pending"],
    ["s1.i1", "pending"],
    ["finish", "pending"],
  ]);
  assert.deepEqual(readiness(plan, fix0, some), { ready: true });
  assert.deepEqual(readiness(plan, finish, some), { ready: false });
  // only_if: an item whose previous output says false stops there.
  const notReal = views([["s0.i0", "done", '{"real":false}']]);
  assert.equal(readiness(plan, fix0, notReal).ready, false);
  assert.match(String((readiness(plan, fix0, notReal) as { skip?: string }).skip), /real/);
});

test("a step is told its task with the item filled in, and the JSON it must end with", () => {
  const ref = refOf(plan, "s0.i0");
  assert.ok(ref);
  const text = taskText(plan, ref, new Map());
  assert.match(text, /Look at src\/auth/);
  assert.match(text, /```json block/);
  const fix = refOf(plan, "s1.i1");
  assert.ok(fix);
  // A task without {{previous}} still gets the previous output, and the item.
  const told = taskText(plan, fix, views([["s0.i1", "done", '{"real":true}']]));
  assert.match(told, /previous stage's output:\n\{"real":true\}/);
  assert.match(told, /Item:\nbilling/);
});

test("the JSON an answer ends with is found and checked against the schema", () => {
  assert.deepEqual(jsonOf('Done.\n```json\n{"a": 1}\n```'), { value: { a: 1 } });
  assert.deepEqual(jsonOf('{"a": 2}'), { value: { a: 2 } });
  assert.ok("error" in jsonOf("no json here"));
  const schema = {
    type: "object",
    required: ["score", "tags"],
    properties: { score: { type: "integer" }, tags: { type: "array", items: { type: "string" } } },
  };
  assert.deepEqual(checkOutput({ score: 3, tags: ["x"] }, schema), []);
  assert.deepEqual(checkOutput({ score: 1.5, tags: [2] }, schema), [
    "$.score: expected integer, got number",
    "$.tags[0]: expected string, got number",
  ]);
  assert.deepEqual(checkOutput({}, schema), ["$.score: missing", "$.tags: missing"]);
  const stage = plan.stages[0];
  assert.deepEqual(outputOf(stage, '```json\n{"real": true}\n```'), { output: '{"real":true}' });
  assert.ok("error" in outputOf(stage, "```json\n[1]\n```"));
});

test("a plan names an agent or a worker per stage, and only_if never on the first", () => {
  const both = WorkflowPlan.safeParse({
    name: "x",
    stages: [{ phase: "A", agent: "scout", worker: { name: "w", instructions: "i" }, task: "t" }],
  });
  assert.equal(both.success, false);
  const first = WorkflowPlan.safeParse({
    name: "x",
    stages: [{ phase: "A", agent: "scout", task: "t", only_if: "f" }],
  });
  assert.equal(first.success, false);
});

test("without a finish stage the result reads as text per item, never raw JSON", () => {
  const twoStage = WorkflowPlan.parse({
    name: "Review",
    items: [{ area: "Core", scope: "workflows" }, "Panel"],
    stages: [{ phase: "Check", agent: "scout", task: "Check {{item}}" }],
  });
  const out = resultOf(
    twoStage,
    views([
      [keyOf(0, 0), "done", "Approved: nothing new failed.\n\nStatus: done"],
      [keyOf(0, 1), "done", JSON.stringify({ verdict: "fix", why: "the card overflows" })],
    ]),
  );
  assert.match(out, /^### Core\n\nApproved: nothing new failed\./);
  assert.match(out, /### Panel\n\n- \*\*verdict:\*\* fix\n- \*\*why:\*\* the card overflows/);
  assert.doesNotMatch(out, /"output"|"item"|^\[/m);
});
