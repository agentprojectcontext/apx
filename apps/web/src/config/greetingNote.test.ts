import assert from "node:assert/strict";
import { test } from "node:test";
import type { VoiceStatus } from "@apx/protocol";
import { callEngine, greetingNoteAt } from "./greetingNote.ts";

const status = (over: Partial<VoiceStatus>): VoiceStatus =>
  ({ tier: "light", installed: true, enabled: true, calls: true, ...over }) as VoiceStatus;

test("the note shows only while the greeting is being made again, and only with calls on", () => {
  assert.equal(greetingNoteAt(status({})), undefined);
  assert.equal(greetingNoteAt(status({ greeting: "ready" })), undefined);
  assert.equal(greetingNoteAt(status({ greeting: "preparing", calls: false })), undefined);
});

test("it sits beside the voice the greeting is made with", () => {
  assert.equal(greetingNoteAt(status({ greeting: "preparing" })), "voice");
  assert.equal(greetingNoteAt(status({ greeting: "preparing", call_engine: "services" })), "calls");
  assert.equal(greetingNoteAt(status({ greeting: "preparing", enabled: false })), "calls");
  assert.equal(greetingNoteAt(status({ greeting: "preparing", tier: "none" })), "calls");
});

test("calls use the owner's services where APX's voice can't run", () => {
  assert.equal(callEngine(status({ tier: "none" })), "services");
  assert.equal(callEngine(status({})), "native");
  assert.equal(callEngine(status({ tier: "none", call_engine: "native" })), "native");
});
