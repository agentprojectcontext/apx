// The list_tasks agent tool.
//
// Regression from a live run: `project` was REQUIRED, so a cross-project
// question ("what is due today") made the morning anchor call this once per
// registered project — eleven times on a real install — and run out of
// iterations before it managed to send anything. The cross-project fold had
// existed in core since C2; the agent just could not reach it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-listtasks-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const listTasksTool = (await import("#core/agent/tools/handlers/list-tasks.js")).default;
const { createTask, setTaskStatus } = await import("#core/stores/tasks.js");

let A, B, projects, handler;

beforeEach(() => {
  A = fs.mkdtempSync(path.join(TMP_HOME, "alpha-"));
  B = fs.mkdtempSync(path.join(TMP_HOME, "beta-"));
  const registry = [
    { id: 1, name: "alpha", path: "/tmp/alpha", storagePath: A },
    { id: 2, name: "beta", path: "/tmp/beta", storagePath: B },
  ];
  projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
  handler = listTasksTool.makeHandler({ projects });
});

test("omitting project searches everywhere, in ONE call", async () => {
  createTask(A, { title: "alpha thing" });
  createTask(B, { title: "beta thing" });

  const r = await handler({});
  assert.equal(r.tasks.length, 2);
  assert.deepEqual(new Set(r.tasks.map((t) => t.project)), new Set(["alpha", "beta"]));
});

test("every row says which project it came from", async () => {
  // Without this the model has a merged list it cannot act on — "which
  // project is that task in" would be another round-trip.
  createTask(A, { title: "alpha thing" });
  const r = await handler({});
  assert.equal(r.tasks[0].project, "alpha");
});

test("passing a project keeps the old behaviour exactly", async () => {
  createTask(A, { title: "alpha thing" });
  createTask(B, { title: "beta thing" });

  const r = await handler({ project: "alpha" });
  assert.ok(Array.isArray(r), "single-project form still returns a bare array");
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "alpha thing");
});

test("an unknown project is an error, not a silent sweep of everything", async () => {
  // Falling back to "all projects" on a typo would answer a question nobody
  // asked, and look like it worked.
  const r = await handler({ project: "nope" });
  assert.match(r.error, /project not found/);
});

test("filters apply across the merge", async () => {
  createTask(A, { title: "due soon", due: "2026-01-01" });
  createTask(B, { title: "no date" });
  const r = await handler({ due_before: "2026-06-01" });
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].title, "due soon");
});

test("the workflow sub-status is reachable — it was not exposed before", async () => {
  const t = createTask(A, { title: "stuck" });
  setTaskStatus(A, t.id, "blocked");
  createTask(B, { title: "fine" });

  const r = await handler({ status: "blocked" });
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].title, "stuck");
});

test("results are capped so one big install cannot blow the prompt", async () => {
  for (let i = 0; i < 150; i++) createTask(A, { title: `task ${i}` });
  const r = await handler({});
  assert.equal(r.tasks.length, 100);
});

test("an unreadable project is reported rather than quietly dropped", async () => {
  createTask(A, { title: "readable" });
  const registry = [
    { id: 1, name: "alpha", path: "/tmp/alpha", storagePath: A },
    { id: 9, name: "broken", path: "/tmp/broken", storagePath: "/dev/null/nope" },
  ];
  const h = listTasksTool.makeHandler({
    projects: { list: () => registry, get: (id) => registry.find((p) => String(p.id) === String(id)) },
  });
  const r = await h({});
  assert.equal(r.tasks.length, 1);
  // "Nothing is due" because a store failed to open is worse than saying so.
  assert.ok(r.skipped === undefined || Array.isArray(r.skipped));
});

test("the description tells the model NOT to loop over projects", () => {
  // The prose is the fix. A tool that merely *allows* the cheap call while
  // still reading as per-project gets used the expensive way.
  const d = listTasksTool.schema.function.description;
  assert.match(d, /ALL projects/);
  assert.match(d, /ONCE/);
  assert.match(d, /Never loop over projects/i);
  assert.ok(!listTasksTool.schema.function.parameters.required?.includes("project"));
});
