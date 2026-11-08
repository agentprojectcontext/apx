import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { MIGRATIONS } from "./migrations.ts";

for (const fault of [
  "missing foreign key",
  "wrong foreign key action",
  "missing uniqueness",
  "extra check",
  "extra column constraint",
  "extra data-changing trigger",
]) {
  test(`recovery rejects ${fault} before backup or writes, even when existing rows pass foreign_key_check`, async () => {
    const home = tempDir();
    let db = new DatabaseSync(path.join(home.path, "apx.db"));
    try {
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      for (const migration of MIGRATIONS.slice(0, 103)) {
        let sql = migration;
        if (fault === "missing foreign key")
          sql = sql.replace("project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,", "project_id TEXT,");
        if (fault === "wrong foreign key action")
          sql = sql.replace(
            "project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,",
            "project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,",
          );
        if (fault === "missing uniqueness") sql = sql.replace(",\n    UNIQUE(thread_id, seq)", "");
        if (fault === "extra check")
          sql = sql.replace(
            "role TEXT NOT NULL DEFAULT ''",
            "role TEXT NOT NULL DEFAULT '' CHECK (length(role) < 200)",
          );
        db.exec(sql);
      }
      db.exec(MIGRATIONS[105] ?? "");
      if (fault === "extra column constraint") db.exec("ALTER TABLE tasks ADD COLUMN goal TEXT COLLATE NOCASE");
      db.exec(`INSERT INTO meta VALUES ('schema_version', '105');
        INSERT INTO projects (id, name, created_at) VALUES ('pr_kept', 'Kept project', '2026-10-01')`);
      if (fault === "extra data-changing trigger")
        db.exec(`CREATE TRIGGER change_owner_data AFTER UPDATE OF queue_order ON runs
        BEGIN UPDATE projects SET name='Changed without permission'; END;
        INSERT INTO threads (id,kind,title,agent_ids,created_at,updated_at)
        VALUES ('th_kept','loose','Kept','[]','2026-10-01','2026-10-01');
        INSERT INTO runs (id,thread_id,agent_id,state,started_at) VALUES ('run_kept','th_kept','agent_kept','done','2026-10-01');`);
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
      const before = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
      const rows = db.prepare("SELECT * FROM projects").all();
      db.close();
      assert.throws(() => openDb(home.path), /incompatible (base object|column)|unrecognized trigger/);
      db = new DatabaseSync(path.join(home.path, "apx.db"));
      assert.deepEqual(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), before);
      assert.deepEqual(db.prepare("SELECT * FROM projects").all(), rows);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "105");
      assert.equal(fs.existsSync(path.join(home.path, "backups")), false);
    } finally {
      if (db.isOpen) db.close();
      await home.remove();
    }
  });
}
