import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

type Rect = { left: number; top: number; right: number; bottom: number };
type Placed = { left: number; top: number; side: string; maxHeight?: number };
type Place = (
  anchor: Rect,
  size: { width: number; height: number },
  view: { width: number; height: number },
  opts?: { side?: string; align?: string; gap?: number; pad?: number },
) => Placed;

/** The overlays script run without a DOM, after a stand-in main kit: only its pure helpers load. */
function loadPlace(): Place {
  const window = { APX: { kit: "1.3.0" } as { kit: string; place?: Place } };
  vm.runInNewContext(fs.readFileSync(new URL("./kit/apx-kit-overlays.js", import.meta.url), "utf8"), { window });
  if (!window.APX.place) throw new Error("APX.place missing");
  return window.APX.place;
}

const place = loadPlace();
const view = { width: 400, height: 300 };
const at = (left: number, top: number, w = 80, h = 30): Rect => ({ left, top, right: left + w, bottom: top + h });

test("a panel opens below its anchor, aligned to its start, end or center", () => {
  const a = at(100, 50);
  const p = place(a, { width: 120, height: 60 }, view);
  assert.deepEqual([p.side, p.left, p.top, p.maxHeight], ["bottom", 100, 86, undefined]);
  assert.equal(place(a, { width: 120, height: 60 }, view, { align: "end" }).left, 60);
  assert.equal(place(a, { width: 120, height: 60 }, view, { align: "center" }).left, 80);
});

test("a panel flips to the side with room and shifts to stay inside the view", () => {
  const low = at(320, 250);
  const p = place(low, { width: 160, height: 100 }, view);
  assert.equal(p.side, "top");
  assert.equal(p.top, 250 - 6 - 100);
  assert.equal(p.left, 400 - 160 - 8);
  assert.equal(place(at(10, 120), { width: 90, height: 24 }, view, { side: "left" }).side, "right");
  assert.equal(place(at(10, 4), { width: 90, height: 24 }, view, { side: "top", align: "center" }).side, "bottom");
});

test("a panel taller than either side goes where there is more room and is capped there", () => {
  const p = place(at(100, 100), { width: 120, height: 400 }, view);
  assert.equal(p.side, "bottom");
  assert.equal(p.maxHeight, 300 - 130 - 6 - 8);
  assert.equal(p.top, 136);
});

test("a panel wider than the view starts at the padding, and a point anchor works like a rect", () => {
  assert.equal(place(at(100, 50), { width: 500, height: 40 }, view).left, 8);
  const point = { left: 390, right: 390, top: 290, bottom: 290 };
  const p = place(point, { width: 100, height: 80 }, view, { gap: 2 });
  assert.deepEqual([p.side, p.left, p.top], ["top", 292, 208]);
});
