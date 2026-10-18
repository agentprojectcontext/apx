import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@apx/protocol";
import { upsertMessage } from "./state.ts";

const message = (id: string, seq: number, text = id): Message => ({
  id,
  seq,
  thread_id: "thr_1",
  author: { kind: "user" },
  parts: [{ type: "text", text }],
  created_at: "2026-01-01T00:00:00Z",
});

test("messages insert into sequence order without mutating the cached array", () => {
  const original = [message("first", 1), message("last", 3)];
  assert.deepEqual(upsertMessage(undefined, original[0] as Message), [original[0]]);
  const inserted = message("middle", 2);
  assert.deepEqual(
    upsertMessage(original, inserted).map((m) => m.id),
    ["first", "middle", "last"],
  );
  assert.deepEqual(
    original.map((m) => m.id),
    ["first", "last"],
  );
});

test("replayed messages replace existing ids once and follow their corrected sequence", () => {
  const original = [message("first", 1), message("second", 2)];
  const replacement = message("first", 3, "Corrected");
  const result = upsertMessage(original, replacement);
  assert.deepEqual(result, [original[1], replacement]);
  assert.deepEqual(original[0]?.parts, [{ type: "text", text: "first" }]);
  assert.deepEqual(upsertMessage(result, replacement), result);
});
