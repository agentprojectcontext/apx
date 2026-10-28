import assert from "node:assert/strict";
import { test } from "node:test";
import { keepSame, RELOADS } from "./keepSame.ts";

test("a reload with the same values keeps the workspace object, and a change keeps the untouched parts", () => {
  const before = { threads: [{ id: "a", unread: 0 }], agents: [{ id: "x" }] };
  assert.equal(keepSame(before, { threads: [{ id: "a", unread: 0 }], agents: [{ id: "x" }] }), before);
  const after = keepSame(before, { threads: [{ id: "a", unread: 2 }], agents: [{ id: "x" }] });
  assert.notEqual(after, before);
  assert.equal(after.agents, before.agents);
  assert.deepEqual(after.threads, [{ id: "a", unread: 2 }]);
});

test("streamed tokens never reload the lists", () => {
  assert.equal(RELOADS.has("message.part"), false);
  assert.equal(RELOADS.has("thread.updated"), true);
});
