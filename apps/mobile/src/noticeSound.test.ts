import assert from "node:assert/strict";
import { test } from "node:test";
import { isNoticeSound, soundsFor } from "./noticeSound.ts";

test("requests are what waits for the owner; messages are the rest; all and off are both and none", () => {
  const kinds = ["input", "task", "due", "agent", "run", "channel", "routine"];
  const which = (mode: Parameters<typeof soundsFor>[1]) => kinds.filter((k) => soundsFor(k, mode));
  assert.deepEqual(which("requests"), ["input", "task", "due"]);
  assert.deepEqual(which("messages"), ["agent", "run", "channel", "routine"]);
  assert.deepEqual(which("all"), kinds);
  assert.deepEqual(which("off"), []);
  assert.equal(soundsFor(undefined, "messages"), true);
  assert.equal(isNoticeSound("loud"), false);
});
