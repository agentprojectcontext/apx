import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { newNode } from "./graph-edit.ts";
import {
  SECRET_FIELDS,
  SECRET_PATTERN,
  savedTableBefore,
  TEMPLATE_PATTERN,
  type TemplateFieldKind,
  tableName,
  valueGroups,
} from "./values.ts";

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
      agent: "superagent",
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

test("secrets are offered only in fields a step reads them itself: a header, a command's environment, a variable", () => {
  assert.deepEqual([...SECRET_FIELDS].sort(), ["env", "header", "varText"]);
  assert.ok(inserts("call", "header").includes("secret://acme_key"));
  assert.ok(inserts("call", "env").includes("secret://acme_key"));
  for (const field of ["message", "body", "sqlValue", "stdin", "key", "formula"] as const)
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

const withSecretVar: FlowGraph = {
  ...graph,
  nodes: graph.nodes.map((n) =>
    n.id === "set" && n.kind === "vars"
      ? { ...n, vars: [...n.vars, { name: "token", value: { kind: "literal" as const, value: "secret://acme_key" } }] }
      : n,
  ),
};
const action = { label: "Save a secret", onSelect: () => undefined };

test("a variable's value offers only secrets, and the secrets group always offers to save one", () => {
  const groups = valueGroups(withSecretVar, hook, "varText", [], t, (k) => k, action);
  assert.deepEqual(
    groups.map((g) => [g.label, g.values.length, g.action?.label]),
    [["flow.v.secrets", 0, "Save a secret"]],
  );
});

test("a variable holding a secret is offered, as a secret, only where secrets are read", () => {
  const at = (field: TemplateFieldKind) =>
    valueGroups(withSecretVar, withSecretVar.nodes.find((n) => n.id === "tell") ?? hook, field, [], t, (k) => k)
      .flatMap((g) => g.values)
      .find((v) => v.insert === "$vars.token");
  assert.equal(at("header")?.secret, true);
  assert.equal(at("env")?.secret, true);
  for (const field of ["message", "body", "stdin", "key", "formula"] as const)
    assert.equal(at(field), undefined, field);
});

test("a formula offers what arrived, steps and variables, but not APX's own values", () => {
  assert.ok(!inserts("tell", "formula").some((v) => v.startsWith("$apx")));
  assert.ok(inserts("tell", "formula").includes("$vars.tier"));
});

test("a read after a save on a table is offered that table; typed names become table names", () => {
  const save = { ...newNode("table_write", "keep", "Keep"), table: "leads" };
  const read = newNode("table_read", "look", "Look");
  const g: FlowGraph = {
    schemaVersion: 2,
    nodes: [hook, save, read],
    edges: [
      { source: "start", target: "keep" },
      { source: "keep", target: "look" },
    ],
    layout: [],
  };
  assert.equal(savedTableBefore(g, "look"), "leads");
  assert.equal(savedTableBefore(g, "keep"), undefined);
  assert.equal(tableName("Leads de Señal 2"), "leads_de_senal_2");
  assert.equal(tableName("  __x"), "x");
});

test("a read's columns are offered to the steps after it, each as $steps.<read>.<column>", () => {
  const read = {
    id: "read",
    kind: "table_read" as const,
    label: "Read leads",
    table: "leads",
    keys: ["$trigger.email"],
  };
  const g: FlowGraph = {
    schemaVersion: 2,
    nodes: [hook, read, newNode("notify", "tell", "Tell")],
    edges: [
      { source: "start", target: "read" },
      { source: "read", target: "tell" },
    ],
    layout: [],
  };
  const columns = (table: string) => (table === "leads" ? ["name", "email"] : []);
  const tell = g.nodes.find((n) => n.id === "tell") ?? hook;
  const offered = valueGroups(g, tell, "message", [], t, (k) => k, undefined, columns).flatMap((x) =>
    x.values.map((v) => v.insert),
  );
  assert.ok(offered.includes("$steps.read.rows"));
  assert.ok(offered.includes("$steps.read.name"));
  assert.ok(offered.includes("$steps.read.email"));
  // A column's value never offers a secret: it is saved as text in the table.
  assert.ok(!SECRET_FIELDS.has("column"));
});
