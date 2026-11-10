import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { bundleTasks, inboxEntries, unreadListed } from "./groupThreads.ts";

const run = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  kind: "routine",
  routine_id: "daily",
  title: "Daily brief · Monday",
  agent_ids: ["assistant"],
  state: "completed",
  preview: "News",
  unread: 1,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  ...extra,
});

test("routine runs bundle by identity, not title or agent, preserving order", () => {
  const runs = [run("new", { title: "Renamed · Today" }), run("other", { routine_id: "other" }), run("old")];
  const entries = bundleTasks(runs);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.kind, "routine");
  assert.deepEqual(entries[0] && "threads" in entries[0] && entries[0].threads.map((t) => t.id), ["new", "old"]);
  assert.equal(bundleTasks([run("legacy", { routine_id: undefined })])[0]?.kind, "thread");
});

test("a routine's runs are one row across dates, a pinned run leading it; listed only when the owner asks", () => {
  const all = { old: run("old"), new: run("new", { updated_at: "2026-10-19T08:00:00Z" }) };
  const entries = inboxEntries(all, { routines: true });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0] && "threads" in entries[0] && entries[0].threads.map((t) => t.id), ["new", "old"]);
  assert.deepEqual(inboxEntries(all, { routines: false }), []);
  const pinned = inboxEntries({ ...all, old: run("old", { pinned: true }) }, { routines: true });
  assert.equal(pinned[0] && "threads" in pinned[0] && pinned[0].threads[0]?.id, "old");
});

test("mark-read includes a routine's runs and the chats they delegated", () => {
  const all = { a: run("a"), b: run("b"), c: run("c", { kind: "a2a", routine_id: undefined, parent_id: "a" }) };
  assert.deepEqual(new Set(unreadListed(all, { routines: true })), new Set(["a", "b", "c"]));
});
