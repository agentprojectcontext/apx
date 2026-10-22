import assert from "node:assert/strict";
import { test } from "node:test";
import { createTabHolds } from "./browser.ts";

test("a tab stays held while any turn holds it, and an empty list lets it go", () => {
  const holds = createTabHolds();
  holds.set({ run: "r1", tabs: ["t1", "t2"] });
  holds.set({ run: "r2", tabs: ["t2"] });
  holds.set({ run: "r1", tabs: [] });
  assert.equal(holds.held("t1"), false);
  assert.equal(holds.held("t2"), true);
  holds.clear();
  assert.equal(holds.held("t2"), false);
  assert.throws(() => holds.set({ run: "r3", tabs: "t1" }));
});

test("a tab no turn holds any more is released once, and one another turn still holds is not", () => {
  const released: string[] = [];
  const holds = createTabHolds((tab) => released.push(tab));
  holds.set({ run: "r1", tabs: ["t1", "t2"] });
  holds.set({ run: "r2", tabs: ["t2"] });
  holds.set({ run: "r1", tabs: [] });
  assert.deepEqual(released, ["t1"]);
  holds.set({ run: "r2", tabs: [] });
  assert.deepEqual(released, ["t1", "t2"]);
  holds.set({ run: "r2", tabs: [] });
  assert.deepEqual(released, ["t1", "t2"]);
});
