import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "@apx/protocol";
import { groupOf, groupTasks, moveTo, nestTasks } from "./taskGroups.ts";

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
  assert.equal(groupOf(task({ status: "review" }), none), "blocked", "a review with no agent to do it is the owner's");
  assert.equal(groupOf(task({ status: "review", reviewer: "noor" }), none), "review");
  assert.equal(groupOf(task({ status: "ideas" }), none), "pending", "an owner's own column");
  assert.equal(groupOf(task({ state: "done", awaits_owner: true }), none), "closed");
});

test("an agent's proposal sits apart from the rest until the owner accepts it", () => {
  const none = new Set<string>();
  assert.equal(groupOf(task({ proposed: true }), none), "proposed");
  assert.equal(groupOf(task({ proposed: true, awaits_owner: true }), none), "proposed");
  assert.equal(groupOf(task({ proposed: true, state: "dropped" }), none), "closed");
});

test("groups come in a fixed order, without the empty ones, newest activity first", () => {
  const g = groupTasks(
    [
      task({ id: "a", status: "review", reviewer: "noor" }),
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
  assert.deepEqual(
    moveTo("proposed", cols),
    moveTo("pending", cols),
    "proposing is an agent's: dropped there it is pending",
  );
  assert.deepEqual(moveTo("pending", [{ id: "inbox" }, { id: "doing" }]), { status: "inbox", awaits_owner: false });
});

test("subtasks nest under their parent, oldest first; an orphan or a loop of parents stays at the top", () => {
  const parent = task({ id: "p" });
  const later = task({ id: "s2", parent_id: "p", created_at: "2026-10-03T10:00:00Z" });
  const first = task({ id: "s1", parent_id: "p", created_at: "2026-10-02T10:00:00Z" });
  const deeper = task({ id: "s3", parent_id: "s1" });
  const orphan = task({ id: "o", parent_id: "gone" });
  const loopA = task({ id: "a", parent_id: "b" });
  const loopB = task({ id: "b", parent_id: "a" });
  const { top, children } = nestTasks([parent, later, first, deeper, orphan, loopA, loopB]);
  assert.deepEqual(
    top.map((t) => t.id),
    ["p", "o", "a", "b"],
  );
  assert.deepEqual(
    children.get("p")?.map((t) => t.id),
    ["s1", "s2"],
  );
  assert.deepEqual(
    children.get("s1")?.map((t) => t.id),
    ["s3"],
  );
});
