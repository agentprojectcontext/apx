// The task EDIT surface: get_task and update_task.
//
// Until 2026-09-11 the agent could create, list, close and comment on a task and
// nothing else. Reading what one SAYS was impossible (list rows carry no
// description and no comments) and changing one was impossible at any price — so
// the super-agent was caught editing the JSONL event log with an inline python
// script, writing past every normalizer in the store.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-taskedit-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const getTaskTool = (await import("#core/agent/tools/handlers/get-task.js")).default;
const updateTaskTool = (await import("#core/agent/tools/handlers/update-task.js")).default;
const completeTaskTool = (await import("#core/agent/tools/handlers/complete-task.js")).default;
const updateCommitmentTool = (await import("#core/agent/tools/handlers/update-commitment.js")).default;
const { createTask, getTask, addComment } = await import("#core/stores/tasks.js");
const { createCommitment } = await import("#core/stores/commitments.js");

let A, B, projects, get, update, complete, updateCommitment;

beforeEach(() => {
  A = fs.mkdtempSync(path.join(TMP_HOME, "alpha-"));
  B = fs.mkdtempSync(path.join(TMP_HOME, "beta-"));
  const registry = [
    { id: 0, name: "alpha", path: "/tmp/alpha", storagePath: A },
    { id: 2, name: "beta", path: "/tmp/beta", storagePath: B },
  ];
  projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
  const ctx = { projects, requirePermission: async () => {} };
  get = getTaskTool.makeHandler(ctx);
  update = updateTaskTool.makeHandler(ctx);
  complete = completeTaskTool.makeHandler(ctx);
  updateCommitment = updateCommitmentTool.makeHandler(ctx);
});

// ── get_task ────────────────────────────────────────────────────────────────

test("get_task returns what list rows drop: description, body, comments", async () => {
  const t = createTask(A, {
    title: "Close the auth bug",
    description: "The 401 on refresh — reproduce it first",
    body: "Run the suite and open a PR",
  });
  addComment(A, t.id, { by: "qa", text: "reproduced on staging" });

  const r = await get({ project: "alpha", task: t.id });
  assert.equal(r.task.description, "The 401 on refresh — reproduce it first");
  assert.equal(r.task.body, "Run the suite and open a PR");
  assert.equal(r.task.comments.length, 1);
  assert.equal(r.task.comments[0].text, "reproduced on staging");
});

test("get_task finds the task without being told the project, and says which one", async () => {
  // list_tasks answers across every project; a model that then asks for the
  // detail without carrying the label back used to get "not found" from the
  // default project, which is indistinguishable from a wrong id.
  const t = createTask(B, { title: "beta thing" });
  const r = await get({ task: t.id });
  assert.equal(r.task.id, t.id);
  assert.equal(r.project.name, "beta");
});

test("get_task lists the subtasks of a parent", async () => {
  const epic = createTask(A, { title: "epic" });
  createTask(A, { title: "part one", parent: epic.id });
  createTask(A, { title: "part two", parent: epic.id });

  const r = await get({ project: "alpha", task: epic.id });
  assert.equal(r.task.subtasks.length, 2);
  assert.deepEqual(new Set(r.task.subtasks.map((s) => s.title)), new Set(["part one", "part two"]));
});

test("get_task names both projects when an id is ambiguous instead of picking one", async () => {
  // Prefix collisions across projects are rare but silent, and guessing writes
  // the answer into the wrong project's history.
  const a = createTask(A, { title: "one" });
  const b = createTask(B, { title: "two" });
  const shared = a.id.slice(0, 3);
  if (!b.id.startsWith(shared)) return; // ids are random; only assert when they collide
  const r = await get({ task: shared });
  assert.match(r.error, /alpha/);
  assert.match(r.error, /beta/);
});

// ── update_task ─────────────────────────────────────────────────────────────

test("update_task changes only the fields it is given", async () => {
  const t = createTask(A, { title: "Llamar al contador", description: "por el monotributo", tags: ["fiscal"] });

  const r = await update({ project: "alpha", task: t.id, due: "2026-09-20", agent: "ana", priority: "urgent" });
  assert.equal(r.ok, true);
  assert.deepEqual(new Set(r.changed), new Set(["due", "agent", "priority"]));

  const after = getTask(A, t.id);
  assert.equal(after.due, "2026-09-20");
  assert.equal(after.agent, "ana");
  assert.equal(after.priority, "urgent");
  assert.equal(after.title, "Llamar al contador");
  assert.equal(after.description, "por el monotributo");
  assert.deepEqual(after.tags, ["fiscal"]);
});

test("update_task clears a field with an empty string", async () => {
  const t = createTask(A, { title: "x", due: "2026-09-20", agent: "ana" });
  await update({ project: "alpha", task: t.id, due: "", agent: "" });
  const after = getTask(A, t.id);
  assert.equal(after.due, null);
  assert.equal(after.agent, null);
});

test("update_task normalizes the assignee the same way create_task does", async () => {
  const t = createTask(A, { title: "x" });
  await update({ project: "alpha", task: t.id, agent: "human" });
  assert.equal(getTask(A, t.id).agent, "owner");
});

test("update_task replaces the whole tag list", async () => {
  const t = createTask(A, { title: "x", tags: ["a", "b"] });
  await update({ project: "alpha", task: t.id, tags: ["c"] });
  assert.deepEqual(getTask(A, t.id).tags, ["c"]);
});

test("update_task refuses to set status and points at complete_task", async () => {
  // A raw patch would write a column id nothing validated, and the fold would
  // read it back as "pending" — a move the model would report as done.
  const t = createTask(A, { title: "x" });
  const r = await update({ project: "alpha", task: t.id, status: "blocked" });
  assert.match(r.error, /complete_task/);
  assert.equal(getTask(A, t.id).status, "pending");
});

test("update_task refuses an empty title", async () => {
  const t = createTask(A, { title: "x" });
  const r = await update({ project: "alpha", task: t.id, title: "   " });
  assert.match(r.error, /title cannot be empty/);
  assert.equal(getTask(A, t.id).title, "x");
});

test("update_task with nothing to change says what it accepts", async () => {
  const t = createTask(A, { title: "x" });
  const r = await update({ project: "alpha", task: t.id });
  assert.match(r.error, /nothing to update/);
  assert.match(r.error, /description/);
});

test("update_task reparents a task, and refuses a loop", async () => {
  const parent = createTask(A, { title: "epic" });
  const child = createTask(A, { title: "part", parent: parent.id });

  // Detach, then reattach.
  await update({ project: "alpha", task: child.id, parent: "" });
  assert.equal(getTask(A, child.id).parent, null);
  await update({ project: "alpha", task: child.id, parent: parent.id });
  assert.equal(getTask(A, child.id).parent, parent.id);

  // A cycle would make the epic its own descendant and childIndex would count
  // forever.
  const loop = await update({ project: "alpha", task: parent.id, parent: child.id });
  assert.match(loop.error, /loop/);
  assert.equal(getTask(A, parent.id).parent, null);

  const self = await update({ project: "alpha", task: parent.id, parent: parent.id });
  assert.match(self.error, /its own parent/);
});

test("update_task says a place on a non-locatable task will not be acted on", async () => {
  const t = createTask(A, { title: "comprar pan" });
  const r = await update({ project: "alpha", task: t.id, location: { place: "Panadería" } });
  assert.equal(r.ok, true);
  assert.match(r.note, /trip/);

  const withCategory = await update({ project: "alpha", task: t.id, category: "trip" });
  assert.equal(withCategory.ok, true);
  assert.equal(getTask(A, t.id).category, "trip");
  assert.equal(getTask(A, t.id).location.place, "Panadería");
});

test("update_task finds the task across projects when no project is given", async () => {
  const t = createTask(B, { title: "beta thing" });
  const r = await update({ task: t.id, priority: "high" });
  assert.equal(r.project.name, "beta");
  assert.equal(getTask(B, t.id).priority, "high");
});

// ── complete_task, status ───────────────────────────────────────────────────

test("complete_task rejects an unknown column instead of silently filing it under pending", async () => {
  // setTaskStatus normalizes an unknown status to the default, so this used to
  // answer ok and move the card nowhere.
  const t = createTask(A, { title: "x" });
  const r = await complete({ project: "alpha", task: t.id, action: "status", status: "qa" });
  assert.match(r.error, /unknown status/);
  assert.match(r.error, /pending/);
  assert.equal(getTask(A, t.id).status, "pending");

  const ok = await complete({ project: "alpha", task: t.id, action: "status", status: "blocked" });
  assert.equal(ok.ok, true);
  assert.equal(getTask(A, t.id).status, "blocked");
});

test("complete_task says done is not a column", async () => {
  const t = createTask(A, { title: "x" });
  const r = await complete({ project: "alpha", task: t.id, action: "status", status: "done" });
  assert.match(r.error, /action="done"/);
  assert.equal(getTask(A, t.id).state, "open");
});

// ── update_commitment ───────────────────────────────────────────────────────

test("update_commitment corrects what was written down", async () => {
  const c = createCommitment(A, { counterparty: "Ana", body: "mandar el presupuesto" });
  const r = await updateCommitment({ project: "alpha", commitment: c.id, counterparty: "Ana Gómez" });
  assert.equal(r.ok, true);
  assert.equal(r.commitment.counterparty, "Ana Gómez");
  assert.equal(r.commitment.body, "mandar el presupuesto");
});

test("update_commitment refuses to empty the promise or the person waiting", async () => {
  const c = createCommitment(A, { counterparty: "Ana", body: "mandar el presupuesto" });
  assert.match((await updateCommitment({ project: "alpha", commitment: c.id, body: "" })).error, /body cannot be empty/);
  assert.match((await updateCommitment({ project: "alpha", commitment: c.id, counterparty: " " })).error, /counterparty cannot be empty/);
});

test("update_commitment flags a date change as a correction, not a renegotiation", async () => {
  // The distinction is the point: renegotiate keeps the old date in the
  // history, because moving a deadline twice is a fact about the relationship.
  const c = createCommitment(A, { counterparty: "Ana", body: "x", due: "2026-09-12" });
  const r = await updateCommitment({ project: "alpha", commitment: c.id, due: "2026-09-19" });
  assert.match(r.note, /correction/);
  assert.equal(r.commitment.due, "2026-09-19");
});

test("update_task rejects a priority the store would have silently defaulted", async () => {
  // patchTask normalizes an unknown priority to "normal", so this used to
  // answer ok and set the opposite of what was asked.
  const t = createTask(A, { title: "x", priority: "high" });
  const r = await update({ project: "alpha", task: t.id, priority: "muy urgente" });
  assert.match(r.error, /unknown priority/);
  assert.equal(getTask(A, t.id).priority, "high");
});
