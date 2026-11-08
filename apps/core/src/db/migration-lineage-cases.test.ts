import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { reconcileMigrationLineage } from "./migration-lineage.ts";
import { MIGRATIONS } from "./migrations.ts";

function fixture(home: string, version: number) {
  const db = new DatabaseSync(path.join(home, "apx.db"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const migration of MIGRATIONS.slice(0, version)) db.exec(migration);
  db.prepare("INSERT INTO meta VALUES ('schema_version', ?)").run(String(version));
  db.exec(`INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at)
    VALUES ('th_kept', 'loose', 'Kept chat', '[]', '2026-10-01', '2026-10-01');
    INSERT INTO runs (id, thread_id, agent_id, state, input, started_at, created_at)
    VALUES ('run_kept', 'th_kept', 'agent_kept', 'done', '{}', '2026-10-01', '2026-10-01');
    INSERT INTO tasks (id, title, status, thread_id, created_by, created_at, updated_at, activity_at)
    VALUES ('task_kept', 'Kept task', 'backlog', 'th_kept', 'owner', '2026-10-01', '2026-10-01', '2026-10-01');`);
  return db;
}

const schema = (db: DatabaseSync) => db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();

for (const version of [100, 101, 102, 103, 104, 105, 106, 107, 108]) {
  test(`canonical version ${version} upgrades and reopens without recovery or overwriting owner data`, async () => {
    const home = tempDir();
    let db = fixture(home.path, version);
    try {
      if (version >= 104) db.exec("UPDATE runs SET queue_order = 987");
      if (version >= 105)
        db.exec("UPDATE tasks SET goal = 'Keep the goal', asked = '[{\"text\":\"Keep the request\"}]'");
      if (version >= 108) db.exec("UPDATE runs SET trimmed = 2");
      const before = db.prepare("SELECT id, title FROM tasks").all();
      db.close();
      db = openDb(home.path);
      assert.deepEqual(db.prepare("SELECT id, title FROM tasks").all(), before);
      assert.equal(db.prepare("SELECT queue_order FROM runs").get()?.queue_order, version >= 104 ? 987 : 1);
      assert.equal(db.prepare("SELECT trimmed FROM runs").get()?.trimmed, version >= 108 ? 2 : 0);
      if (version >= 105) assert.equal(db.prepare("SELECT goal FROM tasks").get()?.goal, "Keep the goal");
      assert.equal(fs.existsSync(path.join(home.path, "backups")), false);
      const expected = schema(db);
      db.close();
      db = openDb(home.path);
      assert.deepEqual(schema(db), expected);
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally {
      if (db.isOpen) db.close();
      await home.remove();
    }
  });
}

for (const version of [100, 101, 102, 103, 104, 105, 106, 107, 108]) {
  test(`divergent counter ${version} repairs missing and already applied tail operations, preserving existing queue and task values`, async () => {
    const home = tempDir();
    let db = fixture(home.path, 105);
    try {
      db.exec("UPDATE runs SET queue_order = 987; UPDATE tasks SET goal = 'Keep me', asked = '[]'");
      db.exec(MIGRATIONS[107] ?? "");
      db.exec("UPDATE runs SET trimmed = 2");
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(version));
      db.close();
      db = openDb(home.path);
      assert.deepEqual(
        { ...db.prepare("SELECT queue_order, trimmed FROM runs").get() },
        { queue_order: 987, trimmed: 2 },
      );
      assert.deepEqual({ ...db.prepare("SELECT goal, asked FROM tasks").get() }, { goal: "Keep me", asked: "[]" });
      assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'model_log_run_seq'").get());
      assert.equal(
        db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value,
        String(MIGRATIONS.length),
      );
      assert.equal(fs.readdirSync(path.join(home.path, "backups")).length, 1);
    } finally {
      if (db.isOpen) db.close();
      await home.remove();
    }
  });
}

for (const fault of ["wrong index", "wrong column", "missing base", "backup unavailable", "commit rejected"]) {
  test(`recovery refuses ${fault} without advancing the counter or changing data/schema`, async () => {
    const home = tempDir();
    let db = fixture(home.path, 103);
    try {
      db.exec("UPDATE meta SET value = '105' WHERE key = 'schema_version'");
      if (fault === "wrong index") db.exec("CREATE INDEX model_log_run_seq ON model_log(seq)");
      else db.exec(MIGRATIONS[105] ?? "");
      if (fault === "wrong column") db.exec("ALTER TABLE tasks ADD COLUMN goal INTEGER");
      if (fault === "missing base") db.exec("DROP TRIGGER message_media_ad");
      if (fault === "backup unavailable") fs.writeFileSync(path.join(home.path, "backups"), "Not a directory");
      const before = schema(db);
      const tasks = db.prepare("SELECT * FROM tasks").all();
      if (fault === "commit rejected") {
        db.setAuthorizer((action, table, column) =>
          action === constants.SQLITE_UPDATE && table === "meta" && column === "value"
            ? constants.SQLITE_DENY
            : constants.SQLITE_OK,
        );
        assert.throws(() => reconcileMigrationLineage(db, home.path, 105), /not authorized/);
        db.setAuthorizer(null);
        db.close();
      } else {
        db.close();
        assert.throws(
          () => openDb(home.path),
          fault === "backup unavailable" ? /ENOTDIR/ : /incompatible|unsupported base/,
        );
      }
      db = new DatabaseSync(path.join(home.path, "apx.db"));
      assert.deepEqual(schema(db), before);
      assert.deepEqual(db.prepare("SELECT * FROM tasks").all(), tasks);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "105");
      // A failed open must release its connection so another writer can take the database immediately.
      db.exec("BEGIN EXCLUSIVE; ROLLBACK");
      if (fault === "commit rejected") {
        db.close();
        db = openDb(home.path);
        assert.equal(
          db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value,
          String(MIGRATIONS.length),
        );
        assert.equal(db.prepare("SELECT title FROM tasks").get()?.title, "Kept task");
        assert.equal(fs.readdirSync(path.join(home.path, "backups")).length, 2);
      }
    } finally {
      if (db.isOpen) db.close();
      await home.remove();
    }
  });
}

for (const version of ["bad", "105.5", "-1", "999", ""]) {
  test(`invalid or future schema version ${JSON.stringify(version)} fails closed`, async () => {
    const home = tempDir();
    const db = fixture(home.path, 103);
    try {
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(version);
      const before = schema(db);
      assert.throws(() => openDb(home.path), /Unsupported database schema_version/);
      assert.deepEqual(schema(db), before);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, version);
    } finally {
      db.close();
      await home.remove();
    }
  });
}
