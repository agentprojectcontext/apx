import assert from "node:assert/strict";
import { test } from "node:test";
import { isRestartNotice, supersededRestarts } from "./restart-notice.ts";

test("a restart line repeated by a later turn is said once: the latest stands, an owner message starts over", () => {
  const cut = (id: string, code: string) => ({ id, author: { kind: "agent" }, parts: [{ type: "notice", code }] });
  const said = (id: string) => ({ id, author: { kind: "agent" }, parts: [{ type: "text" }] });
  const owner = (id: string) => ({ id, author: { kind: "user" }, parts: [{ type: "text" }] });
  assert.deepEqual([...supersededRestarts([cut("a", "run.resumed"), said("b"), cut("c", "run.interrupted")])], ["a"]);
  assert.deepEqual([...supersededRestarts([cut("a", "run.resumed"), owner("u"), cut("c", "run.interrupted")])], []);
  assert.deepEqual([...supersededRestarts([cut("a", "engine.fallback"), cut("b", "run.interrupted")])], []);
  assert.equal(isRestartNotice({ type: "notice", code: "run.resumed" }), true);
  assert.equal(isRestartNotice({ type: "text" }), false);
});
