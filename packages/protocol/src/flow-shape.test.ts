import assert from "node:assert/strict";
import { test } from "node:test";
import { FlowGraph } from "./flow-graph.ts";
import { FlowDefinition } from "./flow-methods.ts";
import { graphOfDefinition, sameShape, shapeOfDefinition, shapeOfGraph } from "./flow-shape.ts";

const label = (kind: string, i: number) => `${kind} ${i + 1}`;
const definition = FlowDefinition.parse({
  id: "leads",
  projectId: "acme",
  name: "Leads",
  enabled: true,
  predicates: [
    { path: ["type"], equals: "lead" },
    { path: ["form", "tier"], equals: "A" },
  ],
  readKeys: ["config"],
  tableKey: "latest",
  action: { kind: "agent", agent: "max", prompt: "Draft a first reply." },
});

test("a definition drawn as a graph maps back to the same definition", () => {
  const graph = FlowGraph.parse(graphOfDefinition(shapeOfDefinition(definition), label));
  assert.deepEqual(
    graph.nodes.map((n) => n.kind),
    ["webhook", "condition", "condition", "table_read", "table_write", "agent"],
  );
  const result = shapeOfGraph(graph);
  assert.equal(result.ok, true);
  assert.ok(result.ok && sameShape(result.shape, shapeOfDefinition(definition)));
  // Positions a saved graph has are kept for the same steps.
  const moved = graphOfDefinition(shapeOfDefinition(definition), label, [{ node: "save", x: 10, y: 20 }]);
  assert.deepEqual(
    moved.layout.find((p) => p.node === "save"),
    { node: "save", x: 10, y: 20 },
  );
});

test("table only and routine definitions round-trip", () => {
  for (const action of [{ kind: "none" as const }, { kind: "routine" as const, routine: "digest" }]) {
    const d = { ...definition, predicates: [], readKeys: undefined, action };
    const result = shapeOfGraph(graphOfDefinition(shapeOfDefinition(d), label));
    assert.ok(result.ok && sameShape(result.shape, shapeOfDefinition(d)), action.kind);
  }
});

test("graphs the executor cannot run say which step to fix", () => {
  const base = graphOfDefinition(shapeOfDefinition(definition), label);
  const cases: [string, FlowGraph, string, string?][] = [
    ["no trigger", { ...base, nodes: base.nodes.filter((n) => n.kind !== "webhook") }, "trigger"],
    [
      "branch",
      {
        ...base,
        nodes: [
          ...base.nodes,
          { id: "other", kind: "routine", label: "Other", routine: "r", input: { kind: "event", path: [] } },
        ],
        edges: [...base.edges, { source: "save", target: "other" }],
      },
      "branch",
      "save",
    ],
    [
      "loose step",
      { ...base, nodes: [...base.nodes, { id: "lost", kind: "table_read", label: "Lost", keys: ["x"] }] },
      "loose",
      "lost",
    ],
    [
      "no save",
      {
        ...base,
        nodes: base.nodes.filter((n) => n.id !== "save"),
        edges: [
          { source: "trigger", target: "check-1" },
          { source: "check-1", target: "check-2" },
          { source: "check-2", target: "read" },
          { source: "read", target: "action" },
        ],
      },
      "save",
    ],
    [
      "check after save",
      {
        ...base,
        edges: [
          { source: "trigger", target: "save" },
          { source: "save", target: "check-1" },
          { source: "check-1", target: "check-2" },
          { source: "check-2", target: "read" },
          { source: "read", target: "action" },
        ],
      },
      "order",
      "check-1",
    ],
    [
      "check reading another step",
      {
        ...base,
        nodes: base.nodes.map((n) =>
          n.id === "check-1" ? { ...n, input: { kind: "node" as const, node: "read", path: ["x"] } } : n,
        ),
      },
      "check",
      "check-1",
    ],
    [
      "model step",
      {
        ...base,
        nodes: base.nodes.map((n) =>
          n.id === "action"
            ? {
                id: "action",
                kind: "llm" as const,
                label: "Model",
                model: "m",
                prompt: "p",
                input: { kind: "event" as const, path: [] },
                maxOutputTokens: 10,
                timeoutMs: 30000,
              }
            : n,
        ),
      },
      "kind",
      "action",
    ],
  ];
  for (const [name, graph, code, node] of cases) {
    const result = shapeOfGraph(graph);
    assert.equal(result.ok, false, name);
    if (!result.ok) {
      assert.equal(result.problem.code, code, name);
      if (node) assert.equal(result.problem.node, node, name);
    }
  }
});

test("a changed setting is a different shape", () => {
  const shape = shapeOfDefinition(definition);
  assert.equal(sameShape(shape, { ...shape, tableKey: "other" }), false);
  assert.equal(sameShape(shape, { ...shape }), true);
});
