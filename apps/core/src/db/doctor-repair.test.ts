import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
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
  fixture(home.path).close();
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
    } finally {
      db.close();
    }
  }
  if (process.platform !== "win32") assert.equal(fs.statSync(result.backup).mode & 0o777, 0o600);
});

test("unknown indexes are refused without deleting them or changing data", async () => {
  await using home = tempDir();
  const db = fixture(home.path);
  db.exec("CREATE INDEX runs_usage_started ON runs(started_at)");
  db.close();
  assert.throws(() => repairOfflineDatabase(home.path), /unrecognized schema objects/);
  const check = new DatabaseSync(path.join(home.path, "apx.db"));
  try {
    assert.equal(check.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "109");
    assert.ok(check.prepare("SELECT name FROM sqlite_schema WHERE name='runs_usage_started'").get());
    assert.equal(check.prepare("SELECT value FROM meta WHERE key='kept'").get()?.value, "Committed data");
    assert.equal(fs.existsSync(path.join(home.path, "backups")), false);
  } finally {
    check.close();
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

test("a missing database is not silently created", async () => {
  await using home = tempDir();
  assert.throws(() => repairOfflineDatabase(home.path), /No existing database/);
  assert.equal(fs.existsSync(path.join(home.path, "apx.db")), false);
});
