import assert from "node:assert/strict";
import { test } from "node:test";
import { Message } from "./domain.ts";

test("a part type this client does not know becomes a notice instead of breaking the message", () => {
  const m = Message.parse({
    id: "m1",
    thread_id: "t1",
    seq: 1,
    author: { kind: "agent", id: "superagent" },
    parts: [
      { type: "text", text: "hi" },
      { type: "hologram", frames: 3 },
    ],
    created_at: "2026-10-01T00:00:00Z",
  });
  assert.deepEqual(m.parts[0], { type: "text", text: "hi" });
  assert.equal(m.parts[1]?.type, "notice");
  assert.match(m.parts[1]?.type === "notice" ? m.parts[1].text : "", /hologram/);
});
