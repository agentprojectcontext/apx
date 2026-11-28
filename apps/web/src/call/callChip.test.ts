import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceChip } from "./callChip.ts";

test("a call's chat says which phone it went through", () => {
  for (const mode of ["quick", "call"] as const) {
    assert.deepEqual(voiceChip({ kind: "call", call: { mode, device: "Pixel 8" } }), {
      key: "callChip.fromDevice",
      device: "Pixel 8",
    });
    assert.equal(voiceChip({ kind: "call", call: { mode } }), undefined);
  }
  assert.equal(voiceChip({ kind: "call" }), undefined);
  assert.equal(voiceChip({ kind: "home", call: { mode: "quick", device: "Pixel 8" } }), undefined);
});
