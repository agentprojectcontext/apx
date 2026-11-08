import assert from "node:assert/strict";
import { test } from "node:test";
import { viaOf } from "./via.ts";

const channels = [{ id: "tg_1", type: "telegram", label: "Telegram" }];

test("a message from another app says which one and which way; in that app's own chat it says nothing", () => {
  assert.deepEqual(viaOf({ via: "tg_1", author: { kind: "user" } }, undefined, channels), {
    kind: "telegram",
    label: "Telegram",
    out: false,
  });
  assert.deepEqual(viaOf({ via: "tg_1", author: { kind: "agent", id: "a" } }, undefined, channels)?.out, true);
  assert.equal(viaOf({ via: "tg_1", author: { kind: "user" } }, "tg_1", channels), undefined);
  assert.equal(viaOf({ author: { kind: "user" } }, undefined, channels), undefined);
});

test("words written in APX's panel in Chrome are marked Chrome, though it is no channel", () => {
  assert.deepEqual(viaOf({ via: "chrome", author: { kind: "user" } }, undefined, channels), {
    kind: "chrome",
    label: "Chrome",
    out: false,
  });
});
