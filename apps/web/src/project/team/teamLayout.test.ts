import assert from "node:assert/strict";
import { test } from "node:test";
import { branchOf, layoutTeam, NODE } from "./teamLayout.ts";

const m = (id: string, parent?: string, area?: string) => ({ id, slug: id, parent, area, name: id });

test("a parent sits centred over its children; agents without a parent hang under the lead", () => {
  const l = layoutTeam([m("lead"), m("a", "lead"), m("b"), m("c", "a")], "lead");
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
  assert.equal(at.lead?.depth, 0);
  assert.equal(at.b?.depth, 1, "no parent: under the lead");
  assert.equal(at.c?.depth, 2);
  const kids = [at.a, at.b].map((n) => (n?.x ?? 0) + NODE.w / 2);
  assert.equal((at.lead?.x ?? 0) + NODE.w / 2, (Math.min(...kids) + Math.max(...kids)) / 2);
  assert.equal(l.edges.length, 3);
});

test("siblings are grouped by area with one pill per group; no area, no pill", () => {
  const l = layoutTeam(
    [m("lead"), m("x", "lead", "sports"), m("y", "lead", "product"), m("z", "lead", "product"), m("w", "lead")],
    "lead",
  );
  assert.deepEqual(
    l.pills.map((p) => [p.area, p.count]),
    [
      ["product", 2],
      ["sports", 1],
    ],
  );
  const order = l.nodes
    .filter((n) => n.depth === 1)
    .sort((a, b) => a.x - b.x)
    .map((n) => n.id);
  assert.deepEqual(order, ["y", "z", "x", "w"], "areas first, alphabetically; no area last");
});

test("a loop in parent: is broken instead of hanging the layout; nodes never overlap", () => {
  const l = layoutTeam([m("a", "b"), m("b", "a"), m("c", "a")]);
  assert.equal(l.nodes.length, 3);
  const rows = new Map<number, number[]>();
  for (const n of l.nodes) rows.set(n.depth, [...(rows.get(n.depth) ?? []), n.x]);
  for (const xs of rows.values()) {
    xs.sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) assert.ok((xs[i] ?? 0) - (xs[i - 1] ?? 0) >= NODE.w);
  }
});

test("the branch of a node: its way up and its children", () => {
  const l = layoutTeam([m("lead"), m("a", "lead"), m("b", "lead"), m("c", "a")], "lead");
  assert.deepEqual([...branchOf(l, "a")].sort(), ["a", "c", "lead"]);
});

test("many direct reports without teams go in bands by area, at most 4 columns wide, never overlapping", () => {
  const areas = ["design", "engineering", "engineering", "engineering", "engineering", "finance", "growth", "growth"];
  const members = [
    { id: "lead", slug: "lead", name: "Lead" },
    ...areas.map((area, i) => ({ id: `a${i}`, slug: `a${i}`, name: `A${i}`, area, parent: "lead" })),
  ];
  const l = layoutTeam(members, "lead");
  const cols = new Set(l.nodes.filter((n) => n.id !== "lead").map((n) => n.x)).size;
  assert.ok(cols <= 4, `columns: ${cols}`);
  assert.ok(new Set(l.nodes.map((n) => n.y)).size >= 3, "more than one band");
  for (const a of l.nodes)
    for (const b of l.nodes)
      if (a !== b)
        assert.ok(Math.abs(a.x - b.x) >= NODE.w || Math.abs(a.y - b.y) >= NODE.h, `${a.id} overlaps ${b.id}`);
  assert.deepEqual(
    l.pills.map((p) => [p.area, p.count]),
    [
      ["design", 1],
      ["engineering", 4],
      ["finance", 1],
      ["growth", 2],
    ],
  );
});

test("global agents have no slug: their parent is named by id", () => {
  const g = (id: string, parent?: string) => ({ id, parent, name: id });
  const l = layoutTeam([g("roby"), g("lead"), g("analyst", "lead")], "roby");
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
  assert.equal(at.lead?.depth, 1);
  assert.equal(at.analyst?.depth, 2, "under its parent, not under the lead");
});
