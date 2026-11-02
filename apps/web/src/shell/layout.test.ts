import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, LAYOUT } from "./layout.ts";

test("a dragged side panel keeps its width within the chat's minimum", () => {
  const l = computeLayout(1800, true, true, "medium", { panelW: 700 });
  assert.equal(l.panelW, 700);
  assert.ok(l.listW > 0, "room left for the list");
  const max = computeLayout(1600, true, true, "medium", { panelW: 5000 });
  assert.equal(max.panelW, max.panelMaxW);
  assert.equal(1600 - max.sidebarW - LAYOUT.mainInset - max.panelW, LAYOUT.chatMinW);
  assert.equal(computeLayout(1600, true, true, "medium", { panelW: 10 }).panelW, LAYOUT.panelMinW);
});

test("a panel dragged into the list's room folds the list away", () => {
  const l = computeLayout(1600, true, true, "medium", { panelW: 900 });
  assert.equal(l.listW, 0);
});

test("no dragged width keeps the usual panel", () => {
  assert.equal(computeLayout(1600, true, true).panelW, LAYOUT.panelW);
});

test("the sidebar folds when the owner folds it, and a narrow window unfolds it only when asked", () => {
  assert.equal(computeLayout(1440, false, true).rail, false);
  assert.equal(computeLayout(1440, false, true, "medium", { sidebarCollapsed: true }).rail, true);
  assert.equal(computeLayout(1280, false, true).rail, true);
  const open = computeLayout(1280, false, true, "medium", { sidebarOpen: true, sidebarW: 300 });
  assert.equal(open.rail, false);
  assert.equal(open.sidebarW, 300);
  assert.equal(computeLayout(390, false, true, "medium", { sidebarOpen: true }).rail, true);
});

test("on a phone the one column fills what the sidebar and the pane's frame leave", () => {
  const l = computeLayout(390, true, true);
  assert.equal(l.listW, 390 - LAYOUT.sidebarRailW - LAYOUT.mainInset);
  assert.equal(l.panelW, l.listW);
});
