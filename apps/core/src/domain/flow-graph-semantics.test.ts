import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import {
  boundedFlowValue,
  evaluateFlowCondition,
  type FlowNodeSnapshot,
  type FlowNodeState,
  flowGraphOrder,
  planFlowGraphStep,
  resolveFlowInput,
  summarizeFlowGraph,
} from "./flow-graph-semantics.ts";
import { validateFlowGraph } from "./flow-graph-validate.ts";

const condition: Extract<FlowNode, { kind: "condition" }> = {
  id: "A",
  label: "Filter",
  kind: "condition",
  input: { kind: "event", path: ["accepted"] },
  equals: true,
};
const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    { id: "start", label: "Webhook", kind: "webhook" },
    condition,
    { id: "a", label: "Read", kind: "table_read", keys: ["latest"] },
    { id: "join", label: "Save", kind: "table_write", key: "latest", value: { kind: "event", path: [] } },
    { id: "end", label: "Read result", kind: "table_read", keys: ["latest"] },
  ],
  edges: [
    { source: "start", target: "a" },
    { source: "start", target: "A" },
    { source: "A", target: "join" },
    { source: "a", target: "join" },
    { source: "join", target: "end" },
  ],
  layout: [],
};
function snapshot(overrides: Record<string, FlowNodeSnapshot> = {}): Map<string, FlowNodeSnapshot> {
  return new Map(graph.nodes.map((node) => [node.id, overrides[node.id] ?? { state: "pending" }]));
}
const done: FlowNodeSnapshot = { state: "succeeded", output: { rows: {} } };
const filtered: FlowNodeSnapshot = { state: "succeeded", output: { matched: false } };

test("topological order is ordinal and independent of arrays, edges and layout", () => {
  const expected = ["start", "A", "a", "join", "end"];
  assert.deepEqual(
    flowGraphOrder(graph).map((node) => node.id),
    expected,
  );
  assert.deepEqual(
    flowGraphOrder({
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
      layout: graph.nodes.map((node, i) => ({ node: node.id, x: -i, y: i })),
    }).map((node) => node.id),
    expected,
  );
  assert.throws(
    () => flowGraphOrder({ ...graph, edges: [...graph.edges, { source: "end", target: "start" }] }),
    /Invalid/,
  );
  assert.deepEqual(planFlowGraphStep(graph, snapshot()), [
    { node: "start", decision: "ready", reason: "parents_succeeded" },
  ]);
  assert.deepEqual(
    planFlowGraphStep(graph, snapshot({ start: done })).map((decision) => decision.node),
    ["A", "a"],
  );
});

test("AND joins wait for every parent before resolving false conditions or failures", () => {
  for (const state of ["pending", "running", "waiting_run"] as const) {
    for (const other of [filtered, { state: "failed" } as const]) {
      const decisions = planFlowGraphStep(graph, snapshot({ start: done, A: other, a: { state } }));
      assert.equal(
        decisions.some((decision) => decision.node === "join"),
        false,
      );
    }
  }
  for (const state of ["failed", "uncertain", "cancelled", "blocked"] as const) {
    assert.deepEqual(planFlowGraphStep(graph, snapshot({ start: done, A: filtered, a: { state } })), [
      { node: "join", decision: "blocked", reason: "parent_failed" },
    ]);
  }
  assert.deepEqual(planFlowGraphStep(graph, snapshot({ start: done, A: filtered, a: done })), [
    { node: "join", decision: "skipped", reason: "parent_skipped" },
  ]);
  assert.deepEqual(
    planFlowGraphStep(graph, snapshot({ start: done, A: { state: "succeeded", output: { matched: true } }, a: done })),
    [{ node: "join", decision: "ready", reason: "parents_succeeded" }],
  );
});

test("terminal propagation needs explicit next snapshots, never mutates them, and preserves independent branches", () => {
  const current = snapshot({ start: done, A: { state: "failed" }, a: done });
  const before = structuredClone(current);
  assert.deepEqual(planFlowGraphStep(graph, current), [{ node: "join", decision: "blocked", reason: "parent_failed" }]);
  assert.deepEqual(current, before);
  current.set("join", { state: "blocked" });
  assert.deepEqual(planFlowGraphStep(graph, current), [{ node: "end", decision: "blocked", reason: "parent_failed" }]);
  const independent = snapshot({ start: done, A: { state: "failed" } });
  assert.deepEqual(planFlowGraphStep(graph, independent), [
    { node: "a", decision: "ready", reason: "parents_succeeded" },
  ]);
  const skip = snapshot({ start: done, A: filtered, a: done, join: { state: "skipped" } });
  assert.deepEqual(planFlowGraphStep(graph, skip), [{ node: "end", decision: "skipped", reason: "parent_skipped" }]);
});

test("cancellation and deadline override pending joins without rewriting running or terminal nodes", () => {
  const current = snapshot({ start: done, A: { state: "waiting_run" }, a: { state: "running" } });
  for (const control of [{ cancelled: true }, { deadlineExceeded: true }]) {
    const reason = "cancelled" in control ? "cancelled" : "deadline";
    assert.deepEqual(planFlowGraphStep(graph, current, control), [
      { node: "join", decision: "cancelled", reason },
      { node: "end", decision: "cancelled", reason },
    ]);
    assert.equal(current.get("A")?.state, "waiting_run");
    assert.equal(current.get("a")?.state, "running");
  }
});

test("cancellation and deadline precede malformed condition output validation", () => {
  for (const output of [null, { matched: "false" }, {}, { matched: false, extra: true }]) {
    const current = snapshot({ start: done, A: { state: "succeeded", output }, a: done });
    const before = structuredClone(current);
    for (const control of [
      { cancelled: true },
      { deadlineExceeded: true },
      { cancelled: true, deadlineExceeded: true },
    ]) {
      const reason = control.cancelled ? "cancelled" : "deadline";
      assert.deepEqual(planFlowGraphStep(graph, current, control), [
        { node: "join", decision: "cancelled", reason },
        { node: "end", decision: "cancelled", reason },
      ]);
      assert.deepEqual(current, before);
    }
    assert.throws(() => planFlowGraphStep(graph, current), /condition/);
  }
});

test("incomplete, forged and malformed condition snapshots fail closed", () => {
  assert.throws(() => planFlowGraphStep(graph, new Map()), /snapshot/);
  const wrong = snapshot();
  wrong.delete("A");
  wrong.set("foreign", done);
  assert.throws(() => planFlowGraphStep(graph, wrong), /snapshot/);
  assert.throws(() => planFlowGraphStep(graph, snapshot({ a: { state: "forged" as FlowNodeState } })), /snapshot/);
  for (const output of [null, { matched: "false" }, {}, { matched: false, extra: true }])
    assert.throws(() => planFlowGraphStep(graph, snapshot({ A: { state: "succeeded", output } })), /condition/);
});

test("condition output requires its own matched field despite inherited booleans", () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "matched");
  try {
    for (const matched of [true, false]) {
      Object.defineProperty(Object.prototype, "matched", { configurable: true, writable: true, value: matched });
      const output = JSON.parse('{"other":true}');
      assert.throws(
        () => planFlowGraphStep(graph, snapshot({ start: done, A: { state: "succeeded", output }, a: done })),
        /condition/,
      );
      assert.deepEqual(
        planFlowGraphStep(graph, snapshot({ start: done, A: { state: "succeeded", output: { matched } }, a: done })),
        [
          {
            node: "join",
            decision: matched ? "ready" : "skipped",
            reason: matched ? "parents_succeeded" : "parent_skipped",
          },
        ],
      );
    }
  } finally {
    if (original) Object.defineProperty(Object.prototype, "matched", original);
    else Reflect.deleteProperty(Object.prototype, "matched");
  }
});

test("bindings require successful predecessors and preserve JSON values without expression execution", () => {
  const event = { accepted: false, text: "{{ process.env }}", nested: { value: null }, list: ["zero"] };
  assert.equal(resolveFlowInput({ kind: "event", path: ["text"] }, event, snapshot()), event.text);
  assert.equal(resolveFlowInput({ kind: "event", path: ["list", "0"] }, event, snapshot()), "zero");
  assert.equal(resolveFlowInput({ kind: "event", path: ["nested", "value"] }, event, snapshot()), null);
  assert.equal(resolveFlowInput({ kind: "literal", value: false }, undefined, snapshot()), false);
  for (const state of [
    "pending",
    "running",
    "waiting_run",
    "failed",
    "uncertain",
    "skipped",
    "blocked",
    "cancelled",
  ] as const)
    assert.throws(
      () =>
        resolveFlowInput({ kind: "node", node: "a", path: [] }, event, snapshot({ a: { state, output: "ignored" } })),
      /unavailable/,
    );
  const data = { text: "answer", empty: "", count: 0 };
  const current = snapshot({ a: { state: "succeeded", output: data } });
  const result = resolveFlowInput({ kind: "node", node: "a", path: [] }, event, current);
  assert.deepEqual(result, data);
  assert.notEqual(result, data);
  for (const path of [["absent"], ["toString"], ["__proto__"], ["constructor"]])
    assert.throws(() => resolveFlowInput({ kind: "event", path }, event, current), /unavailable/);
  assert.throws(() => resolveFlowInput({ kind: "node", node: "a", path: ["absent"] }, event, current), /unavailable/);
});

test("conditions use exact JSON scalar equality, not truthiness, coercion or templating", () => {
  const reads = { resolve: () => null, vars: new Map() };
  assert.deepEqual(evaluateFlowCondition(condition, true, reads), { matched: true });
  for (const input of [false, "true", 1, null, {}, [], "{{true}}"])
    assert.deepEqual(evaluateFlowCondition(condition, input, reads), { matched: false });
  assert.deepEqual(evaluateFlowCondition({ ...condition, equals: null }, null, reads), { matched: true });
});

test("bounded JSON rejects non-JSON, accessors, cycles, sparse arrays and byte/depth overflow", () => {
  let calls = 0;
  const getter = Object.defineProperty({}, "text", {
    enumerable: true,
    get: () => {
      calls++;
      return "secret";
    },
  });
  const conversion = {
    toJSON() {
      calls++;
      return "secret";
    },
  };
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    () => 1,
    new Date(),
    getter,
    conversion,
    cycle,
    [undefined],
    new Array(2),
  ])
    assert.throws(() => boundedFlowValue(value), /Invalid|limits/);
  assert.equal(calls, 0);
  assert.throws(() => boundedFlowValue("é".repeat(16384)), /32 KiB/);
  assert.equal(boundedFlowValue("a".repeat(32766)), "a".repeat(32766));
  let deep: unknown = null;
  for (let i = 0; i < 34; i++) deep = { value: deep };
  assert.throws(() => boundedFlowValue(deep), /limits/);
  const sensitive = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":"data","unknownSecret":"synthetic-value"}',
  );
  assert.deepEqual(boundedFlowValue(sensitive), sensitive);
  assert.equal(Object.hasOwn({}, "polluted"), false);
});

test("bounded JSON copies descriptors without invoking inherited object or array toJSON hooks", () => {
  for (const prototype of [Object.prototype, Array.prototype]) {
    for (const accessor of [false, true]) {
      const original = Object.getOwnPropertyDescriptor(prototype, "toJSON");
      let calls = 0;
      const hook = () => {
        calls++;
        return "rewritten";
      };
      let result: unknown;
      try {
        Object.defineProperty(prototype, "toJSON", {
          configurable: true,
          ...(accessor
            ? {
                get: () => {
                  calls++;
                  return hook;
                },
              }
            : { value: hook }),
        });
        result = boundedFlowValue({ items: [{ text: "unchanged" }], scalar: 0 });
      } finally {
        if (original) Object.defineProperty(prototype, "toJSON", original);
        else Reflect.deleteProperty(prototype, "toJSON");
      }
      assert.equal(calls, 0);
      assert.deepEqual(result, { items: [{ text: "unchanged" }], scalar: 0 });
    }
  }
});

test("execution summary waits for active branches and prioritizes uncertainty over failure", () => {
  const summarize = (...values: FlowNodeState[]) =>
    summarizeFlowGraph(new Map(values.map((state, i) => [String(i), { state }])));
  assert.equal(summarize("failed", "running"), "running");
  assert.equal(summarize("uncertain", "pending"), "pending");
  assert.equal(summarize("failed", "uncertain", "cancelled"), "uncertain");
  assert.equal(summarize("failed", "skipped"), "failed");
  assert.equal(summarize("blocked", "skipped"), "failed");
  assert.equal(summarize("cancelled", "skipped"), "cancelled");
  assert.equal(summarize("succeeded", "skipped"), "succeeded");
  assert.throws(() => summarizeFlowGraph(new Map()), /snapshot/);
  assert.throws(() => summarize("unknown" as FlowNodeState), /snapshot/);
});

test("parallel writes to one key require an explicit ancestor dependency", () => {
  const write: FlowNode = {
    id: "other",
    kind: "table_write",
    label: "Write",
    key: "latest",
    value: { kind: "literal", value: 1 },
  };
  const parallel: FlowGraph = {
    ...graph,
    nodes: [...graph.nodes, write],
    edges: [...graph.edges, { source: "start", target: "other" }],
  };
  assert.ok(validateFlowGraph(parallel).some((issue) => issue.code === "unordered_write"));
  assert.throws(() => flowGraphOrder(parallel), /Invalid/);
  assert.deepEqual(
    validateFlowGraph({ ...parallel, edges: [...parallel.edges, { source: "join", target: "other" }] }),
    [],
  );
  assert.deepEqual(validateFlowGraph({ ...parallel, nodes: [...graph.nodes, { ...write, key: "different" }] }), []);
});
