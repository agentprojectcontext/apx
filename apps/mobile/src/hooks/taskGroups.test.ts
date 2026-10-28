import assert from "node:assert/strict";
import { test } from "node:test";
import { closedTasks, runningThreads, taskGroupOf, taskGroups } from "./taskGroups.ts";
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

test("open tasks group as an agent's proposals first, then needing the owner, then doing, pending and an agent's review; closed ones stay out", () => {
  const groups = taskGroups(
    [
      task("a", { status: "doing" }),
      task("b", { status: "backlog", due_at: "2026-10-09T10:00:00Z" }),
      task("c", { status: "todo", due_at: "2026-10-08T10:00:00Z" }),
      task("d", { status: "review", reviewer: "noor" }),
      task("h", { status: "review" }),
      task("e", { status: "doing", awaits_owner: true }),
      task("f", { state: "done", status: "doing" }),
      task("g", { state: "dropped" }),
      task("p", { status: "todo", proposed: true }),
    ],
    "all",
  );
  assert.deepEqual(
    groups.map((group) => [group.id, group.tasks.map((item) => item.id)]),
    [
      ["proposed", ["p"]],
      ["blocked", ["h", "e"]],
      ["doing", ["a"]],
      ["pending", ["c", "b"]],
      ["review", ["d"]],
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

test("closed tasks, done and dropped, list the latest first and follow the filter", () => {
  const tasks = [
    task("a", { state: "done", activity_at: "2026-10-07T09:00:00Z" }),
    task("b", { state: "dropped", activity_at: "2026-10-08T09:00:00Z" }),
    task("c", { state: "done", kind: "commitment", activity_at: "2026-10-09T09:00:00Z" }),
    task("d"),
  ];
  assert.deepEqual(
    closedTasks(tasks, "all").map((item) => item.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    closedTasks(tasks, "task").map((item) => item.id),
    ["b", "a"],
  );
});

test("the phone groups like the panel: a task worked in a running chat is in progress (DECISIONS.md#d-129)", () => {
  const worked = task("w", { status: "todo" });
  const thread = { id: "chat-w", kind: "loose", title: "w", agent_ids: ["noor"], task_id: "w", state: "working" };
  const running = runningThreads([thread as never], [worked]);
  assert.equal(taskGroupOf(worked, running), "doing");
  assert.equal(taskGroupOf(worked), "pending");
  assert.equal(taskGroupOf(task("r", { status: "review" })), "blocked", "a review no agent does is the owner's");
});
