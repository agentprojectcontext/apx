import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveInput } from "@apx/protocol";
import { inputQueue, modifiersOf, pageAt, sendsAsKey } from "./liveInput.ts";

test("a point on the picture is the same point on the page, whatever the panel's size", () => {
  const page = { width: 1280, height: 800 };
  // A narrow phone panel: the picture fills the width and starts at the top.
  const phone = { left: 0, top: 100, width: 320, height: 600 };
  assert.deepEqual(pageAt(phone, page, { x: 160, y: 200 }), { x: 0.5, y: 0.5 });
  assert.equal(pageAt(phone, page, { x: 160, y: 400 }), undefined, "below the picture");
  // A wide panel: the picture is centred across.
  const wide = { left: 0, top: 0, width: 2000, height: 800 };
  assert.deepEqual(pageAt(wide, page, { x: 360 + 640, y: 400 }), { x: 0.5, y: 0.5 });
  assert.equal(pageAt(wide, page, { x: 100, y: 400 }), undefined, "beside the picture");
});

test("editing keys and shortcuts go as keys; plain characters and paste arrive as text", () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    sendsAsKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  assert.equal(k("Enter"), true);
  assert.equal(k("Backspace"), true);
  assert.equal(k("a"), false);
  assert.equal(k("ñ"), false);
  assert.equal(k("a", { metaKey: true }), true);
  assert.equal(k("v", { ctrlKey: true }), false, "paste brings the owner's clipboard as text");
  assert.equal(modifiersOf({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true }), 10);
});

test("the owner's events keep their order; moves and wheel turns fold while a call is out", async () => {
  const calls: LiveInput[][] = [];
  let release: () => void = () => {};
  const queue = inputQueue((events) => {
    calls.push(events);
    return new Promise<void>((r) => {
      release = r;
    });
  });
  const move = (x: number): LiveInput => ({
    type: "mouse",
    action: "move",
    x,
    y: 0.5,
    button: "none",
    clicks: 0,
    modifiers: 0,
  });
  queue.push(move(0.1));
  queue.push(move(0.2));
  queue.push(move(0.3));
  queue.push({ type: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 100, modifiers: 0 });
  queue.push({ type: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 50, modifiers: 0 });
  queue.push({ type: "text", text: "ada" });
  assert.deepEqual(calls, [[move(0.1)]]);
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls[1], [
    move(0.3),
    { type: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 150, modifiers: 0 },
    { type: "text", text: "ada" },
  ]);
});
