import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { flowSchedulesRepo } from "../domain/flow-schedules.ts";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { reconcileHotfixLineage } from "./migration-hotfix.ts";
import { MIGRATIONS } from "./migrations.ts";

function fixture(home: string, version: number, hotfix = false): DatabaseSync {
  const db = new DatabaseSync(path.join(home, "apx.db"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const sql of MIGRATIONS.slice(0, 108)) db.exec(sql);
  db.exec(`
    INSERT INTO agents (id,name,kind,created_at) VALUES ('superagent','Assistant','secretary','2026-01-01');
    INSERT INTO agents (id,name,kind,created_at) VALUES ('helper','Helper','agent','2026-01-01');
    INSERT INTO threads (id,kind,title,agent_ids,created_at,updated_at)
      VALUES ('kept','loose','Kept chat','[]','2026-01-01','2026-01-01');
    INSERT INTO messages (id,thread_id,seq,author,parts,created_at)
      VALUES ('message','kept',1,'owner','[]','2026-01-01');
    INSERT INTO jobs (id,kind,title,cwd,thread_id,state,background,started_at,ended_at)
      VALUES ('job','terminal','Kept command','/tmp','kept','failed',0,'2026-01-01','2026-01-01');
    INSERT INTO persons (id,name,role,created_at,updated_at,perms,any_hour)
      VALUES ('contact','Contact','contact','2026-01-01','2026-01-01','{"send":true,"read":false}',1);
    INSERT INTO meta VALUES ('setting:channels','[{"id":"account","agent_id":"helper","owner_thread":"home"}]');
  `);
  if (hotfix) db.exec("ALTER TABLE jobs ADD COLUMN start_error TEXT");
  else for (const sql of MIGRATIONS.slice(108, version)) db.exec(sql);
  db.prepare("INSERT INTO meta VALUES ('schema_version', ?)").run(String(version));
  if (hotfix || version >= 115) db.exec("UPDATE jobs SET start_error = 'Kept launch reason'");
  return db;
}

function channels(db: DatabaseSync): { agent_id: string; contacts_agent_id?: string }[] {
  return JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key = 'setting:channels'").get()?.value));
}

function healthy(db: DatabaseSync): void {
  assert.equal(db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
}

for (const origin of [108, 109, 110, 111, 112, 113, 114, 115, "hotfix109"] as const) {
  test(`database ${origin} upgrades without repeating transformations or losing data`, async () => {
    await using home = tempDir("apx-hotfix-migration-");
    const hotfix = origin === "hotfix109";
    fixture(home.path, hotfix ? 109 : origin, hotfix).close();
    const db = openDb(home.path);
    try {
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "115");
      assert.equal(db.prepare("SELECT parts FROM messages WHERE id = 'message'").get()?.parts, "[]");
      assert.equal(db.prepare("SELECT thread_id FROM jobs WHERE id = 'job'").get()?.thread_id, "kept");
      assert.equal(
        db.prepare("SELECT start_error FROM jobs WHERE id = 'job'").get()?.start_error,
        hotfix || origin === 115 ? "Kept launch reason" : null,
      );
      for (const index of [
        "tasks_start",
        "tasks_status",
        "tasks_parent_state",
        "outbox_channel_created",
        "projects_parent",
      ]) {
        assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = ?").get(index)?.name, index);
      }
      assert.equal(channels(db)[0]?.agent_id, "superagent");
      assert.equal(channels(db)[0]?.contacts_agent_id, "helper");
      assert.deepEqual(JSON.parse(String(db.prepare("SELECT perms FROM persons").get()?.perms)), {
        send: true,
        any_hour: true,
      });
      assert.equal(db.prepare("SELECT agent_id FROM persons").get()?.agent_id, null);
      healthy(db);
      db.exec(`UPDATE meta SET value = '[{"id":"account","agent_id":"helper","owner_thread":"home"}]'
        WHERE key = 'setting:channels';
        UPDATE persons SET perms = '{"send":false,"custom":true}', agent_id = 'helper';`);
    } finally {
      db.close();
    }
    const reopened = openDb(home.path);
    try {
      assert.equal(channels(reopened)[0]?.agent_id, "helper");
      assert.equal(channels(reopened)[0]?.contacts_agent_id, undefined);
      assert.deepEqual(JSON.parse(String(reopened.prepare("SELECT perms FROM persons").get()?.perms)), {
        send: false,
        custom: true,
      });
      assert.equal(reopened.prepare("SELECT agent_id FROM persons").get()?.agent_id, "helper");
      healthy(reopened);
    } finally {
      reopened.close();
    }
  });
}

test("a fresh database reaches the integrated schema", async () => {
  await using home = tempDir();
  const db = openDb(home.path);
  try {
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "115");
    assert.ok(
      db
        .prepare("PRAGMA table_xinfo(jobs)")
        .all()
        .some((row) => row.name === "start_error"),
    );
    healthy(db);
  } finally {
    db.close();
  }
});

test("a failed hotfix reconciliation rolls back all transformations, keeps a private WAL backup and can retry", async () => {
  await using home = tempDir();
  const db = fixture(home.path, 109, true);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA foreign_keys = ON");
  db.exec("UPDATE jobs SET start_error = 'Committed in WAL'");
  const exec = db.exec.bind(db);
  db.exec = (sql: string) => {
    if (sql === MIGRATIONS[111]) throw new Error("Storage unavailable");
    return exec(sql);
  };
  try {
    assert.throws(() => reconcileHotfixLineage(db, home.path, 109), /Storage unavailable/);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "109");
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'tasks_start'").get(), undefined);
    assert.equal(channels(db)[0]?.agent_id, "helper");
    assert.equal(db.prepare("SELECT any_hour FROM persons").get()?.any_hour, 1);
    healthy(db);
    const directory = path.join(home.path, "backups", fs.readdirSync(path.join(home.path, "backups"))[0] ?? "");
    const file = path.join(directory, "apx.db");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    const backup = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(backup.prepare("SELECT start_error FROM jobs").get()?.start_error, "Committed in WAL");
      assert.equal(backup.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "109");
      healthy(backup);
    } finally {
      backup.close();
    }
  } finally {
    db.exec = exec;
    db.close();
  }
  const retried = openDb(home.path);
  try {
    assert.equal(retried.prepare("SELECT start_error FROM jobs").get()?.start_error, "Committed in WAL");
    healthy(retried);
  } finally {
    retried.close();
  }
});

test("indexes added by hand to a hotfix database are dropped, kept in the backup, and the upgrade continues", async () => {
  await using home = tempDir();
  const db = fixture(home.path, 109, true);
  db.exec(`
    CREATE INDEX runs_usage_started ON runs(started_at) WHERE model IS NOT NULL;
    CREATE INDEX threads_held_count ON threads(json_array_length(context, '$.held'));
  `);
  db.close();
  const upgraded = openDb(home.path);
  try {
    assert.equal(upgraded.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "115");
    assert.equal(upgraded.prepare("SELECT start_error FROM jobs").get()?.start_error, "Kept launch reason");
    assert.equal(upgraded.prepare("SELECT parts FROM messages WHERE id = 'message'").get()?.parts, "[]");
    for (const name of ["runs_usage_started", "threads_held_count"]) {
      assert.equal(upgraded.prepare("SELECT name FROM sqlite_schema WHERE name = ?").get(name), undefined);
    }
    healthy(upgraded);
  } finally {
    upgraded.close();
  }
  const directory = path.join(home.path, "backups", fs.readdirSync(path.join(home.path, "backups"))[0] ?? "");
  const backup = new DatabaseSync(path.join(directory, "apx.db"), { readOnly: true });
  try {
    assert.equal(backup.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "109");
    assert.match(
      String(backup.prepare("SELECT sql FROM sqlite_schema WHERE name = 'runs_usage_started'").get()?.sql),
      /WHERE model IS NOT NULL/,
    );
  } finally {
    backup.close();
  }
});

test("the observed hotfix schedule extension preserves its values through upgrade and reopen", async () => {
  await using home = tempDir();
  const db = fixture(home.path, 109, true);
  db.exec(`
    ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT;
    INSERT INTO projects (id, name, created_at) VALUES ('schedule-project', 'Acme', '2026-01-01');
    INSERT INTO flows (id, project_id, enabled, predicates, table_key)
      VALUES ('scheduled', 'schedule-project', 1, '[]', 'latest');
    INSERT INTO flow_schedules (flow_id, since, skipped, skipped_at, activated_at)
      VALUES ('scheduled', '2026-01-02', 3, '2026-01-03', '2026-01-04');
    CREATE INDEX runs_usage_started ON runs(started_at) WHERE model IS NOT NULL;
    CREATE INDEX threads_held_count ON threads(json_array_length(context, '$.held'));
  `);
  const expected = db.prepare("SELECT * FROM flow_schedules").all();
  db.close();
  for (const attempt of [1, 2]) {
    const upgraded = openDb(home.path);
    try {
      assert.equal(upgraded.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "115");
      assert.deepEqual(upgraded.prepare("SELECT * FROM flow_schedules").all(), expected, `open ${attempt}`);
      healthy(upgraded);
    } finally {
      upgraded.close();
    }
  }
  const backups = fs.readdirSync(path.join(home.path, "backups"));
  assert.equal(backups.length, 1);
  const saved = new DatabaseSync(path.join(home.path, "backups", backups[0] ?? "", "apx.db"), { readOnly: true });
  try {
    assert.deepEqual(saved.prepare("SELECT * FROM flow_schedules").all(), expected);
    assert.equal(saved.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "109");
    assert.ok(saved.prepare("SELECT name FROM sqlite_schema WHERE name='threads_held_count'").get());
  } finally {
    saved.close();
  }
  const current = openDb(home.path);
  try {
    const schedules = flowSchedulesRepo(current);
    assert.equal(schedules.since("scheduled"), "2026-01-02");
    schedules.reset("scheduled", new Date("2026-02-01T00:00:00Z"));
    schedules.skip("scheduled", new Date("2026-02-02T00:00:00Z"));
    assert.equal(schedules.since("scheduled"), "2026-02-02T00:00:00.000Z");
    assert.equal(schedules.skips("scheduled").skipped, 4);
    assert.equal(current.prepare("SELECT activated_at FROM flow_schedules").get()?.activated_at, "2026-01-04");
    healthy(current);
  } finally {
    current.close();
  }
});

for (const alteration of [
  "DROP TABLE flow_schedules; CREATE TABLE flow_schedules (flow_id TEXT PRIMARY KEY, since TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0, skipped_at TEXT, activated_at TEXT)",
  "ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT; CREATE TRIGGER changed_schedule AFTER INSERT ON flow_schedules BEGIN UPDATE flow_schedules SET since='changed' WHERE flow_id=NEW.flow_id; END",
  "ALTER TABLE flow_schedules ADD COLUMN activated_at INTEGER",
  "ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT DEFAULT 'Unknown'",
  "ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT; ALTER TABLE flow_schedules ADD COLUMN custom TEXT",
  "ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT; ALTER TABLE flow_schedules RENAME COLUMN since TO previous_since",
  "CREATE UNIQUE INDEX runs_one_start ON runs(id, started_at)",
  "CREATE INDEX runs_since ON runs(started_at); CREATE TABLE notes_by_hand (id TEXT)",
  "CREATE VIEW recent_runs AS SELECT id FROM runs",
  "ALTER TABLE jobs DROP COLUMN start_error; ALTER TABLE jobs ADD COLUMN start_error INTEGER",
  "ALTER TABLE jobs DROP COLUMN start_error; ALTER TABLE jobs ADD COLUMN start_error TEXT DEFAULT 'Unknown'",
  "CREATE INDEX tasks_start ON tasks(state, start_at) WHERE start_at IS NOT NULL",
  "UPDATE meta SET value = '110' WHERE key = 'schema_version'",
]) {
  test(`an unrecognized hotfix schema is rejected without changing data: ${alteration}`, async () => {
    await using home = tempDir();
    const db = fixture(home.path, 109, true);
    db.exec(alteration);
    const before = db.prepare("SELECT * FROM jobs").all();
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value;
    try {
      assert.throws(() => openDb(home.path), /Cannot reconcile hotfix database/);
      assert.deepEqual(db.prepare("SELECT * FROM jobs").all(), before);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, version);
      assert.equal(channels(db)[0]?.agent_id, "helper");
    } finally {
      db.close();
    }
  });
}
