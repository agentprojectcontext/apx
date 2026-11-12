import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { diagnoseOfflineSchema } from "./doctor-schema.ts";
import { MIGRATIONS } from "./migrations.ts";

function fixture(home: string, hotfix = false) {
  const db = new DatabaseSync(path.join(home, "apx.db"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const sql of MIGRATIONS.slice(0, hotfix ? 108 : MIGRATIONS.length)) db.exec(sql);
  if (hotfix) db.exec("ALTER TABLE jobs ADD COLUMN start_error TEXT");
  db.prepare("INSERT INTO meta VALUES ('schema_version', ?)").run(String(hotfix ? 109 : MIGRATIONS.length));
  db.exec("INSERT INTO meta VALUES ('private:secret', 'private-owner-value')");
  return db;
}

test("schema diagnosis lists simultaneous table, column, FK, index, view and trigger differences without owner values", async () => {
  await using folder = tempDir();
  const home = folder.path;
  const db = fixture(home);
  db.exec(`
    ALTER TABLE flow_schedules ADD COLUMN extension TEXT DEFAULT 'private-default-value';
    DROP INDEX tasks_start;
    CREATE INDEX extra_read_index ON tasks(title);
    CREATE TABLE extra_table (id TEXT REFERENCES projects(id));
    CREATE VIEW extra_view AS SELECT 'private-view-value';
    CREATE TRIGGER extra_trigger AFTER INSERT ON extra_table BEGIN SELECT 'private-trigger-value'; END;
    ALTER TABLE flow_schedules RENAME TO old_schedules;
    CREATE TABLE flow_schedules (flow_id TEXT PRIMARY KEY, since TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0, skipped_at TEXT, extension TEXT DEFAULT 'private-default-value');
    DROP TABLE old_schedules;
  `);
  db.close();
  const file = path.join(home, "apx.db");
  const before = fs.readFileSync(file);
  const report = diagnoseOfflineSchema(home);
  for (const name of [
    "flow_schedules",
    "tasks_start",
    "extra_read_index",
    "extra_table",
    "extra_view",
    "extra_trigger",
  ]) {
    assert.ok(
      report.differences.some((diff) => diff.object === name),
      name,
    );
  }
  assert.ok(report.differences.some((diff) => diff.object === "flow_schedules" && diff.kind === "foreign keys differ"));
  assert.ok(report.differences.some((diff) => diff.columns?.includes("extension")));
  assert.doesNotMatch(JSON.stringify(report), /private-(owner|default|view|trigger)-value/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(path.join(home, "backups")), false);
});

test("schema diagnosis uses the published hotfix reference and separately lists pending migrations", async () => {
  await using folder = tempDir();
  const home = folder.path;
  const db = fixture(home, true);
  db.exec(
    "ALTER TABLE flow_schedules ADD COLUMN activated_at TEXT; CREATE INDEX runs_usage_started ON runs(started_at) WHERE model IS NOT NULL; CREATE INDEX threads_held_count ON threads(json_array_length(context, '$.held'))",
  );
  db.close();
  const report = diagnoseOfflineSchema(home);
  assert.match(report.reference, /Published 2.13.4/);
  assert.deepEqual([...new Set(report.differences.map((diff) => diff.object))].sort(), [
    "flow_schedules",
    "runs_usage_started",
    "threads_held_count",
  ]);
  assert.ok(
    report.target_differences.some((diff) => diff.object === "projects" && diff.columns?.includes("parent_id")),
  );
});

test("schema diagnosis reports changed column constraints without exposing defaults and reads a live WAL snapshot", async () => {
  await using folder = tempDir();
  const db = fixture(folder.path);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; ALTER TABLE jobs DROP COLUMN start_error; ALTER TABLE jobs ADD COLUMN start_error INTEGER DEFAULT 'hidden-default'; BEGIN IMMEDIATE",
    );
    const report = diagnoseOfflineSchema(folder.path);
    assert.ok(
      report.differences.some(
        (diff) => diff.object === "jobs" && diff.kind === "changed columns" && diff.columns?.includes("start_error"),
      ),
    );
    assert.doesNotMatch(JSON.stringify(report), /hidden-default/);
    assert.equal(
      db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value,
      String(MIGRATIONS.length),
    );
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
});

test("schema diagnosis refuses missing databases without creating one", async () => {
  await using folder = tempDir();
  const home = folder.path;
  assert.throws(() => diagnoseOfflineSchema(home), /No existing database/);
  assert.deepEqual(fs.readdirSync(home), []);
});

test("doctor --schema runs offline as JSON and rejects repair combined with diagnosis", async () => {
  await using folder = tempDir();
  const home = folder.path;
  fixture(home).close();
  const args = [path.join(import.meta.dirname, "../../../terminal/src/main.ts"), "doctor", "--schema", "--json"];
  const env = { ...process.env, APX_HOME: home, APX_URL: "", APX_RELEASES: "off" };
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).differences, []);
  const refused = spawnSync(process.execPath, [...args, "--fix"], { env, encoding: "utf8", timeout: 30_000 });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /read-only/);
});
