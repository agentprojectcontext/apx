import assert from "node:assert/strict";
import { test } from "node:test";
import { addRef, refsOf, removeRef, restoreRefs, takeRefs, withRefs } from "./contextRefs.ts";

test("context added to a message goes after the words, each by kind, id and name", () => {
  assert.equal(withRefs("hola", []), "hola", "nothing added: the words alone");
  assert.equal(
    withRefs("look at this", [
      { kind: "task", id: "tk_1", label: "Launch the blog" },
      { kind: "file", id: "docs/plan.md", label: "plan.md" },
    ]),
    "look at this\n\n[context the owner added]\n- task tk_1: Launch the blog\n- file: docs/plan.md",
  );
});

test("each chat keeps its own context once, until it is sent or given back", () => {
  const task = { kind: "task" as const, id: "tk_1", label: "Launch the blog" };
  addRef("th_a", task);
  addRef("th_a", task);
  assert.equal(refsOf("th_a").length, 1, "added once");
  assert.equal(refsOf("th_b").length, 0, "another chat has none");
  const taken = takeRefs("th_a");
  assert.equal(refsOf("th_a").length, 0, "taken with the message");
  restoreRefs("th_a", taken);
  assert.deepEqual(refsOf("th_a"), [task], "a failed send gives it back");
  removeRef("th_a", task);
  assert.equal(refsOf("th_a").length, 0);
});
