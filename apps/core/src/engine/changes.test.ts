import assert from "node:assert/strict";
import { test } from "node:test";
import { textDiff } from "./changes.ts";

test("text snapshots preserve unchanged context and exact net line counts", async () => {
  const diff = await textDiff("Keep\nOld\nEnd\n", "Keep\nNew\nEnd\n");
  assert.ok(diff);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.match(diff.diff, / Keep\n-Old\n\+New\n End\n/);
  assert.equal(diff.truncated, false);
  assert.deepEqual(await textDiff("Same", "Same"), { diff: "", added: 0, removed: 0, truncated: false });
});

test("truncation bounds stored patches without losing total counts or headers", async () => {
  const diff = await textDiff("", `${"Added\n".repeat(1000)}`, 100);
  assert.ok(diff);
  assert.equal(diff.diff.length, 100);
  assert.match(diff.diff, /^@@ -0,0 \+1,1000 @@/);
  assert.equal(diff.added, 1000);
  assert.equal(diff.removed, 0);
  assert.equal(diff.truncated, true);
  assert.equal(await textDiff("Old\0", "New\0"), undefined);
});
