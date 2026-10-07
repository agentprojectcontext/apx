import assert from "node:assert/strict";
import { test } from "node:test";
import { graphRows } from "./git-graph.ts";

test("a straight history is one column, each commit joined to the next", () => {
  const rows = graphRows([
    { sha: "c", parents: ["b"] },
    { sha: "b", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.col, r.into, r.out]),
    [
      [0, [], [0]],
      [0, [0], [0]],
      [0, [0], []],
    ],
  );
});

test("a merge opens a second column for its other parent, which closes where that branch began", () => {
  // m merges s (a side branch off a) into main (b → a).
  const rows = graphRows([
    { sha: "m", parents: ["b", "s"] },
    { sha: "s", parents: ["a"] },
    { sha: "b", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  assert.deepEqual(rows[0], { col: 0, through: [], into: [], out: [0, 1], width: 2 });
  // The side commit sits in column 1 while main's line passes by in column 0.
  assert.equal(rows[1]?.col, 1);
  assert.deepEqual(rows[1]?.through, [0]);
  // Both lines meet again at a: two lines come into it.
  assert.deepEqual(rows[3]?.into, [0, 1]);
  assert.equal(rows[3]?.col, 0);
});

test("two branch tips start in their own columns", () => {
  const rows = graphRows([
    { sha: "x", parents: ["a"] },
    { sha: "y", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  assert.deepEqual(
    rows.map((r) => r.col),
    [0, 1, 0],
  );
  assert.deepEqual(rows[2]?.into, [0, 1]);
});
