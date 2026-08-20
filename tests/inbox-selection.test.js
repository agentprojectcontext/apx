// The inbox follows the row it has selected as the list refreshes underneath.
//
// Imports the web's TypeScript directly (Node strips types natively) — same
// approach as cron-human.test.js, for logic with no DOM in it.
//
// Why this is tested rather than eyeballed: the case that broke is invisible
// for most of a day. The super-agent's history is a ledger file per channel per
// DAY, so it is only when the SAME day holds two channels' threads that
// comparing ids alone goes wrong — and then the inbox shows a preview whose
// message the pane beside it does not contain.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { threadMoved } = await import(
  path.join(ROOT, "src/interfaces/web/src/lib/inbox-selection.ts")
);

test("a row pointing at the same thread has not moved", () => {
  const row = { channel: "telegram", conversation_id: "2026-01-15" };
  assert.equal(threadMoved(row, { ...row }), false);
});

test("the same day on a different channel IS a move", () => {
  // The regression: both threads are "2026-01-15" and only the channel differs.
  assert.equal(
    threadMoved(
      { channel: "web", conversation_id: "2026-01-15" },
      { channel: "telegram", conversation_id: "2026-01-15" },
    ),
    true,
  );
});

test("a new day on the same channel is a move", () => {
  assert.equal(
    threadMoved(
      { channel: "telegram", conversation_id: "2026-01-15" },
      { channel: "telegram", conversation_id: "2026-01-16" },
    ),
    true,
  );
});

test("null and undefined are the same absence, not a move", () => {
  // A project agent row carries no channel. If this read as a move the pane
  // would remount on every refresh of the list.
  assert.equal(threadMoved({ conversation_id: "abc" }, { channel: null, conversation_id: "abc" }), false);
  assert.equal(threadMoved({ channel: null }, {}), false);
});

test("gaining or losing a thread is a move", () => {
  assert.equal(threadMoved({ channel: "web", conversation_id: null }, { channel: "web", conversation_id: "2026-01-15" }), true);
  assert.equal(threadMoved({ channel: "web", conversation_id: "2026-01-15" }, { channel: "web", conversation_id: null }), true);
});
