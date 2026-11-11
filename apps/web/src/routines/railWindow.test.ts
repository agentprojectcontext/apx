import assert from "node:assert/strict";
import { test } from "node:test";
import { railWindow } from "./railWindow.ts";

test("every run shows while they fit on the rail", () => {
  assert.deepEqual(railWindow(10, 3, 200), { from: 0, to: 10 });
});

test("more runs than fit: a window around the open one, room left for the counts at the ends", () => {
  const w = railWindow(60, 30, 200);
  assert.equal(w.to - w.from, Math.floor((200 - 52) / 7));
  assert.ok(w.from <= 30 && 30 < w.to, "the open run is inside");
});

test("the window stays inside the list at both ends", () => {
  assert.equal(railWindow(60, 0, 200).from, 0);
  assert.equal(railWindow(60, 59, 200).to, 60);
});
