import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { askWords, freshSteps, sameGraph, takeAgentDraft } from "./agentDraft.ts";
import { connectNodes, newNode } from "./graph-edit.ts";

type Step = FlowGraph["nodes"][number];

const base = (): FlowGraph =>
  connectNodes(
    {
      schemaVersion: 2,
      nodes: [
        newNode("webhook", "hook", "New lead"),
        { ...newNode("js", "clean", "Clean it"), code: "return input;" },
      ] as Step[],
      edges: [],
      layout: [
        { node: "hook", x: 0, y: 0 },
        { node: "clean", x: 280, y: 0 },
      ],
    },
    "hook",
    "clean",
  );
const withSave = (g: FlowGraph): FlowGraph =>
  connectNodes(
    {
      ...g,
      nodes: [...g.nodes, { ...newNode("table_write", "save", "Save it"), key: "latest", table: "leads" } as Step],
      layout: [...g.layout, { node: "save", x: 560, y: 0 }],
    },
    "clean",
    "save",
  );

test("a drawing read back with its fields in another order is the same drawing", () => {
  const g = base();
  const shuffled = JSON.parse(
    JSON.stringify(g, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    ),
  ) as FlowGraph;
  assert.ok(sameGraph(g, shuffled));
  assert.deepEqual(takeAgentDraft(g, g, shuffled), { kind: "same" });
});

test("an agent's drawing replaces a canvas with nothing unsaved, marking what is new and what changed", () => {
  const saved = base();
  const incoming = withSave({
    ...saved,
    nodes: saved.nodes.map((n) => (n.id === "clean" ? { ...n, label: "Clean the lead" } : n)),
  });
  const take = takeAgentDraft(saved, saved, incoming);
  assert.equal(take.kind, "take");
  assert.ok(take.kind === "take");
  assert.equal(take.graph, incoming);
  assert.deepEqual(
    [...take.fresh],
    [
      ["clean", "changed"],
      ["save", "new"],
    ],
  );
});

test("the owner's unsaved edits stay on the canvas when an agent saves", () => {
  const saved = base();
  const local = { ...saved, layout: saved.layout.map((p) => ({ ...p, y: 40 })) };
  assert.deepEqual(takeAgentDraft(local, saved, withSave(saved)), { kind: "keep" });
});

test("a step moved is not marked; a step connected anew is", () => {
  const before = withSave(base());
  const moved = { ...before, layout: before.layout.map((p) => ({ ...p, y: 80 })) };
  assert.equal(freshSteps(before, moved).size, 0);
  const rewired = connectNodes({ ...before, edges: before.edges.filter((e) => e.target !== "save") }, "hook", "save");
  assert.deepEqual([...freshSteps(before, rewired)], [["save", "changed"]]);
});

test("the editor's notes come before the owner's words, which stay last", () => {
  assert.equal(askWords("add a step", []), "add a step");
  assert.equal(askWords("add a step", [undefined, "[Flow editor]"]), "[Flow editor]\n\nadd a step");
  assert.equal(askWords("go", ["[a]", "[b]"]), "[a]\n[b]\n\ngo");
});
