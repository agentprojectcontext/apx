import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { connectNodes, moveNode, newNode, nextCaseId, removeCase, removeNode, withCases } from "./graph-edit.ts";

const graph = (): FlowGraph => ({
  schemaVersion: 2,
  nodes: [newNode("webhook", "start", "Start"), newNode("llm", "model", "Model")],
  edges: [],
  layout: [],
});
test("connections reject missing endpoints, duplicates and self links without mutating the draft", () => {
  const original = graph();
  assert.equal(connectNodes(original, "start", "missing"), original);
  assert.equal(connectNodes(original, "start", "start"), original);
  const connected = connectNodes(original, "start", "model");
  assert.deepEqual(original.edges, []);
  assert.deepEqual(connected.edges, [{ source: "start", target: "model" }]);
  assert.equal(connectNodes(connected, "start", "model"), connected);
});
test("removing a node removes its connections and layout but preserves other configuration", () => {
  const original = moveNode(connectNodes(graph(), "start", "model"), "model", 10, 20);
  const updated = removeNode(original, "model");
  assert.deepEqual(updated.edges, []);
  assert.deepEqual(updated.layout, []);
  assert.deepEqual(updated.nodes, [original.nodes[0]]);
  assert.equal(original.nodes.length, 2);
});
test("moving replaces a position and respects contract bounds", () => {
  const original = moveNode(graph(), "model", 10, 20);
  const updated = moveNode(original, "model", 200000, -200000);
  assert.deepEqual(updated.layout, [{ node: "model", x: 100000, y: -100000 }]);
  assert.deepEqual(original.layout, [{ node: "model", x: 10, y: 20 }]);
});

test("connections reject cycles, duplicate links and inputs to a webhook", () => {
  const base = graph();
  const connected = connectNodes(base, "start", "model");
  assert.equal(connectNodes(connected, "model", "start"), connected);
  const third = { ...connected, nodes: [...connected.nodes, newNode("condition", "condition", "Condition")] };
  const chain = connectNodes(third, "model", "condition");
  assert.equal(connectNodes(chain, "condition", "model"), chain);
});

test("a connection out of a check says its branch; a step joins a check's yes and no at most once", () => {
  const base = {
    ...graph(),
    nodes: [...graph().nodes, newNode("condition", "check", "Check"), newNode("table_write", "save", "Save")],
  };
  const yes = connectNodes(base, "check", "model");
  assert.deepEqual(yes.edges, [{ source: "check", target: "model", when: "yes" }]);
  const no = connectNodes(yes, "check", "save", "no");
  assert.deepEqual(no.edges.at(-1), { source: "check", target: "save", when: "no" });
  assert.equal(connectNodes(no, "check", "save", "yes"), no);
  assert.deepEqual(connectNodes(base, "start", "check").edges, [{ source: "start", target: "check" }]);
});

test("a check grows cases: each new one has its own way out, and removing one drops the connections that used it", () => {
  const check = newNode("condition", "check", "Check");
  const base: FlowGraph = {
    ...graph(),
    nodes: [...graph().nodes, check, newNode("table_write", "save", "Save"), newNode("js", "code", "Code")],
  };
  assert.equal(check.kind === "condition" && nextCaseId(check), "c2");
  const grown = {
    ...base,
    nodes: base.nodes.map((n) =>
      n.id === "check" && n.kind === "condition"
        ? {
            ...withCases(n),
            cases: [...withCases(n).cases, { id: "c2", label: "Big", match: { kind: "expr" as const, expr: "1" } }],
          }
        : n,
    ),
  };
  const joined = connectNodes(
    connectNodes(connectNodes(grown, "check", "save", "c2"), "check", "code", "no"),
    "check",
    "model",
  );
  assert.deepEqual(
    joined.edges.map((e) => e.when),
    ["c2", "no", "yes"],
  );
  // A way out the check doesn't have becomes its first case.
  assert.equal(connectNodes(grown, "check", "save", "c9").edges[0]?.when, "yes");
  const removed = removeCase(joined, "check", "c2");
  assert.deepEqual(
    removed.edges.map((e) => [e.target, e.when]),
    [
      ["code", "no"],
      ["model", "yes"],
    ],
  );
  const after = removed.nodes.find((n) => n.id === "check");
  assert.deepEqual(after?.kind === "condition" && after.cases?.map((c) => c.id), ["yes"]);
});

test("a yes/no check drawn before cases keeps its value as its yes case", () => {
  const legacy = {
    id: "c",
    kind: "condition" as const,
    label: "C",
    input: { kind: "event" as const, path: ["tier"] },
    equals: "gold",
  };
  const cased = withCases(legacy);
  assert.equal("equals" in cased, false);
  assert.deepEqual(cased.cases, [{ id: "yes", label: "", match: { kind: "equals", value: "gold" } }]);
});
