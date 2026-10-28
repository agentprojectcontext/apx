import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { connectNodes, moveNode, newNode, removeNode } from "./graph-edit.ts";

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
