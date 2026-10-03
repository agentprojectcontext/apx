import assert from "node:assert/strict";
import { test } from "node:test";
import { idleTabs, TAB_IDLE_MS } from "./idle.ts";

test("a tab nobody used for a while closes, unless it is on screen or in the owner's hands", () => {
  const now = 10 * TAB_IDLE_MS;
  const old = now - TAB_IDLE_MS;
  const ids = idleTabs(
    [
      { id: "t1", used: old, owner: false },
      { id: "t2", used: now - 60_000, owner: false },
      { id: "t3", used: old, owner: true },
      { id: "t4", used: old, owner: false },
    ],
    now,
    (id) => id === "t4",
  );
  assert.deepEqual(ids, ["t1"]);
});
