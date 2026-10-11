import assert from "node:assert/strict";
import { test } from "node:test";
import { idleTabs, TAB_IDLE_MS } from "./idle.ts";

test("a tab nobody used for a while closes, unless it is on screen or locked", () => {
  const now = 10 * TAB_IDLE_MS;
  const old = now - TAB_IDLE_MS;
  const ids = idleTabs(
    [
      { id: "t1", used: old, locked: false },
      { id: "t2", used: now - 60_000, locked: false },
      { id: "t3", used: old, locked: true },
      { id: "t4", used: old, locked: false },
    ],
    now,
    (id) => id === "t4",
  );
  assert.deepEqual(ids, ["t1"]);
});
