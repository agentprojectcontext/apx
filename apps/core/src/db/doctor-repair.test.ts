import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { defaultHome, legacyHome } from "../config.ts";
import { acquireDaemonLock } from "../daemon-lock.ts";
import { tempDir } from "../testkit/platform.ts";
import { repairOfflineDatabase } from "./doctor-repair.ts";
import { MIGRATIONS } from "./migrations.ts";

function fixture(home: string): DatabaseSync {
  const db = new DatabaseSync(path.join(home, "apx.db"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const sql of MIGRATIONS.slice(0, 108)) db.exec(sql);
  db.exec(
    "ALTER TABLE jobs ADD COLUMN start_error TEXT; INSERT INTO meta VALUES ('schema_version','109'); INSERT INTO meta VALUES ('kept','Committed data')",
  );
  return db;
}

test("offline repair runs as a core process without a server, with a consistent private backup", async () => {
  await using home = tempDir();
  const source = fixture(home.path);
  source.exec(`
    ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT;
    INSERT INTO projects (id, name, created_at) VALUES ('p', 'Acme', '2026-01-01');
    INSERT INTO flows (id, project_id, enabled, predicates, table_key) VALUES ('f', 'p', 1, '[]', 'latest');
    INSERT INTO flow_schedules (flow_id, since, skipped, skipped_at, activated_at)
      VALUES ('f', '2026-01-02', 4, '2026-01-03', '2026-01-04');
    CREATE INDEX runs_usage_started ON runs(started_at) WHERE model IS NOT NULL;
    CREATE INDEX threads_held_count ON threads(json_array_length(context, '$.held'));
  `);
  source.close();
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "doctor-repair-main.ts")], {
    env: { ...process.env, APX_HOME: home.path },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout) as { version: number; backup: string };
  assert.equal(result.version, 115);
  for (const [file, version] of [
    [path.join(home.path, "apx.db"), "115"],
    [result.backup, "109"],
  ]) {
    assert.ok(file);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='kept'").get()?.value, "Committed data");
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, version);
      assert.equal(db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.deepEqual(
        { ...db.prepare("SELECT * FROM flow_schedules WHERE flow_id='f'").get() },
        {
          flow_id: "f",
          since: "2026-01-02",
          skipped: 4,
          skipped_at: "2026-01-03",
          activated_at: "2026-01-04",
        },
      );
      assert.equal(
        Boolean(db.prepare("SELECT name FROM sqlite_schema WHERE name='runs_usage_started'").get()),
        version === "109",
      );
    } finally {
      db.close();
    }
  }
  if (process.platform !== "win32") assert.equal(fs.statSync(result.backup).mode & 0o777, 0o600);
});

test("a hand-added index is dropped by the repair; an unknown table is refused without changing data", async () => {
  await using home = tempDir();
  const db = fixture(home.path);
  db.exec("CREATE INDEX runs_usage_started ON runs(started_at) WHERE model IS NOT NULL");
  db.close();
  const repaired = repairOfflineDatabase(home.path);
  assert.equal(repaired.version, 115);
  const check = new DatabaseSync(path.join(home.path, "apx.db"), { readOnly: true });
  const saved = new DatabaseSync(repaired.backup, { readOnly: true });
  try {
    assert.equal(check.prepare("SELECT name FROM sqlite_schema WHERE name='runs_usage_started'").get(), undefined);
    assert.equal(check.prepare("SELECT value FROM meta WHERE key='kept'").get()?.value, "Committed data");
    assert.ok(saved.prepare("SELECT name FROM sqlite_schema WHERE name='runs_usage_started'").get());
  } finally {
    check.close();
    saved.close();
  }

  await using other = tempDir();
  const unknown = fixture(other.path);
  unknown.exec("CREATE TABLE notes_by_hand (id TEXT)");
  unknown.close();
  assert.throws(() => repairOfflineDatabase(other.path), /unrecognized schema objects/);
  const kept = new DatabaseSync(path.join(other.path, "apx.db"), { readOnly: true });
  try {
    assert.equal(kept.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "109");
    assert.ok(kept.prepare("SELECT name FROM sqlite_schema WHERE name='notes_by_hand'").get());
    assert.equal(fs.existsSync(path.join(other.path, "backups")), false);
  } finally {
    kept.close();
  }
});

test("offline repair refuses an active daemon and an independent SQLite connection", async () => {
  await using home = tempDir();
  fixture(home.path).close();
  const lock = acquireDaemonLock(home.path);
  try {
    assert.throws(() => repairOfflineDatabase(home.path), /daemon already owns/);
  } finally {
    lock.release();
  }
  const db = new DatabaseSync(path.join(home.path, "apx.db"));
  db.exec("BEGIN IMMEDIATE");
  try {
    assert.throws(() => repairOfflineDatabase(home.path), /locked/);
  } finally {
    db.exec("ROLLBACK");
    db.close();
  }
  assert.equal(repairOfflineDatabase(home.path).version, 115);
});

test("failed post-repair foreign key validation rolls back and preserves the backup", async () => {
  await using home = tempDir();
  const db = fixture(home.path);
  db.exec(
    "PRAGMA foreign_keys=OFF; INSERT INTO messages (id,thread_id,seq,author,parts,created_at) VALUES ('bad','absent',1,'owner','[]','2026-01-01')",
  );
  db.close();
  assert.throws(() => repairOfflineDatabase(home.path), /foreign key check failed/);
  const check = new DatabaseSync(path.join(home.path, "apx.db"));
  try {
    assert.equal(check.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "109");
    assert.equal(check.prepare("SELECT count(*) AS n FROM messages").get()?.n, 1);
    assert.equal(check.prepare("SELECT name FROM sqlite_schema WHERE name='tasks_start'").get(), undefined);
  } finally {
    check.close();
  }
  assert.equal(fs.readdirSync(path.join(home.path, "backups")).length, 1);
});

test("test runners cannot repair either real home", () => {
  assert.throws(() => repairOfflineDatabase(defaultHome()), /refusing to repair the real home from a test/);
  assert.throws(() => repairOfflineDatabase(legacyHome()), /refusing to repair the real home from a test/);
});

test("a missing database is not silently created", async () => {
  await using home = tempDir();
  assert.throws(() => repairOfflineDatabase(home.path), /No existing database/);
  assert.equal(fs.existsSync(path.join(home.path, "apx.db")), false);
});
