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

const noOverlap = (l: ReturnType<typeof layoutTeam>) => {
  for (const a of l.nodes)
    for (const b of l.nodes)
      if (a !== b)
        assert.ok(Math.abs(a.x - b.x) >= NODE.w || Math.abs(a.y - b.y) >= NODE.h, `${a.id} overlaps ${b.id}`);
};

test("a parent named by its full id is that agent, as by its slug", () => {
  const p = (slug: string, parent?: string) => ({ id: `acme-${slug}`, slug, parent, name: slug });
  const l = layoutTeam([p("lead"), p("reels", "lead"), p("sub", "acme-reels"), p("w", "sub")], "acme-lead");
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
  assert.equal(at["acme-sub"]?.depth, 2, "under reels, not hung under the lead");
  assert.equal(at["acme-w"]?.depth, 3);
});

test("tidy tree: a single-child chain does not widen its row and siblings pack beside it", () => {
  const team = [
    m("lead"),
    m("a", "lead"),
    m("reels", "lead"),
    m("z", "lead"),
    m("sub", "reels"),
    ...["w1", "w2", "w3", "w4"].map((w) => m(w, "sub")),
  ];
  const l = layoutTeam(team, "lead");
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
  const step = NODE.w + NODE.gapX;
  assert.equal(at.sub?.x, at.reels?.x, "one child sits right under its parent");
  assert.equal((at.reels?.x ?? 0) - (at.a?.x ?? 0), step, "siblings side by side, no gap for the subtree below");
  assert.equal((at.z?.x ?? 0) - (at.reels?.x ?? 0), step);
  assert.equal(at.lead?.x, at.reels?.x, "the lead centred over its first and last child");
  assert.equal(l.width, 4 * NODE.w + 3 * NODE.gapX, "as wide as its widest row, no wider");
  noOverlap(l);
});

test("tidy tree: deep, banded and loose subtrees together never overlap and stay in order", () => {
  const team = [
    m("lead"),
    m("big", "lead", "ops"),
    ...Array.from({ length: 7 }, (_, i) => m(`b${i}`, "big", i % 2 ? "x" : "y")),
    m("deep", "lead", "ops"),
    m("d1", "deep"),
    m("d2", "d1"),
    m("d3", "d2"),
    m("d3b", "d2"),
    m("solo", "lead"),
    m("other"),
  ];
  const l = layoutTeam(team, "lead");
  noOverlap(l);
  const row = l.nodes.filter((n) => n.depth === 1).sort((p, q) => p.x - q.x);
  assert.deepEqual(
    row.map((n) => n.id),
    ["big", "deep", "other", "solo"],
  );
  assert.ok(Math.min(...l.nodes.map((n) => n.x)) === 0, "starts at the left edge");
  assert.ok(Math.max(...l.nodes.map((n) => n.x + NODE.w)) === l.width);
});
