import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallStatus } from "@apx/protocol";
import { startingVoice } from "./callVoice.ts";

const status = (voice?: CallStatus["voice"]): CallStatus => ({
  ready: true,
  running: false,
  ...(voice ? { voice } : {}),
});

test("a call starts with the voice set in Settings, else one that fits the panel's language", () => {
  assert.deepEqual(startingVoice(status({ gender: "male", locale: "es" }), "en"), { voice: "male", locale: "es" });
  assert.deepEqual(startingVoice(status(), "es"), { voice: "female", locale: "es-AR" });
  assert.deepEqual(startingVoice(undefined, "en"), { voice: "female", locale: "en-US" });
});
