import assert from "node:assert/strict";
import { test } from "node:test";
import type { Memory } from "../packages/protocol/src/index.ts";
import { deadlineDay, privateSnapshotLeaks } from "./memory-learning-checks.ts";

test("isolation scoring rejects private note IDs and source IDs even when the answer is neutral", () => {
  const notes = [
    { id: "private-note", evidence: [{ message_id: "private-source", quote: "Private preference" }] },
  ] as Memory[];
  assert.equal(privateSnapshotLeaks([{ notes: [{ id: "private-note", revision: 1 }], sources: [] }], notes), true);
  assert.equal(privateSnapshotLeaks([{ notes: [], sources: ["private-source"] }], notes), true);
  assert.equal(
    privateSnapshotLeaks([{ notes: [{ id: "other-note", revision: 1 }], sources: ["other-source"] }], notes),
    false,
  );
});

test("relative deadline expectations use the owner's local source day across UTC midnight", () => {
  assert.equal(deadlineDay("2026-01-01T09:30:00.000Z", "Pacific/Kiritimati"), "2025-12-31");
  assert.equal(deadlineDay("2026-01-01T10:30:00.000Z", "Pacific/Kiritimati"), "2026-01-01");
});
