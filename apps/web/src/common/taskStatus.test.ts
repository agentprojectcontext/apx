import assert from "node:assert/strict";
import { test } from "node:test";
import { Task } from "@apx/protocol";
import { prefs } from "../data/prefs.ts";
import { startI18n, t } from "../i18n/index.ts";
import { taskStatus, taskStatusTone } from "./taskStatus.ts";

prefs.set({ language: "en" });
await startI18n();
const task = Task.parse({
  id: "task_example",
  title: "Example",
  description: "",
  state: "open",
  status: "doing",
  kind: "task",
  priority: "normal",
  thread_id: "thread_example",
  tags: [],
  awaits_owner: false,
  renegotiated: 0,
  created_by: "owner",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  activity_at: "2026-01-01T00:00:00Z",
});
const columns = [
  { id: "doing", label: "Doing" },
  { id: "custom", label: "Waiting for supplier" },
];

test("task tones distinguish work, review and terminal states with the same lifecycle precedence", () => {
  assert.equal(taskStatusTone(task), "info");
  assert.equal(taskStatusTone({ ...task, awaits_owner: true }), "warning");
  assert.equal(taskStatusTone({ ...task, state: "done", awaits_owner: true }), "brand");
  assert.equal(taskStatusTone({ ...task, state: "dropped", awaits_owner: true }), "danger");
  assert.equal(taskStatusTone({ ...task, proposed: true }), "violet");
  assert.equal(taskStatusTone({ ...task, status: "review" }), "violet");
  assert.equal(taskStatusTone({ ...task, status: "todo" }), "neutral");
  assert.equal(taskStatusTone({ ...task, status: "custom" }), "neutral");
});

test("task labels follow persisted lifecycle before waiting flags and columns", () => {
  assert.equal(taskStatus(task, columns, t), "Doing");
  assert.equal(taskStatus({ ...task, awaits_owner: true }, columns, t), "Needs your review");
  assert.equal(taskStatus({ ...task, state: "done", awaits_owner: true }, columns, t), "Done");
  assert.equal(taskStatus({ ...task, state: "dropped" }, columns, t), "Dropped");
  assert.equal(taskStatus({ ...task, status: "custom" }, columns, t), "Waiting for supplier");
  assert.equal(taskStatus({ ...task, status: "missing" }, columns, t), "Open");
  assert.equal(taskStatus({ ...task, title: "Blocked and done" }, columns, t), "Doing");
});
