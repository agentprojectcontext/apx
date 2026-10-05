import assert from "node:assert/strict";
import { test } from "node:test";
import { quickPlacement } from "./quick-placement.ts";

const size = { width: 400, height: 600 };

test("quick chat stays on each of three displays, including negative coordinates", () => {
  for (const x of [-1920, 0, 1920]) {
    const area = { x, y: 25, width: 1920, height: 1055 };
    const result = quickPlacement(area, size, { x: x + 960, y: 12 });
    assert.deepEqual(result, { x: x + 760, y: 33, ...size });
  }
  assert.deepEqual(quickPlacement({ x: 0, y: -1055, width: 1920, height: 1055 }, size, { x: 960, y: -1070 }), {
    x: 760,
    y: -1047,
    ...size,
  });
});

test("bottom and side taskbars open beside the clicked edge", () => {
  const area = { x: 1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(quickPlacement(area, size, { x: 2900, y: 1060 }), { x: 2700, y: 432, ...size });
  assert.deepEqual(quickPlacement(area, size, { x: 1920, y: 750 }), { x: 1928, y: 432, ...size });
  assert.deepEqual(quickPlacement(area, size, { x: 3840, y: 300 }), { x: 3432, y: 8, ...size });
});

test("resized quick chats fit a smaller monitor and avoid all screen edges", () => {
  const area = { x: -800, y: 40, width: 800, height: 500 };
  assert.deepEqual(quickPlacement(area, { width: 1400, height: 900 }, { x: -5, y: 20 }), {
    x: -792,
    y: 48,
    width: 784,
    height: 484,
  });
  assert.deepEqual(quickPlacement({ x: 0, y: 25, width: 1920, height: 1055 }, size), {
    x: 760,
    y: 33,
    ...size,
  });
});
