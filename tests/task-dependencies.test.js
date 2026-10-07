// Task dependencies (#59): "B waits on A" with a reason, an owner and an
// unblock condition — visible from both sides, never a silent cycle, and a
// removed wait keeps why it was lifted. A closed dependency UNBLOCKS; nothing
// here approves or moves the waiting task.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-task-deps-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  createTask, getTask, listTasks, doneTask, dropTask, reopenTask, addDependency, removeDependency,
} = await import("#core/stores/tasks.js");
const updateTask = (await import("#core/agent/tools/handlers/update-task.js")).default;
const { taskExecution } = await import("#core/tasks/execution.js");

let STORE;
beforeEach(() => { STORE = fs.mkdtempSync(path.join(TMP_HOME, "proj-")); });

test("B waits on A: both sides see it, with reason, owner and condition", () => {
  const a = createTask(STORE, { title: "corregir el plan", agent: "pm" });
  const b = createTask(STORE, { title: "auditar el plan corregido", agent: "auditor" });
  addDependency(STORE, b.id, { on: a.id, reason: "audita la versión corregida", owner: "pm", condition: "plan v2 verificado", by: "roby" });

  const B = getTask(STORE, b.id);
  assert.equal(B.depends_on.length, 1);
  assert.equal(B.depends_on[0].task_id, a.id);
  assert.equal(B.depends_on[0].title, "corregir el plan");
  assert.equal(B.depends_on[0].state, "open");
  assert.equal(B.depends_on[0].satisfied, false);
  assert.equal(B.depends_on[0].condition, "plan v2 verificado");
  assert.equal(B.open_dependencies, 1);

  const A = getTask(STORE, a.id);
  assert.deepEqual(A.blocks.map((x) => x.task_id), [b.id]);
  // List rows carry the same, so a board can show it without the detail.
  assert.equal(listTasks(STORE).find((t) => t.id === b.id).open_dependencies, 1);
});

test("A done unblocks B without touching B; reopening A blocks it again", () => {
  const a = createTask(STORE, { title: "a" });
  const b = createTask(STORE, { title: "b", status: "blocked" });
  addDependency(STORE, b.id, { on: a.id });
  doneTask(STORE, a.id);
  let B = getTask(STORE, b.id);
  assert.equal(B.depends_on[0].satisfied, true);
  assert.equal(B.open_dependencies, 0);
  assert.equal(B.status, "blocked", "the waiting task is not moved or approved");
  assert.equal(B.state, "open");
  reopenTask(STORE, a.id);
  B = getTask(STORE, b.id);
  assert.equal(B.depends_on[0].satisfied, false, "a reopened delivery is not the one that unblocked it");
});

test("a dropped dependency is not satisfied — it is named so somebody decides", () => {
  const a = createTask(STORE, { title: "a" });
  const b = createTask(STORE, { title: "b" });
  addDependency(STORE, b.id, { on: a.id });
  dropTask(STORE, a.id);
  const d = getTask(STORE, b.id).depends_on[0];
  assert.equal(d.state, "dropped");
  assert.equal(d.satisfied, false);
});

test("self, missing targets and cycles are refused", () => {
  const a = createTask(STORE, { title: "a" });
  const b = createTask(STORE, { title: "b" });
  const c = createTask(STORE, { title: "c" });
  assert.throws(() => addDependency(STORE, a.id, { on: a.id }), /itself/);
  assert.throws(() => addDependency(STORE, a.id, { on: "t_nope99" }), /not found/);
  addDependency(STORE, b.id, { on: a.id });
  addDependency(STORE, c.id, { on: b.id });
  assert.throws(() => addDependency(STORE, a.id, { on: c.id }), /cycle/);
  // Adding the same wait twice is a no-op, not a duplicate.
  addDependency(STORE, b.id, { on: a.id });
  assert.equal(getTask(STORE, b.id).depends_on.length, 1);
});

test("lifting a wait needs a reason, and the reason stays on the task", () => {
  const a = createTask(STORE, { title: "a" });
  const b = createTask(STORE, { title: "b" });
  addDependency(STORE, b.id, { on: a.id, reason: "x" });
  assert.throws(() => removeDependency(STORE, b.id, { on: a.id, reason: "  " }), /reason required/);
  removeDependency(STORE, b.id, { on: a.id, reason: "A was cancelled; B audits v1", by: "owner" });
  const B = getTask(STORE, b.id);
  assert.equal(B.depends_on.length, 0);
  assert.equal(B.dependency_log[0].removed_reason, "A was cancelled; B audits v1");
  assert.equal(B.dependency_log[0].removed_by, "owner");
  assert.deepEqual(getTask(STORE, a.id).blocks, []);
});

test("update_task records dependencies when delegating, and reports a refused one", async () => {
  const a = createTask(STORE, { title: "a" });
  const b = createTask(STORE, { title: "b" });
  const projects = { list: () => [{ id: 1, name: "acme" }], get: () => ({ id: 1, storagePath: STORE, path: STORE }) };
  const h = updateTask.makeHandler({ projects, requirePermission: async () => {}, channelMeta: { agentSlug: "roby" } });

  const ok = await h({ task: b.id, project: "1", depends_on_add: [{ task: a.id, reason: "needs v2", owner: "pm" }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.changed, ["depends_on"]);
  assert.equal(getTask(STORE, b.id).depends_on[0].by, "roby");

  const cyc = await h({ task: a.id, project: "1", depends_on_add: [{ task: b.id }] });
  assert.match(cyc.error, /cycle/);

  const noReason = await h({ task: b.id, project: "1", depends_on_remove: [{ task: a.id }] });
  assert.match(noReason.error, /reason required/);
});

test("the execution view names a pending dependency as what it waits on", () => {
  const a = createTask(STORE, { title: "a" });
  const b = createTask(STORE, { title: "b" });
  addDependency(STORE, b.id, { on: a.id });
  const v = taskExecution(getTask(STORE, b.id), { storagePath: STORE, agentWorking: false, listSessions: () => [] });
  assert.equal(v.waiting_on, "dependency");
});
