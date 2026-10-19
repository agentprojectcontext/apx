import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { bundleTasks, groupByAgent, groupByTime, unreadListed } from "./groupThreads.ts";

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

test("activity keeps all runs together across dates, with pinned runs on top", () => {
  const all = { old: run("old"), new: run("new", { updated_at: "2026-10-19T08:00:00Z" }) };
  const groups = groupByTime(all, { routines: true }, new Date("2026-10-19T12:00:00Z"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.bucket, "today");
  assert.deepEqual(
    groups[0]?.threads.map((t) => t.id),
    ["new", "old"],
  );
  assert.deepEqual(groupByTime(all, { routines: false }), []);
  const pinned = groupByTime({ ...all, old: run("old", { pinned: true }) }, { routines: true });
  assert.equal(pinned[0]?.bucket, "pinned");
  assert.equal(pinned[0]?.threads[0]?.id, "old");
});

test("tree has one routine branch and mark-read still includes runs and delegated chats", () => {
  const all = { a: run("a"), b: run("b"), c: run("c", { kind: "a2a", routine_id: undefined, parent_id: "a" }) };
  const trees = groupByAgent(all, [], { routines: true });
  assert.equal(trees[0]?.agents.length, 1);
  assert.equal(trees[0]?.agents[0]?.routine, "daily");
  assert.deepEqual(new Set(unreadListed(all, { routines: true })), new Set(["a", "b", "c"]));
});
