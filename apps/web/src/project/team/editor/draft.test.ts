import assert from "node:assert/strict";
import { test } from "node:test";
import { Autonomy } from "@apx/protocol";
import { backToProject, leaveProject } from "./draft.ts";

test("leaving the project's mode keeps that mode and saves only the changed case", () => {
  for (const mode of Autonomy.options) {
    const left = leaveProject(mode, "outside", "auto");
    // Writing the editor's table as rules made Auto ask before reading outside and Accept edits run commands unasked.
    assert.deepEqual(left, { autonomy: mode, rules: { outside: "auto" } }, mode);
  }
});

test("going back to the project's clears both the copied mode and the rules", () => {
  assert.deepEqual(backToProject, { autonomy: "", rules: {} });
});
