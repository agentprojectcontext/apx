import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, Thread } from "@apx/protocol";
import { movedSection, sectionOrder, taskSections } from "./taskSections.ts";

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: "",
  status: "backlog",
  state: "open",
  priority: "normal",
  kind: "task",
  thread_id: `home_${id}`,
  tags: [],
  awaits_owner: false,
  renegotiated: 0,
  created_by: "owner",
  chats: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  activity_at: "2026-01-01T00:00:00Z",
  ...extra,
});
const entry = (taskId: string, state: Thread["state"] = "idle") => ({
  kind: "task" as const,
  taskId,
  threads: [{ id: `thread_${taskId}`, state } as Thread],
});

test("Inbox task sections keep every state, closed last and activity order within sections", () => {
  const tasks = Object.fromEntries(
    [
      task("done", { state: "done" }),
      task("dropped", { state: "dropped" }),
      task("doing", { status: "doing" }),
      task("waiting", { awaits_owner: true, status: "doing" }),
      task("owner-review", { status: "review" }),
      task("explicit-owner-review", { status: "review", reviewer: "owner" }),
      task("waiting-proposal", { proposed: true, awaits_owner: true }),
      task("agent-review", { status: "review", reviewer: "reviewer" }),
      task("proposed", { proposed: true }),
      task("todo", { status: "todo" }),
      task("custom", { status: "custom" }),
      task("backlog"),
      task("running"),
    ].map((t) => [t.id, t]),
  );
  const entries = Object.keys(tasks).map((id) => entry(id, id === "running" ? "queued" : "idle"));
  const groups = taskSections(entries, tasks);
  assert.deepEqual(
    groups.map((g) => [g.id, g.entries.map((e) => e.taskId)]),
    [
      ["doing", ["doing", "running"]],
      ["waiting", ["waiting", "owner-review", "explicit-owner-review", "waiting-proposal"]],
      ["pending", ["agent-review", "proposed", "todo", "custom", "backlog"]],
      ["done", ["done"]],
      ["dropped", ["dropped"]],
    ],
  );
  assert.equal(
    groups.reduce((n, g) => n + g.entries.length, 0),
    entries.length,
  );
  assert.deepEqual(
    taskSections(
      entries.filter((e) => e.taskId === "todo"),
      tasks,
    ).map((g) => g.entries.length),
    [1],
    "counts reflect the filtered result, not the task store",
  );
});

test("missing metadata never hides a task and closed states beat a running session", () => {
  const closed = task("closed", { state: "done", awaits_owner: true });
  const groups = taskSections([entry("missing"), entry("live", "working"), entry("closed", "working")], { closed });
  assert.deepEqual(
    groups.map((g) => [g.id, g.entries.map((e) => e.taskId)]),
    [
      ["doing", ["live"]],
      ["pending", ["missing"]],
      ["done", ["closed"]],
    ],
  );
  assert.deepEqual(taskSections([], { closed }), []);
});

test("the owner's section order comes first, unknown ids dropped and missing ones after in their default order", () => {
  assert.deepEqual(sectionOrder([]), ["doing", "waiting", "pending", "done", "dropped"]);
  assert.deepEqual(sectionOrder(["waiting", "gone", "dropped", "waiting"]), [
    "waiting",
    "dropped",
    "doing",
    "pending",
    "done",
  ]);
  const tasks = { a: task("a", { status: "doing" }), b: task("b", { awaits_owner: true }), c: task("c") };
  const entries = ["a", "b", "c"].map((id) => entry(id));
  assert.deepEqual(
    taskSections(entries, tasks, ["waiting"]).map((g) => g.id),
    ["waiting", "doing", "pending"],
  );
});

test("a dragged section lands before the one it was dropped on, empty sections keep their place", () => {
  assert.deepEqual(movedSection([], "waiting", "doing"), ["waiting", "doing", "pending", "done", "dropped"]);
  assert.deepEqual(movedSection([], "dropped", "done"), ["doing", "waiting", "pending", "dropped", "done"]);
  // Only doing, pending and done on screen: dropped after the last one on screen.
  assert.deepEqual(movedSection([], "doing", undefined, "done"), ["waiting", "pending", "done", "doing", "dropped"]);
  assert.deepEqual(movedSection(["done"], "done", undefined), ["doing", "waiting", "pending", "dropped", "done"]);
});
