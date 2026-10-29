import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionError, disconnectNodes, layoutFlow, newNode, placeSteps } from "./flow-edit.ts";
import type { FlowGraph } from "./flow-graph.ts";

const step = (id: string) => newNode("js", id, id);
const branched: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    newNode("webhook", "hook", "Hook"),
    newNode("condition", "check", "Check"),
    step("yes"),
    step("no"),
    step("join"),
  ],
  edges: [
    { source: "hook", target: "check" },
    { source: "check", target: "yes", when: "yes" },
    { source: "check", target: "no", when: "no" },
    { source: "yes", target: "join" },
    { source: "no", target: "join" },
  ],
  layout: [],
};

test("a drawing is laid out left to right, branches in rows around the path", () => {
  assert.deepEqual(
    layoutFlow(branched).map((p) => [p.node, p.x, p.y]),
    [
      ["hook", 0, 0],
      ["check", 280, 0],
      ["yes", 560, -80],
      ["no", 560, 80],
      ["join", 840, 0],
    ],
  );
});

test("steps keep their places and a new one goes beside the step before it, on a free row", () => {
  const placed = placeSteps(branched);
  const grown: FlowGraph = {
    ...placed,
    nodes: [...placed.nodes, step("extra")],
    edges: [...placed.edges, { source: "check", target: "extra", when: "no" }],
  };
  const out = placeSteps(grown);
  assert.deepEqual(out.layout.slice(0, 5), placed.layout);
  // Right of the check both branches are taken: it goes below them.
  assert.deepEqual(out.layout.at(-1), { node: "extra", x: 560, y: 240 });
  const again = placeSteps({
    ...out,
    nodes: [...out.nodes, step("more")],
    edges: [...out.edges, { source: "check", target: "more" }],
  });
  assert.deepEqual(again.layout.at(-1), { node: "more", x: 560, y: -240 });
});

test("a loop, a trigger as a target and a join that is not there are refused", () => {
  assert.equal(connectionError(branched, "join", "check"), "cycle");
  assert.equal(connectionError(branched, "join", "hook"), "trigger");
  assert.equal(connectionError(branched, "join", "ghost"), "missing");
  assert.equal(disconnectNodes(branched, "yes", "join").edges.length, 4);
});
