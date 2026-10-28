import assert from "node:assert/strict";
import { test } from "node:test";
import { FlowBinding, FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { resolveFlowBinding, validateFlowGraph } from "./flow-graph-validate.ts";

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    { id: "start", label: "Webhook", kind: "webhook" },
    { id: "save", label: "Save", kind: "table_write", key: "latest", value: { kind: "event", path: [] } },
  ],
  edges: [{ source: "start", target: "save" }],
  layout: [],
};

test("graph validation accepts connected data paths and rejects cycles, disconnected nodes and invalid references", () => {
  assert.deepEqual(validateFlowGraph(graph), []);
  const codes = (value: FlowGraph) => validateFlowGraph(value).map((issue) => issue.code);
  assert.ok(codes({ ...graph, edges: [...graph.edges, { source: "save", target: "start" }] }).includes("cycle"));
  assert.ok(codes({ ...graph, edges: [] }).includes("disconnected"));
  assert.ok(
    codes({ ...graph, nodes: [...graph.nodes, graph.nodes[0] as FlowGraph["nodes"][number]] }).includes(
      "duplicate_node",
    ),
  );
  assert.ok(codes({ ...graph, edges: [{ source: "missing", target: "save" }] }).includes("unknown_endpoint"));
  assert.ok(codes({ ...graph, edges: [...graph.edges, ...graph.edges] }).includes("duplicate_edge"));
  assert.ok(
    codes({
      ...graph,
      nodes: [
        graph.nodes[0] as FlowGraph["nodes"][number],
        {
          id: "save",
          label: "Save",
          kind: "table_write",
          key: "latest",
          value: { kind: "node", node: "save", path: [] },
        },
      ],
    }).includes("binding_ancestor"),
  );
  assert.ok(codes({ ...graph, layout: [{ node: "missing", x: 0, y: 0 }] }).includes("layout_node"));
});

test("array bindings admit only existing canonical JSON indices", () => {
  const event = ["first", "second"];
  const outputs = new Map([["source", event]]);
  for (const binding of [{ kind: "event" } as const, { kind: "node", node: "source" } as const]) {
    assert.equal(resolveFlowBinding({ ...binding, path: ["0"] }, event, outputs), "first");
    assert.equal(resolveFlowBinding({ ...binding, path: ["1"] }, event, outputs), "second");
    for (const segment of ["length", "01", "-1", "+0", "1.0", "1e0", "2", "4294967295"])
      assert.throws(() => resolveFlowBinding({ ...binding, path: [segment] }, event, outputs), /unavailable/);
  }
  const decorated = Object.assign(["first"], { "01": "alias", extra: "not JSON" });
  for (const segment of ["01", "extra"])
    assert.throws(() => resolveFlowBinding({ kind: "event", path: [segment] }, decorated, outputs), /unavailable/);
  assert.equal(resolveFlowBinding({ kind: "event", path: ["length"] }, { length: "field" }, outputs), "field");
});

test("exported binding resolver rejects own accessors without invoking them", () => {
  let calls = 0;
  const getter = {
    enumerable: true,
    get: () => {
      calls++;
      return "secret";
    },
  };
  const event = Object.defineProperty({}, "text", getter);
  const list = Object.defineProperty([], "0", getter);
  const outputs = new Map<string, unknown>([["source", { nested: event }]]);
  assert.throws(() => resolveFlowBinding({ kind: "event", path: ["text"] }, event, outputs), /unavailable/);
  assert.throws(() => resolveFlowBinding({ kind: "event", path: ["0"] }, list, outputs), /unavailable/);
  assert.throws(
    () => resolveFlowBinding({ kind: "node", node: "source", path: ["nested", "text"] }, null, outputs),
    /unavailable/,
  );
  assert.equal(calls, 0);
});

test("bindings resolve own data without interpreting expressions or admitting dangerous paths", () => {
  const event = { text: "{{ process.env }}", nested: { value: null } };
  assert.equal(resolveFlowBinding({ kind: "event", path: ["text"] }, event, new Map()), "{{ process.env }}");
  assert.equal(resolveFlowBinding({ kind: "event", path: ["nested", "value"] }, event, new Map()), null);
  assert.equal(
    resolveFlowBinding(
      { kind: "node", node: "model", path: ["text"] },
      event,
      new Map([["model", { text: "result" }]]),
    ),
    "result",
  );
  assert.throws(() => resolveFlowBinding({ kind: "event", path: ["absent"] }, event, new Map()), /unavailable/);
  assert.throws(() => resolveFlowBinding({ kind: "event", path: ["toString"] }, event, new Map()), /unavailable/);
  assert.throws(() => resolveFlowBinding({ kind: "node", node: "missing", path: [] }, event, new Map()), /unavailable/);
  for (const segment of ["__proto__", "constructor", "prototype"])
    assert.equal(FlowBinding.safeParse({ kind: "event", path: [segment] }).success, false);
  assert.equal(FlowBinding.safeParse({ kind: "literal", value: {}, method: "shell" }).success, false);
  assert.equal(FlowGraph.safeParse({ ...graph, schemaVersion: 3 }).success, false);
});
