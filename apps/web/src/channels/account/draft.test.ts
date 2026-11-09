import assert from "node:assert/strict";
import { test } from "node:test";
import { keptAfter } from "./draft.ts";

test("a save clears only what it sent: a name typed while it was on its way stays unsaved", () => {
  const sent = { label: "Personal", concurrency: "queue" as const };
  // The owner typed another name before the save came back; the other edit is the one that went out.
  const now = { ...sent, label: "WhatsApp" };
  assert.deepEqual(keptAfter(now, sent), { label: "WhatsApp" });
  assert.deepEqual(keptAfter(sent, sent), {});
});
