import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, LAYOUT } from "./layout.ts";

test("a dragged side panel keeps its width within the chat's minimum", () => {
  const l = computeLayout(1800, true, true, "medium", { panelW: 700 });
  assert.equal(l.panelW, 700);
  assert.ok(l.listW > 0, "room left for the list");
  const max = computeLayout(1600, true, true, "medium", { panelW: 5000 });
  assert.equal(max.panelW, max.panelMaxW);
  assert.equal(1600 - max.sidebarW - max.panelW, LAYOUT.chatMinW);
  assert.equal(computeLayout(1600, true, true, "medium", { panelW: 10 }).panelW, LAYOUT.panelMinW);
});

test("a panel dragged into the list's room folds the list away", () => {
  const l = computeLayout(1600, true, true, "medium", { panelW: 900 });
  assert.equal(l.listW, 0);
});

test("no dragged width keeps the usual panel", () => {
  assert.equal(computeLayout(1600, true, true).panelW, LAYOUT.panelW);
});
