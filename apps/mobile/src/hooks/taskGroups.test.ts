import assert from "node:assert/strict";
import { test } from "node:test";
import { taskGroups } from "./taskGroups.ts";
import type { Task } from "./useWorkspace";

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: "todo",
  state: "open",
  kind: "task",
  priority: "normal",
  thread_id: `t-${id}`,
  awaits_owner: false,
  activity_at: "2026-10-07T10:00:00Z",
  ...extra,
});

test("open tasks group as doing, pending, review and blocked; closed ones stay out", () => {
  const groups = taskGroups(
    [
      task("a", { status: "doing" }),
      task("b", { status: "backlog", due_at: "2026-10-09T10:00:00Z" }),
      task("c", { status: "todo", due_at: "2026-10-08T10:00:00Z" }),
      task("d", { status: "review" }),
      task("e", { status: "doing", awaits_owner: true }),
      task("f", { state: "done", status: "doing" }),
      task("g", { state: "dropped" }),
    ],
    "all",
  );
  assert.deepEqual(
    groups.map((group) => [group.id, group.tasks.map((item) => item.id)]),
    [
      ["doing", ["a"]],
      ["pending", ["c", "b"]],
      ["review", ["d"]],
      ["blocked", ["e"]],
    ],
  );
});

test("the filter splits commitments from tasks and errands", () => {
  const all = [task("t"), task("c", { kind: "commitment" }), task("e", { kind: "errand" })];
  const ids = (filter: "task" | "commitment") =>
    taskGroups(all, filter).flatMap((group) => group.tasks.map((item) => item.id));
  assert.deepEqual(ids("commitment"), ["c"]);
  assert.deepEqual(ids("task"), ["t", "e"]);
});
