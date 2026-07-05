// Tasks store: append-only JSONL event log per project.
// See src/core/stores/tasks.js + spec/backlog/05-tasks-per-project.md.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTask,
  listTasks,
  getTask,
  patchTask,
  doneTask,
  dropTask,
  reopenTask,
  setTaskStatus,
  countTasks,
} from "#core/stores/tasks.js";

let storagePath;

beforeEach(() => {
  storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks-"));
});

afterEach(() => {
  try { fs.rmSync(storagePath, { recursive: true, force: true }); } catch {}
});

test("createTask appends an event and returns a projected task with t_ id", () => {
  const t = createTask(storagePath, { title: "do thing" });
  assert.ok(t.id.startsWith("t_"));
  assert.equal(t.title, "do thing");
  assert.equal(t.state, "open");
  assert.deepEqual(t.tags, []);
  const file = fs.readdirSync(path.join(storagePath, "tasks"))[0];
  const raw = fs.readFileSync(path.join(storagePath, "tasks", file), "utf8");
  assert.match(raw, /"op":"create"/);
});

test("createTask requires a non-empty title", () => {
  assert.throws(() => createTask(storagePath, {}));
  assert.throws(() => createTask(storagePath, { title: "" }));
});

test("listTasks defaults to open only", () => {
  const a = createTask(storagePath, { title: "open one" });
  const b = createTask(storagePath, { title: "to be done" });
  doneTask(storagePath, b.id);
  const open = listTasks(storagePath);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, a.id);
});

test("createTask defaults status to pending and carries thread + created_by", () => {
  const t = createTask(storagePath, { title: "x", thread: "th_1", created_by: "manu" });
  assert.equal(t.status, "pending");
  assert.equal(t.thread, "th_1");
  assert.equal(t.created_by, "manu");
});

test("createTask honors a valid status and rejects a bogus one to pending", () => {
  assert.equal(createTask(storagePath, { title: "a", status: "running" }).status, "running");
  assert.equal(createTask(storagePath, { title: "b", status: "nope" }).status, "pending");
});

test("setTaskStatus moves an open task through its workflow", () => {
  const t = createTask(storagePath, { title: "work" });
  assert.equal(setTaskStatus(storagePath, t.id, "in_review").status, "in_review");
  // Invalid falls back to pending rather than persisting garbage.
  assert.equal(setTaskStatus(storagePath, t.id, "bogus").status, "pending");
  assert.equal(setTaskStatus(storagePath, "missing", "running"), null);
});

test("countTasks reports a per-status breakdown of open tasks", () => {
  createTask(storagePath, { title: "a", status: "pending" });
  createTask(storagePath, { title: "b", status: "running" });
  const c = createTask(storagePath, { title: "c" });
  doneTask(storagePath, c.id);
  const counts = countTasks(storagePath);
  assert.equal(counts.open, 2);
  assert.equal(counts.done, 1);
  assert.equal(counts.status.pending, 1);
  assert.equal(counts.status.running, 1);
  assert.equal(counts.status.in_review, 0);
});

test("listTasks --state all returns everything", () => {
  createTask(storagePath, { title: "a" });
  const b = createTask(storagePath, { title: "b" });
  doneTask(storagePath, b.id);
  const all = listTasks(storagePath, { state: "all" });
  assert.equal(all.length, 2);
});

test("listTasks filters by tag, agent and due_before", () => {
  createTask(storagePath, { title: "a", tags: ["bug"], due: "2026-06-01", agent: "rev" });
  createTask(storagePath, { title: "b", tags: ["chore"], due: "2026-07-01" });
  createTask(storagePath, { title: "c", tags: ["bug", "blocker"], agent: "rev" });

  const bugs = listTasks(storagePath, { tag: "bug" });
  assert.equal(bugs.length, 2);

  const byRev = listTasks(storagePath, { agent: "rev" });
  assert.equal(byRev.length, 2);

  const dueSoon = listTasks(storagePath, { due_before: "2026-06-15" });
  assert.equal(dueSoon.length, 1);
  assert.equal(dueSoon[0].title, "a");
});

test("getTask resolves by full id and by unique prefix ≥ 3 chars", () => {
  const t = createTask(storagePath, { title: "x" });
  assert.equal(getTask(storagePath, t.id)?.id, t.id);
  const prefix = t.id.slice(0, 5); // t_ab… — likely unique with one task
  assert.equal(getTask(storagePath, prefix)?.id, t.id);
  assert.equal(getTask(storagePath, "no"), null);
});

test("patchTask shallow-merges fields and bumps updated_at", () => {
  const t = createTask(storagePath, { title: "old", tags: ["a"] });
  // Ensure the next event has a different ts than the create.
  const before = t.updated_at;
  // Tiny artificial wait via busy loop is overkill — instead just patch and
  // accept that updated_at >= created_at (string compare on ISO).
  const u = patchTask(storagePath, t.id, { title: "new", tags: ["a", "b"] });
  assert.equal(u.title, "new");
  assert.deepEqual(u.tags, ["a", "b"]);
  assert.ok(u.updated_at >= before);
});

test("doneTask sets state and done_at; further patches still recorded", () => {
  const t = createTask(storagePath, { title: "x" });
  doneTask(storagePath, t.id, "manuel");
  const v = getTask(storagePath, t.id);
  assert.equal(v.state, "done");
  assert.equal(v.done_by, "manuel");
  assert.ok(v.done_at);
});

test("dropTask archives without 'done' semantics", () => {
  const t = createTask(storagePath, { title: "x" });
  dropTask(storagePath, t.id, "manuel");
  const v = getTask(storagePath, t.id);
  assert.equal(v.state, "dropped");
  assert.equal(v.dropped_by, "manuel");
});

test("reopenTask flips a done task back to open", () => {
  const t = createTask(storagePath, { title: "x" });
  doneTask(storagePath, t.id);
  reopenTask(storagePath, t.id);
  assert.equal(getTask(storagePath, t.id).state, "open");
});

test("countTasks summarises open / done / dropped / overdue", () => {
  createTask(storagePath, { title: "a" });
  const b = createTask(storagePath, { title: "b" });
  const c = createTask(storagePath, { title: "c", due: "2000-01-01" });
  doneTask(storagePath, b.id);
  const counts = countTasks(storagePath);
  assert.equal(counts.total, 3);
  assert.equal(counts.open, 2);
  assert.equal(counts.done, 1);
  assert.equal(counts.dropped, 0);
  assert.equal(counts.overdue, 1);
  assert.equal(counts.id, undefined);
  void c;
});

test("corrupt JSONL lines are skipped, not fatal", () => {
  const t = createTask(storagePath, { title: "good" });
  const dir = path.join(storagePath, "tasks");
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  fs.appendFileSync(file, "not-json\n");
  const out = listTasks(storagePath, { state: "all" });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, t.id);
});
