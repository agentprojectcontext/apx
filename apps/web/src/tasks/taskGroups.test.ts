import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "@apx/protocol";
import { groupOf, groupTasks, moveTo } from "./taskGroups.ts";

const task = (over: Partial<Task>): Task => ({
  id: "t1",
  title: "x",
  description: "",
  status: "todo",
  state: "open",
  kind: "task",
  priority: "normal",
  tags: [],
  thread_id: "th1",
  awaits_owner: false,
  renegotiated: 0,
  chats: 0,
  created_by: "owner",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  activity_at: "2026-10-01T10:00:00Z",
  ...over,
});

test("blocked wins over the column; a running turn makes a task in progress; other columns are pending", () => {
  const none = new Set<string>();
  assert.equal(groupOf(task({ status: "doing", awaits_owner: true }), none), "blocked");
  assert.equal(groupOf(task({ status: "backlog" }), new Set(["th1"])), "doing");
  assert.equal(groupOf(task({ status: "review" }), none), "review");
  assert.equal(groupOf(task({ status: "ideas" }), none), "pending", "an owner's own column");
  assert.equal(groupOf(task({ state: "done", awaits_owner: true }), none), "closed");
});

test("groups come in a fixed order, without the empty ones, newest activity first", () => {
  const g = groupTasks(
    [
      task({ id: "a", status: "review" }),
      task({ id: "b", status: "doing", activity_at: "2026-10-01T09:00:00Z" }),
      task({ id: "c", status: "doing", activity_at: "2026-10-01T11:00:00Z" }),
    ],
    new Set(),
  );
  assert.deepEqual(
    g.map((x) => [x.id, x.items.map((i) => i.id)]),
    [
      ["doing", ["c", "b"]],
      ["review", ["a"]],
    ],
  );
});

test("dropping on a group: its column, waiting for the owner, or done", () => {
  const cols = [{ id: "backlog" }, { id: "todo" }, { id: "doing" }, { id: "review" }];
  assert.deepEqual(moveTo("doing", cols), { status: "doing", awaits_owner: false });
  assert.deepEqual(moveTo("pending", cols), { status: "todo", awaits_owner: false });
  assert.deepEqual(moveTo("review", cols), { status: "review", awaits_owner: false });
  assert.deepEqual(moveTo("blocked", cols), { awaits_owner: true });
  assert.deepEqual(moveTo("closed", cols), { done: true });
  assert.deepEqual(moveTo("pending", [{ id: "inbox" }, { id: "doing" }]), { status: "inbox", awaits_owner: false });
});
