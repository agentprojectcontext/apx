// The task routes added for the board: comments, subtasks, and configurable
// columns. Driven through buildApi() over a real socket, per AGENTS.md rule 1.
//
// No engine is involved anywhere here: a comment with no @mention summons
// nobody, which is exactly the property that makes these routes testable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Own sandbox BEFORE the modules load — the column catalog is written to the
// GLOBAL config, and a test that shares the runner's would edit the real one.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-taskroutes-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");

const TOKEN = "tasks-routes-token";
let server;
let baseUrl;

const api = (p, init = {}) =>
  fetch(`${baseUrl}/api${p}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body ?? {}) });
const put = (p, body) => api(p, { method: "PUT", body: JSON.stringify(body) });

before(async () => {
  const projects = new ProjectManager({});
  projects.registerDefault(); // id 0
  const app = buildApi({
    projects,
    registries: null,
    plugins: { instances: new Map(), get: () => null, status: () => ({}) },
    scheduler: null,
    version: "9.9.9",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: TOKEN,
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* gone */ }
});

async function newTask(fields) {
  const res = await post("/projects/0/tasks", fields);
  assert.equal(res.status, 201);
  return res.json();
}

// ── comments ────────────────────────────────────────────────────────────────

test("POST a comment stores it and summons nobody when it mentions nobody", async () => {
  const task = await newTask({ title: "comentable" });
  const res = await post(`/projects/0/tasks/${task.id}/comments`, { text: "una nota" });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.summoned, []);
  assert.equal(body.task.comments.length, 1);
  assert.equal(body.task.comments[0].text, "una nota");

  // And it is there on the next read, not just in the response.
  const again = await (await api(`/projects/0/tasks/${task.id}`)).json();
  assert.equal(again.comments.length, 1);
});

test("an empty comment is refused", async () => {
  const task = await newTask({ title: "x" });
  const res = await post(`/projects/0/tasks/${task.id}/comments`, { text: "   " });
  assert.equal(res.status, 400);
});

test("commenting on a task that does not exist is a 404", async () => {
  const res = await post("/projects/0/tasks/t_nope99/comments", { text: "hola" });
  assert.equal(res.status, 404);
});

test("list rows carry a comment count, not the thread", async () => {
  const task = await newTask({ title: "contada" });
  await post(`/projects/0/tasks/${task.id}/comments`, { text: "uno" });
  const page = await (await api("/projects/0/tasks?state=open")).json();
  const row = page.data.find((r) => r.id === task.id);
  assert.equal(row.comment_count, 1);
  assert.equal(row.comments, undefined);
});

// ── subtasks ────────────────────────────────────────────────────────────────

test("?parent selects children, and ?parent= selects the roots", async () => {
  const epic = await newTask({ title: "epic" });
  await newTask({ title: "kid uno", parent: epic.id });
  await newTask({ title: "kid dos", parent: epic.id });

  const kids = await (await api(`/projects/0/tasks?state=all&parent=${epic.id}`)).json();
  assert.deepEqual(kids.data.map((k) => k.title).sort(), ["kid dos", "kid uno"]);

  const roots = await (await api("/projects/0/tasks?state=all&parent=")).json();
  assert.ok(roots.data.every((r) => !r.parent), "no child may appear at the root");
  assert.ok(roots.data.some((r) => r.id === epic.id), "the epic itself is a root");

  const parent = await (await api(`/projects/0/tasks/${epic.id}`)).json();
  assert.equal(parent.subtask_count, 2);
  assert.equal(parent.subtask_done, 0);
});

// ── columns ─────────────────────────────────────────────────────────────────

test("the catalog starts as the four built-ins", async () => {
  const { columns } = await (await api("/tasks/columns")).json();
  assert.deepEqual(columns.map((c) => c.id), ["pending", "running", "in_review", "blocked"]);
});

test("the catalog is editable, and a project shows the subset it picked", async () => {
  const saved = await put("/tasks/columns", {
    columns: [{ id: "pending", label: "Pendiente" }, { id: "qa", label: "QA" }],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).columns.map((c) => c.id), ["pending", "qa"]);

  const picked = await put("/projects/0/tasks/columns", { columns: ["qa"] });
  assert.equal(picked.status, 200);
  const body = await picked.json();
  // The project's own order, with `done` appended — always, and always last.
  assert.deepEqual(body.columns.map((c) => c.id), ["qa", "done"]);
  assert.deepEqual(body.catalog.map((c) => c.id), ["pending", "qa"]);
});

test("a column id that is not slug-shaped, or is `done`, is refused", async () => {
  for (const bad of ["done", "NO PUEDE"]) {
    const res = await put("/tasks/columns", { columns: [{ id: bad }] });
    assert.equal(res.status, 400, `${bad} must be refused`);
  }
  const empty = await put("/tasks/columns", { columns: [] });
  assert.equal(empty.status, 400);
});

test("a task can be moved to a configured column, and only to one", async () => {
  // The project is pinned to ["qa"] by the test above.
  const task = await newTask({ title: "movible" });
  const ok = await post(`/projects/0/tasks/${task.id}/status`, { status: "qa" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, "qa");

  // `in_review` is a built-in, but this project does not show it — a board can
  // only move a card to a column it actually has.
  const nope = await post(`/projects/0/tasks/${task.id}/status`, { status: "in_review" });
  assert.equal(nope.status, 400);

  // `done` is a state, not a column: closing goes through its own route.
  const done = await post(`/projects/0/tasks/${task.id}/status`, { status: "done" });
  assert.equal(done.status, 400);
});

test("a custom column survives a round trip through the event log", async () => {
  const task = await newTask({ title: "persistente" });
  await post(`/projects/0/tasks/${task.id}/status`, { status: "qa" });
  const read = await (await api(`/projects/0/tasks/${task.id}`)).json();
  assert.equal(read.status, "qa", "the fold must not rewrite a status it no longer recognises");
});
