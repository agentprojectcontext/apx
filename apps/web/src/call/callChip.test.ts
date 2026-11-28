import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceChip } from "./callChip.ts";

test("a call's chat says it came by voice, and from which phone", () => {
  assert.deepEqual(voiceChip({ kind: "call", call: { mode: "quick" } }), { key: "callChip.quick" });
  assert.deepEqual(voiceChip({ kind: "call", call: { mode: "quick", device: "Pixel 8" } }), {
    key: "callChip.quickFrom",
    device: "Pixel 8",
  });
  assert.deepEqual(voiceChip({ kind: "call", call: { mode: "call", device: "Pixel 8" } }), {
    key: "callChip.fromDevice",
    device: "Pixel 8",
  });
  assert.equal(voiceChip({ kind: "call", call: { mode: "call" } }), undefined);
  assert.equal(voiceChip({ kind: "call" }), undefined);
  assert.equal(voiceChip({ kind: "home", call: { mode: "quick" } }), undefined);
});
