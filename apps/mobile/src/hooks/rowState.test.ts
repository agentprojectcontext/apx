import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxTree } from "./inboxTree.ts";
import { byAttention } from "./rowState.ts";
import type { Task, Thread } from "./useWorkspace";

const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: id,
  kind: "task",
  preview: "worked on",
  state: "completed",
  agent_ids: ["agent_a"],
  unread: 0,
  task_id: id,
  updated_at: "2026-11-20T10:00:00Z",
  ...patch,
});
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: "todo",
  state: "open",
  kind: "task",
  priority: "normal",
  thread_id: `t-${id}`,
  awaits_owner: false,
  activity_at: "2026-11-20T10:00:00Z",
  ...patch,
});

test("task rows put what waits on the owner first and done tasks last, the latest first inside each state", () => {
  const threads = [
    thread("done_new", { updated_at: "2026-11-22T10:00:00Z" }),
    thread("dropped", { updated_at: "2026-11-21T12:00:00Z" }),
    thread("running", { state: "working", updated_at: "2026-11-19T10:00:00Z" }),
    thread("pending", { updated_at: "2026-11-21T11:00:00Z" }),
    thread("waiting_old", { state: "input-required", updated_at: "2026-11-18T10:00:00Z" }),
    thread("waiting_new", { updated_at: "2026-11-21T10:00:00Z" }),
    thread("done_old", { updated_at: "2026-11-10T10:00:00Z" }),
    thread("failed", { state: "failed", updated_at: "2026-11-17T10:00:00Z" }),
  ];
  const tasks = [
    task("done_new", { state: "done" }),
    task("done_old", { state: "done" }),
    task("dropped", { state: "dropped" }),
    task("running"),
    task("pending"),
    task("waiting_old"),
    task("waiting_new", { awaits_owner: true }),
    task("failed"),
  ];
  const rows = byAttention(inboxTree(threads, { routines: true }, tasks), tasks);
  assert.deepEqual(
    rows.map((row) => row.ref),
    ["waiting_new", "waiting_old", "failed", "running", "pending", "dropped", "done_new", "done_old"],
  );
});
