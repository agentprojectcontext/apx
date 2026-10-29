// A check's comparisons (DECISIONS.md#d-180): each comparison by type, cases joined by all or any, a field the data
// lacks read as empty, and the cases drawn before (a value, a formula) unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowBinding, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { flowCompare } from "./flow-compare.ts";
import { evaluateFlowCondition, resolveFlowInput } from "./flow-graph-semantics.ts";
import { validateFlowGraph } from "./flow-graph-validate.ts";

type Check = Extract<FlowNode, { kind: "condition" }>;
type Rule = {
  left: string;
  op: Parameters<typeof flowCompare>[0]["op"];
  right: string;
  type: "text" | "number" | "boolean";
};

test("text compares exactly: is, is not, contains, starts with", () => {
  const text = (op: Rule["op"], l: unknown, r: unknown) => flowCompare({ op, type: "text" }, l, r);
  assert.equal(text("equals", "Acme", "Acme"), true);
  assert.equal(text("equals", "Acme", "acme"), false);
  assert.equal(text("not_equals", "Acme", "acme"), true);
  assert.equal(text("contains", "user@example.com", "@example"), true);
  assert.equal(text("contains", "user@example.com", "@acme"), false);
  assert.equal(text("starts_with", "+54 11", "+54"), true);
  assert.equal(text("starts_with", "11 +54", "+54"), false);
  // A number or a yes reads as its text.
  assert.equal(text("equals", 7, "7"), true);
  assert.equal(text("equals", true, "true"), true);
  // An absent field is empty text: it is not "x", and is not "".
  assert.equal(text("equals", undefined, "x"), false);
  assert.equal(text("not_equals", undefined, "x"), true);
  // Comparisons text doesn't offer never hold.
  assert.equal(text("gt", "b", "a"), false);
});

test("numbers compare as numbers; text that is no number never holds", () => {
  const num = (op: Rule["op"], l: unknown, r: unknown) => flowCompare({ op, type: "number" }, l, r);
  assert.equal(num("equals", 10, "10.0"), true);
  assert.equal(num("equals", "10", 10), true);
  assert.equal(num("gt", 11, "10"), true);
  assert.equal(num("gt", 10, "10"), false);
  assert.equal(num("gte", 10, "10"), true);
  assert.equal(num("lt", "9", "10"), true);
  assert.equal(num("lte", 11, 10), false);
  // "9" < "10" as text would be false; as numbers it holds.
  assert.equal(num("lt", "9", "10"), true);
  for (const left of ["ten", "", null, undefined, true, {}])
    for (const op of ["equals", "gt", "lt", "gte", "lte"] as const) assert.equal(num(op, left, 1), false, `${op}`);
  assert.equal(num("not_equals", "ten", 10), true);
});

test("yes or no reads true and false, as values or as text", () => {
  const yes = (op: Rule["op"], l: unknown, r: unknown) => flowCompare({ op, type: "boolean" }, l, r);
  assert.equal(yes("equals", true, "true"), true);
  assert.equal(yes("equals", "true", "true"), true);
  assert.equal(yes("equals", false, "true"), false);
  assert.equal(yes("equals", "false", "false"), true);
  assert.equal(yes("equals", "yes", "true"), false);
  assert.equal(yes("equals", 1, "true"), false);
  assert.equal(yes("not_equals", undefined, "true"), true);
});

test("is empty and is not empty read the field alone", () => {
  for (const empty of [undefined, null, "", "  ", [], {}]) {
    assert.equal(flowCompare({ op: "empty", type: "text" }, empty, undefined), true);
    assert.equal(flowCompare({ op: "not_empty", type: "text" }, empty, undefined), false);
  }
  for (const full of ["a", 0, false, [1], { a: 1 }]) {
    assert.equal(flowCompare({ op: "empty", type: "number" }, full, undefined), false);
    assert.equal(flowCompare({ op: "not_empty", type: "boolean" }, full, undefined), true);
  }
});

const check = (cases: NonNullable<Check["cases"]>): Check => ({
  id: "check",
  label: "Check",
  kind: "condition",
  input: { kind: "event", path: [] },
  cases,
});
const steps = new Map([["normalize", { state: "succeeded" as const, output: { username: "sam", ok: true } }]]);
const readsOf = (event: unknown) => ({
  resolve: (b: FlowBinding) => resolveFlowInput(b, event, steps),
  vars: new Map<string, string>(),
});

test("a case of comparisons holds when all of them do, or any of them, and the first that holds is the way out", () => {
  const rules: Rule[] = [
    { left: "$steps.normalize.ok", op: "equals", right: "true", type: "boolean" },
    { left: "$trigger.plan", op: "equals", right: "pro", type: "text" },
  ];
  const node = check([
    { id: "both", label: "Complete", match: { kind: "all", rules } },
    { id: "either", label: "Partial", match: { kind: "any", rules } },
  ]);
  assert.deepEqual(evaluateFlowCondition(node, null, readsOf({ plan: "pro" })), { case: "both" });
  assert.deepEqual(evaluateFlowCondition(node, null, readsOf({ plan: "free" })), { case: "either" });
  const neither = check([
    {
      id: "c",
      label: "",
      match: {
        kind: "any",
        rules: [
          { left: "$trigger.plan", op: "equals", right: "pro", type: "text" },
          { left: "$steps.normalize.username", op: "starts_with", right: "x", type: "text" },
        ],
      },
    },
  ]);
  assert.deepEqual(evaluateFlowCondition(neither, null, readsOf({ plan: "free" })), { case: "no" });
});

test("both sides are templates: a reference on the right, text around a placeholder, a field the data lacks", () => {
  const node = check([
    {
      id: "same",
      label: "",
      match: {
        kind: "all",
        rules: [
          { left: "$trigger.user", op: "equals", right: "$steps.normalize.username", type: "text" },
          { left: "user:$trigger.user", op: "equals", right: "user:sam", type: "text" },
          { left: "$trigger.total", op: "gt", right: "$trigger.limit", type: "number" },
          { left: "$trigger.absent", op: "empty", right: "", type: "text" },
        ],
      },
    },
  ]);
  assert.deepEqual(evaluateFlowCondition(node, null, readsOf({ user: "sam", total: 12, limit: "10" })), {
    case: "same",
  });
  assert.deepEqual(evaluateFlowCondition(node, null, readsOf({ user: "sam", total: 9, limit: "10" })), {
    case: "no",
  });
  // A step that gave no answer can't be compared: the check can't be told (Simulate says unknown).
  const waiting = check([
    {
      id: "w",
      label: "",
      match: { kind: "all", rules: [{ left: "$steps.later.x", op: "empty", right: "", type: "text" }] },
    },
  ]);
  assert.throws(() => evaluateFlowCondition(waiting, null, readsOf({})), /unavailable/);
});

test("cases drawn before keep working: a value the input equals, and a formula", () => {
  const old: Check = {
    id: "check",
    label: "Check",
    kind: "condition",
    input: { kind: "event", path: ["tier"] },
    equals: "gold",
  };
  assert.deepEqual(evaluateFlowCondition(old, "gold", readsOf({ tier: "gold" })), { matched: true });
  const mixed = check([
    { id: "v", label: "", match: { kind: "equals", value: 3 } },
    { id: "f", label: "", match: { kind: "expr", expr: "$trigger.n > 2" } },
  ]);
  assert.deepEqual(evaluateFlowCondition(mixed, 3, readsOf({ n: 1 })), { case: "v" });
  assert.deepEqual(evaluateFlowCondition(mixed, 1, readsOf({ n: 5 })), { case: "f" });
});

test("a comparison naming no step, a later step or a secret variable is an issue of the drawing", () => {
  const graph = (left: string, right = "x") => ({
    schemaVersion: 2 as const,
    nodes: [
      { id: "start", label: "Hook", kind: "webhook" as const },
      {
        id: "v",
        label: "Vars",
        kind: "vars" as const,
        vars: [{ name: "key", value: { kind: "literal" as const, value: "secret://api" } }],
      },
      check([{ id: "c", label: "", match: { kind: "all", rules: [{ left, op: "equals", right, type: "text" }] } }]),
      {
        id: "after",
        label: "After",
        kind: "vars" as const,
        vars: [{ name: "late", value: { kind: "literal" as const, value: 1 } }],
      },
    ],
    edges: [
      { source: "start", target: "v" },
      { source: "v", target: "check" },
      { source: "check", target: "after", when: "c" },
    ],
    layout: [],
  });
  const codes = (left: string, right?: string) => validateFlowGraph(graph(left, right)).map((i) => i.code);
  assert.deepEqual(codes("$trigger.email"), []);
  assert.deepEqual(codes("$steps.nowhere.x"), ["binding_ancestor"]);
  assert.deepEqual(codes("$trigger.a", "$steps.after.x"), ["binding_ancestor"], "a later step is no ancestor");
  assert.deepEqual(codes("$vars.key"), ["secret_var_text"]);
});
