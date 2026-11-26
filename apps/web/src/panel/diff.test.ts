import assert from "node:assert/strict";
import { test } from "node:test";
import { patchRows, wholeFileRows } from "./diff.ts";

const patch = ["diff --git a/a.ts b/a.ts", "@@ -2,3 +2,3 @@", " two", "-three", "+THREE", " four"].join("\n");
const after = "one\ntwo\nTHREE\nfour\nfive\n";

test("patch rows number each line on its own side", () => {
  const { rows } = patchRows(patch);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.n ?? null, r.text]),
    [
      ["hunk", null, "@@ -2,3 +2,3 @@"],
      ["ctx", 2, "two"],
      ["del", 3, "three"],
      ["add", 3, "THREE"],
      ["ctx", 4, "four"],
    ],
  );
});

test("the whole file keeps every line and marks the change in place", () => {
  const rows = wholeFileRows(patch, after);
  assert.deepEqual(
    rows?.map((r) => [r.kind, r.n, r.text]),
    [
      ["ctx", 1, "one"],
      ["ctx", 2, "two"],
      ["del", 3, "three"],
      ["add", 3, "THREE"],
      ["ctx", 4, "four"],
      ["ctx", 5, "five"],
    ],
  );
});

test("a removal at the end and a new file read whole", () => {
  const removed = ["@@ -2,2 +1,0 @@", "-b", "-c"].join("\n");
  assert.deepEqual(
    wholeFileRows(removed, "a\n")?.map((r) => [r.kind, r.text]),
    [
      ["ctx", "a"],
      ["del", "b"],
      ["del", "c"],
    ],
  );
  const created = ["@@ -0,0 +1,2 @@", "+x", "+y"].join("\n");
  assert.deepEqual(
    wholeFileRows(created, "x\ny\n")?.map((r) => r.kind),
    ["add", "add"],
  );
});

test("a file that changed again since the patch is not merged", () => {
  assert.equal(wholeFileRows(patch, "one\ntwo\nthree, edited later\nfour\n"), undefined);
  assert.equal(wholeFileRows("Binary files a and b differ", "x"), undefined);
});
