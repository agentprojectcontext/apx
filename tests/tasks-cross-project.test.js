// C2 — cross-project task aggregation, plus the two filters the per-project
// reader was missing (workflow sub-status and "what moved since").
//
// The aggregation lives in core rather than in the daemon route because the
// CLI, the HTTP API and the panel all need it (AGENTS.md rule 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createTask,
  listTasks,
  listTasksAcrossProjects,
  setTaskStatus,
  doneTask,
} from "#core/stores/tasks.js";

function tempProject(name) {
  return {
    id: name,
    name,
    storagePath: fs.mkdtempSync(path.join(os.tmpdir(), `apx-tasks-${name}-`)),
  };
}

function cleanup(...projects) {
  for (const p of projects) fs.rmSync(p.storagePath, { recursive: true, force: true });
}

/**
 * Append a `create` event with a chosen timestamp. createTask() always stamps
 * nowIso(), so a test that needs two DIFFERENT times has to write the event
 * itself — the store is an append-only JSONL log, so this is the same thing the
 * store would have written.
 */
function seedTaskAt(storagePath, { id, title, ts }) {
  const dir = path.join(storagePath, "tasks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts.slice(0, 7)}.jsonl`);
  fs.appendFileSync(
    file,
    JSON.stringify({ id, ts, op: "create", title, tags: [], meta: {} }) + "\n"
  );
}

// --------------------------------------------------------------------------

test("aggregates across projects and labels every row with where it came from", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    createTask(a.storagePath, { title: "in alpha" });
    createTask(b.storagePath, { title: "in beta" });

    const { tasks, skipped } = listTasksAcrossProjects([a, b]);

    assert.equal(tasks.length, 2);
    assert.deepEqual(skipped, []);
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    assert.equal(byTitle["in alpha"].project_id, "alpha");
    assert.equal(byTitle["in alpha"].project_name, "alpha");
    assert.equal(byTitle["in beta"].project_id, "beta");
  } finally {
    cleanup(a, b);
  }
});

test("defaults to open tasks, and state=all includes closed ones", () => {
  const a = tempProject("alpha");
  try {
    createTask(a.storagePath, { title: "still open" });
    const done = createTask(a.storagePath, { title: "finished" });
    doneTask(a.storagePath, done.id);

    assert.deepEqual(
      listTasksAcrossProjects([a]).tasks.map((t) => t.title),
      ["still open"],
      "the default view is open work"
    );
    assert.equal(listTasksAcrossProjects([a], { state: undefined }).tasks.length, 1);
    assert.equal(
      listTasksAcrossProjects([a], { state: "done" }).tasks.length,
      1,
      "closed tasks are still reachable"
    );
  } finally {
    cleanup(a);
  }
});

test("a project with an unreadable task log is skipped, not fatal", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    createTask(a.storagePath, { title: "survives" });

    // One corrupt project must not blank out the whole cross-project view.
    // A plain file where the tasks DIRECTORY belongs — readdirSync throws.
    const broken = { id: "broken", name: "broken", storagePath: b.storagePath };
    fs.writeFileSync(path.join(b.storagePath, "tasks"), "not a directory");

    const { tasks } = listTasksAcrossProjects([a, broken]);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "survives");
  } finally {
    cleanup(a, b);
  }
});

test("entries without a storagePath are ignored rather than throwing", () => {
  const a = tempProject("alpha");
  try {
    createTask(a.storagePath, { title: "only one" });
    const { tasks } = listTasksAcrossProjects([a, { id: "ghost", name: "ghost" }, null]);
    assert.equal(tasks.length, 1);
  } finally {
    cleanup(a);
  }
});

// A per-project limit would silently favour whichever project sorts first, so
// the limit has to apply after the merge.
test("limit applies to the merged list, not per project", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    for (let i = 0; i < 3; i++) createTask(a.storagePath, { title: `a${i}` });
    for (let i = 0; i < 3; i++) createTask(b.storagePath, { title: `b${i}` });

    const { tasks } = listTasksAcrossProjects([a, b], { limit: 4 });
    assert.equal(tasks.length, 4);
  } finally {
    cleanup(a, b);
  }
});

test("results are sorted newest first across every project", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    seedTaskAt(a.storagePath, { id: "t_older", title: "older", ts: "2020-01-01T00:00:00Z" });
    seedTaskAt(b.storagePath, { id: "t_newer", title: "newer", ts: "2026-01-01T00:00:00Z" });

    const titles = listTasksAcrossProjects([a, b]).tasks.map((t) => t.title);
    assert.equal(titles[0], "newer", "newest first, regardless of which project it is in");
  } finally {
    cleanup(a, b);
  }
});

// nowIso() has second resolution, so a burst of tasks — a routine filing
// several at once — shares one created_at. Ties must break deterministically or
// the list reshuffles between two identical calls.
test("same-second tasks come back in a stable order", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    for (let i = 0; i < 5; i++) createTask(a.storagePath, { title: `a${i}` });
    for (let i = 0; i < 5; i++) createTask(b.storagePath, { title: `b${i}` });

    const once = listTasksAcrossProjects([a, b]).tasks.map((t) => t.id);
    const twice = listTasksAcrossProjects([a, b]).tasks.map((t) => t.id);
    const reversed = listTasksAcrossProjects([b, a]).tasks.map((t) => t.id);

    assert.deepEqual(twice, once, "two identical calls must agree");
    assert.deepEqual(reversed, once, "and the project order must not change the result");
  } finally {
    cleanup(a, b);
  }
});

// --------------------------------------------------------------------------
// filters that did not exist before
// --------------------------------------------------------------------------

test("filters by workflow sub-status — 'what is blocked' is not 'what is open'", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    const stuck = createTask(a.storagePath, { title: "stuck" });
    setTaskStatus(a.storagePath, stuck.id, "blocked");
    createTask(a.storagePath, { title: "fine" });
    const alsoStuck = createTask(b.storagePath, { title: "stuck elsewhere" });
    setTaskStatus(b.storagePath, alsoStuck.id, "blocked");

    const { tasks } = listTasksAcrossProjects([a, b], { status: "blocked" });
    assert.deepEqual(tasks.map((t) => t.title).sort(), ["stuck", "stuck elsewhere"]);
  } finally {
    cleanup(a, b);
  }
});

test("filters by updated_since — the cheap way to ask what moved", () => {
  const a = tempProject("alpha");
  try {
    const old = createTask(a.storagePath, { title: "untouched" });
    const moved = createTask(a.storagePath, { title: "moved" });

    // Everything is created "now", so use a cutoff after creation and then
    // touch one of them.
    const cutoff = new Date(Date.now() + 1000).toISOString();
    assert.equal(listTasks(a.storagePath, { updated_since: cutoff }).length, 0);

    setTaskStatus(a.storagePath, moved.id, "running");
    const later = listTasks(a.storagePath, { updated_since: old.created_at });
    assert.ok(later.some((t) => t.title === "moved"));
  } finally {
    cleanup(a);
  }
});

test("cross-project filters compose with per-project ones", () => {
  const a = tempProject("alpha");
  const b = tempProject("beta");
  try {
    createTask(a.storagePath, { title: "tagged here", tags: ["urgent"] });
    createTask(a.storagePath, { title: "untagged" });
    createTask(b.storagePath, { title: "tagged there", tags: ["urgent"] });

    const { tasks } = listTasksAcrossProjects([a, b], { tag: "urgent" });
    assert.deepEqual(tasks.map((t) => t.title).sort(), ["tagged here", "tagged there"]);
    assert.deepEqual([...new Set(tasks.map((t) => t.project_id))].sort(), ["alpha", "beta"]);
  } finally {
    cleanup(a, b);
  }
});

test("per-project behaviour is unchanged — no project_id leaks into listTasks", () => {
  const a = tempProject("alpha");
  try {
    createTask(a.storagePath, { title: "plain" });
    const [task] = listTasks(a.storagePath);
    assert.equal(task.title, "plain");
    assert.equal(task.project_id, undefined, "the single-project reader must stay as it was");
    assert.equal(task.project_name, undefined);
  } finally {
    cleanup(a);
  }
});
