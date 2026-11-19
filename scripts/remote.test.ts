import assert from "node:assert/strict";
import test from "node:test";
import { sh, slotOf } from "./remote.ts";

test("a branch becomes a folder- and container-safe slot", () => {
  assert.equal(slotOf("feat/inbox-tabs"), "feat-inbox-tabs");
  assert.equal(slotOf("Fix/Ünicode Branch!"), "fix-nicode-branch");
  assert.equal(slotOf("../.."), "detached");
  assert.equal(slotOf("x".repeat(80)).length, 60);
});

test("arguments reach the remote shell as one word each", () => {
  assert.equal(sh("pnpm perf"), "'pnpm perf'");
  assert.equal(sh("it's $HOME"), `'it'\\''s $HOME'`);
});
