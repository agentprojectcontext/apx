import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

test("task lineage survives missing historical task links, list caps and intermediate callers", async () => {
  const dir = tempDir("apx-thread-task-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store);
  try {
    const root = store.threads.create({ kind: "loose", title: "Task work", agent_ids: ["superagent"] });
    const task = store.tasks.create({ title: "Build inventory", status: "doing", thread_id: root.id, by: "owner" });
    const otherHome = store.threads.create({ kind: "task", title: "Review", agent_ids: ["superagent"] });
    const other = store.tasks.create({
      title: "Review inventory",
      status: "todo",
      thread_id: otherHome.id,
      by: "owner",
    });
    db.prepare("UPDATE threads SET task_id = ? WHERE id = ?").run(task.id, root.id);
    const middle = store.threads.create({
      kind: "a2a",
      title: "Helper",
      agent_ids: ["superagent"],
      parent_id: root.id,
    });
    const session = store.threads.create({
      kind: "code",
      engine: "claude",
      title: "Inventory",
      agent_ids: ["superagent"],
      parent_id: middle.id,
    });
    assert.equal(session.task_id, task.id, "new sessions inherit through the caller");
    // An old install saved only the parent links, not the task links.
    db.prepare("UPDATE threads SET task_id = NULL WHERE id IN (?, ?)").run(middle.id, session.id);
    assert.equal(store.threads.get(session.id)?.task_id, task.id);
    store.threads.arrange(session.id, { archived: true });
    assert.equal(store.threads.get(session.id)?.task_id, task.id, "archiving preserves ownership");
    assert.ok(store.threads.byTask(task.id).some((t) => t.id === session.id && t.archived));
    store.threads.arrange(session.id, { archived: false });
    const listed = store.threads.list({ engine: "claude", limit: 1 });
    assert.deepEqual(
      listed.map((t) => [t.id, t.task_id]),
      [[session.id, task.id]],
      "the parent need not be in the page",
    );
    const nested = store.threads.create({
      kind: "code",
      engine: "claude",
      title: "Other task",
      agent_ids: ["superagent"],
      parent_id: session.id,
      task_id: other.id,
    });
    const child = store.threads.create({
      kind: "code",
      engine: "claude",
      title: "Other helper",
      agent_ids: ["superagent"],
      parent_id: nested.id,
    });
    db.prepare("UPDATE threads SET task_id = NULL WHERE id = ?").run(child.id);
    assert.equal(store.threads.get(child.id)?.task_id, other.id, "nearest explicit task wins");
    assert.ok(!store.threads.byTask(task.id).some((t) => t.id === child.id || t.id === nested.id));
    assert.ok(store.threads.byTask(other.id).some((t) => t.id === child.id));
    const free = store.threads.create({ kind: "loose", title: "Free chat", agent_ids: ["superagent"] });
    const standalone = store.threads.create({
      kind: "code",
      engine: "claude",
      title: "Inventory",
      agent_ids: ["superagent"],
      parent_id: free.id,
    });
    assert.equal(standalone.task_id, undefined, "same title does not establish ownership");
    db.prepare("UPDATE threads SET parent_id = ? WHERE id = ?").run(standalone.id, free.id);
    assert.equal(store.threads.get(standalone.id)?.task_id, undefined, "malformed cycles terminate");
    assert.equal(
      db.prepare("SELECT task_id FROM threads WHERE id = ?").get(session.id)?.task_id,
      null,
      "reads do not migrate historical data",
    );
  } finally {
    db.close();
    await dir.remove();
  }
});
