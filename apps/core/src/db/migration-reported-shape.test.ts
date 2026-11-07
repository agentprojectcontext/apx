import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { reconcileMigrationLineage } from "./migration-lineage.ts";
import { MIGRATIONS } from "./migrations.ts";

for (const shape of [
  "missing all earlier columns",
  "page already present",
  "Apps choice already present",
  "Apps conversion rolled back",
]) {
  test(`recovery handles the reported earlier-column gap: ${shape}, without replaying existing Apps choices`, async () => {
    const home = tempDir();
    let db = new DatabaseSync(path.join(home.path, "apx.db"));
    try {
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      for (const migration of MIGRATIONS.slice(0, 100)) db.exec(migration);
      db.exec(`INSERT INTO meta VALUES ('schema_version','105');
        INSERT INTO surfaces (id,name,title,html,version,pinned,app,created_by,updated_at)
        VALUES ('sf_widget','widget','Kept widget','<p>A widget</p>',1,1,1,'agent_kept','2026-10-01'),
        ('sf_app','app','Kept app','<meta name="apx-surface" content="app">',1,0,1,'agent_kept','2026-10-01');
        INSERT INTO threads (id,kind,title,agent_ids,created_at,updated_at)
        VALUES ('th_kept','loose','Kept chat','[]','2026-10-01','2026-10-01');
        INSERT INTO messages (id,thread_id,seq,author,parts,model,created_at)
        VALUES ('msg_kept','th_kept',1,'owner','[{"type":"text","text":"Keep me"}]','legacy/model','2026-10-01');`);
      db.exec(MIGRATIONS[104] ?? "");
      db.exec(MIGRATIONS[105] ?? "");
      if (shape === "page already present") {
        db.exec(MIGRATIONS[100] ?? "");
        db.exec("UPDATE surfaces SET page=1 WHERE id='sf_widget'");
      }
      if (shape === "Apps choice already present") {
        db.exec("ALTER TABLE surfaces ADD COLUMN in_apps INTEGER NOT NULL DEFAULT 0");
      }
      if (shape === "Apps conversion rolled back") {
        const schema = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
        const surfaces = db.prepare("SELECT * FROM surfaces ORDER BY id").all();
        db.setAuthorizer((action, table, column) =>
          action === constants.SQLITE_UPDATE && table === "meta" && column === "value"
            ? constants.SQLITE_DENY
            : constants.SQLITE_OK,
        );
        assert.throws(() => reconcileMigrationLineage(db, home.path, 105), /not authorized/);
        db.setAuthorizer(null);
        assert.deepEqual(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), schema);
        assert.deepEqual(db.prepare("SELECT * FROM surfaces ORDER BY id").all(), surfaces);
        assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, "105");
      }
      db.close();
      db = openDb(home.path);
      const widget = db.prepare("SELECT app,in_apps,page,pinned,html FROM surfaces WHERE id='sf_widget'").get();
      assert.deepEqual(
        { ...widget },
        {
          app: shape === "Apps choice already present" ? 1 : 0,
          in_apps: shape === "Apps choice already present" ? 0 : 1,
          page: shape === "page already present" ? 1 : 0,
          pinned: shape === "page already present" ? 0 : 1,
          html: "<p>A widget</p>",
        },
      );
      assert.equal(db.prepare("SELECT app FROM surfaces WHERE id='sf_app'").get()?.app, 1);
      assert.deepEqual(
        { ...db.prepare("SELECT model,model_reported,waiting FROM messages WHERE id='msg_kept'").get() },
        {
          model: "legacy/model",
          model_reported: null,
          waiting: null,
        },
      );
      assert.ok(db.prepare("SELECT queue_order,trimmed FROM runs").all());
      assert.ok(db.prepare("SELECT goal,asked FROM tasks").all());
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      const before = db.prepare("SELECT * FROM surfaces ORDER BY id").all();
      for (let restart = 0; restart < 2; restart++) {
        db.close();
        db = openDb(home.path);
        assert.deepEqual(db.prepare("SELECT * FROM surfaces ORDER BY id").all(), before);
        assert.equal(
          fs.readdirSync(path.join(home.path, "backups")).length,
          shape === "Apps conversion rolled back" ? 2 : 1,
        );
      }
    } finally {
      if (db.isOpen) db.close();
      await home.remove();
    }
  });
}
