import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDraftProposal } from "./prompt-proposal.ts";

test("explicit acceptance changes only the unchanged empty draft", () => {
  const current = { role: "Editor", prompt: "" };
  const expected = { ...current };
  const applied = applyDraftProposal(current, expected, "Review the catalog.");
  assert.deepEqual(applied, { role: "Editor", prompt: "Review the catalog." });
  assert.deepEqual(current, expected);
});

test("concurrent prompt or role edits and custom instructions cannot be overwritten", () => {
  const expected = { role: "Editor", prompt: "" };
  const current = { role: "Editor", prompt: "Keep this concurrent edit." };
  assert.equal(applyDraftProposal(current, expected, "Proposed instructions"), undefined);
  assert.equal(applyDraftProposal({ role: "Reviewer", prompt: "" }, expected, "Proposed instructions"), undefined);
  assert.equal(applyDraftProposal(current, { ...current }, "Proposed instructions"), undefined);
  assert.equal(applyDraftProposal(expected, expected, "  "), undefined);
  assert.deepEqual(current, { role: "Editor", prompt: "Keep this concurrent edit." });
});
