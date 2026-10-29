import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { newNode } from "./graph-edit.ts";
import { SECRET_FIELDS, SECRET_PATTERN, TEMPLATE_PATTERN, type TemplateFieldKind, valueGroups } from "./values.ts";

const t = (key: string) => key;
const hook = newNode("webhook", "start", "Start");
const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    hook,
    {
      id: "ask",
      kind: "agent",
      label: "Ask",
      agent: "roby",
      prompt: "Sort it",
      input: { kind: "event", path: ["email"] },
    },
    { id: "set", kind: "vars", label: "Set", vars: [{ name: "tier", value: { kind: "literal", value: "gold" } }] },
    newNode("http", "call", "Call"),
    newNode("notify", "tell", "Tell"),
  ],
  edges: [
    { source: "start", target: "ask" },
    { source: "ask", target: "set" },
    { source: "set", target: "call" },
    { source: "call", target: "tell" },
  ],
  layout: [],
};
const groups = (node: string, field: TemplateFieldKind) =>
  valueGroups(graph, graph.nodes.find((n) => n.id === node) ?? hook, field, ["acme_key"], t, (k) => k);
const inserts = (node: string, field: TemplateFieldKind) =>
  groups(node, field).flatMap((g) => g.values.map((v) => v.insert));

test("secrets are offered only in fields a step reads them itself: a header and a command's environment", () => {
  assert.deepEqual([...SECRET_FIELDS].sort(), ["env", "header"]);
  assert.ok(inserts("call", "header").includes("secret://acme_key"));
  assert.ok(inserts("call", "env").includes("secret://acme_key"));
  for (const field of ["message", "body", "sqlValue", "stdin"] as const)
    assert.ok(!inserts("call", field).some((v) => v.startsWith("secret://")), `${field} offers no secret`);
});

test("a field offers what arrived, the steps before it, their variables and APX's own values", () => {
  assert.deepEqual(inserts("tell", "message"), [
    "$trigger",
    "$trigger.email",
    "$steps.ask.text",
    "$steps.call.json",
    "$vars.tier",
    "$apx.project",
    "$apx.now",
    "$apx.run",
  ]);
  // A step sees nothing of what comes after it.
  assert.ok(!inserts("ask", "message").some((v) => v.startsWith("$steps.")));
  assert.deepEqual(
    groups("tell", "message").map((g) => g.label),
    ["flow.v.arrived", "flow.v.steps", "flow.v.vars", "flow.v.apx"],
  );
});

test("placeholders and secret references show as badges, secrets apart", () => {
  const found = "Hi $trigger.name, $steps.ask.text at $apx.now with secret://acme_key".match(TEMPLATE_PATTERN);
  assert.deepEqual(found, ["$trigger.name", "$steps.ask.text", "$apx.now", "secret://acme_key"]);
  assert.ok(SECRET_PATTERN.test("secret://acme_key") && !SECRET_PATTERN.test("$vars.tier"));
});
