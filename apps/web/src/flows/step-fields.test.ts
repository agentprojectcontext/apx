// The editor's pure parts of a check's comparisons, a read's columns and a save's whole value and required columns
// (DECISIONS.md#d-180).
import assert from "node:assert/strict";
import { test } from "node:test";
import { newNode } from "../../../../packages/protocol/src/flow-edit.ts";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { comparisonText, newComparison, rulesText, withOp, withType } from "./compare.ts";
import { blankWith, requiredGap } from "./complete.ts";
import { bindingOfTemplate, readColumns, templateOfBinding, valueGroups } from "./values.ts";

const LABELS: Record<string, string> = {
  "flow.op.equals": "Is",
  "flow.op.contains": "Contains",
  "flow.op.empty": "Is empty",
  "flow.op.gt": "Is greater than",
  "flow.f.and": "And",
  "flow.f.or": "Or",
  "flow.f.yes": "Yes",
};
const t = (key: string) => LABELS[key] ?? key;

test("a comparison read as another type keeps what still makes sense", () => {
  const contains = { ...newComparison("$trigger.email"), op: "contains" as const, right: "@" };
  // A number offers no contains: it starts at "is", the value kept.
  assert.deepEqual(withType(contains, "number"), { ...contains, type: "number", op: "equals" });
  // A yes or no starts at yes; back to text it starts empty.
  const yes = withType(contains, "boolean");
  assert.deepEqual([yes.op, yes.right], ["equals", "true"]);
  assert.deepEqual([withType(yes, "text").right, withType(yes, "text").op], ["", "equals"]);
  // Is empty reads the field alone: what it compared with goes.
  assert.equal(withOp(contains, "empty").right, "");
  assert.equal(withOp({ ...yes, right: "" }, "not_equals").right, "true");
});

test("a case reads in one line, the labels continuing the sentence", () => {
  const rules = [
    { left: "$trigger.ok", op: "equals" as const, right: "true", type: "boolean" as const },
    { left: "$trigger.email", op: "contains" as const, right: "@", type: "text" as const },
    { left: "$trigger.note", op: "empty" as const, right: "", type: "text" as const },
  ];
  assert.equal(
    rulesText({ kind: "all", rules }, t),
    "$trigger.ok is yes and $trigger.email contains @ and $trigger.note is empty",
  );
  assert.equal(rulesText({ kind: "any", rules: rules.slice(1, 2) }, t), "$trigger.email contains @");
  assert.equal(comparisonText(newComparison(), t), "… is …");
});

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    newNode("webhook", "start", "Start"),
    { id: "set", kind: "vars", label: "Set", vars: [{ name: "tier", value: { kind: "literal", value: "gold" } }] },
    { id: "lookup", kind: "table_read", label: "Lookup", table: "leads", keys: ["$trigger.email"], columns: ["name"] },
    { id: "save", kind: "table_write", label: "Save", table: "leads", key: "k", value: { kind: "event", path: [] } },
  ],
  edges: [
    { source: "start", target: "set" },
    { source: "set", target: "lookup" },
    { source: "lookup", target: "save" },
  ],
  layout: [],
};

test("a whole value's field and its binding go both ways", () => {
  const cases: [string, unknown][] = [
    ["$trigger", { kind: "event", path: [] }],
    ["$trigger.form.email", { kind: "event", path: ["form", "email"] }],
    ["$steps.lookup.row", { kind: "node", node: "lookup", path: ["row"] }],
    ["$vars.tier", { kind: "node", node: "set", path: ["tier"] }],
    ["plain text", { kind: "literal", value: "plain text" }],
  ];
  for (const [text, binding] of cases) {
    assert.deepEqual(bindingOfTemplate(text, graph), binding, text);
    assert.equal(templateOfBinding(bindingOfTemplate(text, graph), graph), text);
  }
  // Empty is everything that arrived; text around a placeholder is saved as typed.
  assert.deepEqual(bindingOfTemplate("  ", graph), { kind: "event", path: [] });
  assert.deepEqual(bindingOfTemplate("Hi $trigger.name", graph), { kind: "literal", value: "Hi $trigger.name" });
});

test("a read brings the columns it ticked, in the table's order, and only those reach the picker", () => {
  assert.deepEqual(readColumns({ columns: ["phone", "name"] }, ["name", "email", "phone"]), ["name", "phone"]);
  assert.deepEqual(readColumns({}, ["name", "email"]), ["name", "email"]);
  const save = graph.nodes[3] as FlowNode;
  const steps = valueGroups(
    graph,
    save,
    "column",
    [],
    t,
    (k) => k,
    undefined,
    () => ["name", "email"],
  ).find((g) => g.label === "flow.v.steps");
  const inserts = steps?.values.map((v) => v.insert) ?? [];
  assert.ok(inserts.includes("$steps.lookup.name"));
  assert.ok(!inserts.includes("$steps.lookup.email"));
  // A whole value offers nothing of APX's own: it would be saved as its text.
  assert.ok(!valueGroups(graph, save, "whole", [], t, (k) => k).some((g) => g.label === "flow.v.apx"));
});

test("a save by column that leaves a required column without a value is unfinished", () => {
  const save = {
    ...(newNode("table_write", "save-2", "Save") as Extract<FlowNode, { kind: "table_write" }>),
    table: "leads",
    key: "$trigger.email",
    columns: [{ name: "email", value: "$trigger.email" }],
  };
  const required = (table: string) => (table === "leads" ? ["email", "phone"] : []);
  assert.equal(requiredGap(save, required), "columns");
  assert.equal(blankWith(required)(save), true);
  const filled = { ...save, columns: [...save.columns, { name: "phone", value: "$trigger.phone" }] };
  assert.equal(requiredGap(filled, required), undefined);
  assert.equal(
    requiredGap({ ...filled, columns: [...save.columns, { name: "phone", value: "  " }] }, required),
    "columns",
  );
  // A table nobody required anything of, or a value saved whole, is checked when it runs.
  assert.equal(requiredGap({ ...save, table: "other" }, required), undefined);
});
