import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceLevel } from "./voiceMeter.ts";

test("a silent mic stays flat, and louder samples make a stronger bounded signal", () => {
  assert.equal(voiceLevel(new Uint8Array()), 0);
  assert.equal(voiceLevel(new Uint8Array(256).fill(128)), 0);
  const quiet = voiceLevel(new Uint8Array([124, 132, 124, 132]));
  const loud = voiceLevel(new Uint8Array([96, 160, 96, 160]));
  assert.ok(quiet > 0 && quiet < loud);
  assert.equal(voiceLevel(new Uint8Array([0, 255])), 1);
});
