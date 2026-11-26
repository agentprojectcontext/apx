import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { createStore } from "../domain/store.ts";
import { noticeTaskProposed } from "../domain/task-attention.ts";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { MIGRATIONS } from "./migrations.ts";

test("proposal attribution migration preserves legacy proposals and notices without inferring an actor", async () => {
  const tmp = tempDir();
  const old = new DatabaseSync(path.join(tmp.path, "apx.db"));
  const at = MIGRATIONS.findIndex((m) => m.includes("ADD COLUMN proposed_by"));
  assert.ok(at > 0);
  old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const migration of MIGRATIONS.slice(0, at)) old.exec(migration);
  old.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(at));
  for (const state of ["open", "done", "dropped"]) {
    old
      .prepare(
        "INSERT INTO tasks (id, title, status, state, proposed, thread_id, created_by, created_at, updated_at, activity_at) VALUES (?, 'Proposal', 'todo', ?, 1, ?, 'creator', '2026-01-01', '2026-01-01', '2026-01-01')",
      )
      .run(`task_${state}`, state, `th_${state}`);
  }
  old
    .prepare(
      "INSERT INTO notifications (id, kind, level, title, body, ref, created_at) VALUES ('ntf_legacy', 'task', 'info', 'Creator', 'Original notice', 'proposals:creator', '2026-01-01')",
    )
    .run();
  const before = old
    .prepare("SELECT * FROM tasks ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  const notices = old.prepare("SELECT * FROM notifications").all();
  old.close();
  const db = openDb(tmp.path);
  try {
    const after = db.prepare("SELECT * FROM tasks ORDER BY id").all();
    assert.deepEqual(
      after.map(({ proposed_by, ...row }) => {
        assert.equal(proposed_by, null);
        return row;
      }),
      before,
    );
    const store = createStore(db, createBus());
    const legacy = store.tasks.get("task_open");
    assert.ok(legacy);
    assert.equal(legacy.proposed_by, undefined);
    noticeTaskProposed(store, legacy);
    assert.deepEqual(db.prepare("SELECT * FROM notifications").all(), notices);
    assert.equal(store.tasks.change(legacy.id, { title: "Updated proposal" }, "editor")?.proposed_by, undefined);
    const proposed = store.tasks.create({
      title: "New proposal",
      status: "todo",
      thread_id: "th_new",
      proposed: true,
      by: "creator",
    });
    assert.equal(proposed.proposed_by, "creator");
    for (let i = 0; i < 500; i++) {
      store.tasks.create({
        title: "Another proposal",
        status: "todo",
        thread_id: `th_new_${i}`,
        proposed: true,
        by: "creator",
      });
    }
    noticeTaskProposed(store, proposed);
    const fresh = store.notifications
      .list({ unreadOnly: true, limit: 10 })
      .find((n) => n.ref === "proposal-author:creator");
    assert.ok(fresh);
    assert.match(
      fresh.body,
      /^501 /,
      "the count is exact beyond the task-list limit and excludes unknown legacy authors",
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM notifications WHERE id = 'ntf_legacy'").all(),
      notices,
      "a new proposal cannot overwrite the unread legacy notice",
    );
    noticeTaskProposed(store, proposed);
    assert.equal(
      store.notifications.list({ unreadOnly: true, limit: 10 }).length,
      2,
      "new notices still group by proposer",
    );
    const accepted = store.tasks.change(proposed.id, { proposed: false }, "owner");
    assert.equal(accepted?.proposed_by, undefined);
    assert.equal(accepted?.proposed, undefined);
  } finally {
    db.close();
    await tmp.remove();
  }
});
