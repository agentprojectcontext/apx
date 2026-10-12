import assert from "node:assert/strict";
import { test } from "node:test";
import v8 from "node:v8";
import { createIdleTrim, type YoungGen } from "./idle-memory.ts";

const MB = 1024 * 1024;

function fakeHeap(start: YoungGen) {
  let heap = start;
  let collected = 0;
  const trim = createIdleTrim({
    youngGen: () => heap,
    collect: () => {
      collected++;
      heap = { size: 1 * MB, used: 0 };
    },
  });
  return {
    trim,
    set: (h: YoungGen) => {
      heap = h;
    },
    collected: () => collected,
  };
}

test("a quiet core with a grown young generation gives it back, once", () => {
  const h = fakeHeap({ size: 32 * MB, used: 3 * MB });
  h.trim.start();
  h.trim.stop();
  h.set({ size: 32 * MB, used: 3.1 * MB });
  assert.equal(h.trim.check(), true);
  assert.equal(h.collected(), 1);
  // Shrunk and still quiet: nothing left to give back.
  h.set({ size: 1 * MB, used: 0.05 * MB });
  assert.equal(h.trim.check(), false);
  assert.equal(h.trim.trims(), 1);
});

test("a busy core is left alone", () => {
  const h = fakeHeap({ size: 32 * MB, used: 3 * MB });
  h.trim.start();
  h.trim.stop();
  // Allocating fast.
  h.set({ size: 32 * MB, used: 9 * MB });
  assert.equal(h.trim.check(), false);
  // A collection ran in between (use went down): it was allocating.
  h.set({ size: 32 * MB, used: 2 * MB });
  assert.equal(h.trim.check(), false);
  assert.equal(h.collected(), 0);
  // Quiet from then on.
  h.set({ size: 32 * MB, used: 2.2 * MB });
  assert.equal(h.trim.check(), true);
});

test("a small young generation is never collected for", () => {
  const h = fakeHeap({ size: 2 * MB, used: 0.5 * MB });
  h.trim.start();
  h.trim.stop();
  h.set({ size: 2 * MB, used: 0.6 * MB });
  assert.equal(h.trim.check(), false);
  assert.equal(h.collected(), 0);
});

test("the real collector shrinks V8's young generation", () => {
  const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space")?.space_size ?? 0;
  // Objects that survive a few scavenges make V8 grow its young generation, as loading the core does.
  let keep: number[][] = [];
  for (let i = 0; i < 200_000; i++) keep.push([i, i + 1, i + 2]);
  const grown = young();
  keep = [];
  const trim = createIdleTrim({ minSize: 0, quietBytes: Number.POSITIVE_INFINITY });
  trim.start();
  trim.stop();
  assert.equal(trim.check(), true);
  assert.ok(young() < grown, `young generation ${young()} not below ${grown}`);
  assert.equal(keep.length, 0);
  // `gc` stays out of reach of code that runs later.
  assert.equal(typeof (globalThis as { gc?: unknown }).gc, "undefined");
});
