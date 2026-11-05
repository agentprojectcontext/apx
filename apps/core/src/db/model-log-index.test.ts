import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { modelLogRepo } from "../domain/model-log.ts";
import { sql } from "../domain/sql.ts";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { MIGRATIONS } from "./migrations.ts";

test("upgrading preserves run-global log order and avoids a scan or sort for recovery", async () => {
  const home = tempDir("apx-log-index-");
  const file = path.join(home.path, "apx.db");
  let db = new DatabaseSync(file);
  try {
    const indexAt = MIGRATIONS.findIndex((m) => m.includes("CREATE INDEX model_log_run_seq"));
    const previous = indexAt < 0 ? MIGRATIONS : MIGRATIONS.slice(0, indexAt);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const migration of previous) db.exec(migration);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(previous.length));
    const thread = db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES (?, 'loose', 'Chat', '[]', '2026-10-01', '2026-10-01')",
    );
    thread.run("th_source");
    thread.run("th_copy");
    const original = modelLogRepo(sql(db));
    original.append("th_source", undefined, [{ text: "Legacy" }]);
    original.append("th_source", "run_target", [{ text: "First" }, { text: "Second" }]);
    original.append("th_source", "run_other", [{ text: "Unrelated" }]);
    original.copyInto("th_source", "th_copy");
    db.prepare("UPDATE model_log SET item = ? WHERE thread_id = 'th_copy' AND seq = 2").run(
      JSON.stringify({ text: "First in copy" }),
    );
    original.append("th_copy", "run_target", [{ text: "Only in copy" }]);
    const expected = original.forRun("run_target");
    assert.deepEqual(expected, [
      { text: "First" },
      { text: "First in copy" },
      { text: "Second" },
      { text: "Second" },
      { text: "Only in copy" },
    ]);
    const rows = db.prepare("SELECT * FROM model_log ORDER BY rowid").all();
    db.close();
    db = openDb(home.path);
    assert.deepEqual(db.prepare("SELECT * FROM model_log ORDER BY rowid").all(), rows);
    const queries = sql(db);
    const log = modelLogRepo({
      ...queries,
      all(query) {
        const compiled = query.compile();
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`).all("run_target");
        const detail = plan.map((row) => String(row.detail)).join("\n");
        assert.match(detail, /SEARCH model_log USING INDEX model_log_run_seq/);
        assert.doesNotMatch(detail, /SCAN model_log|USE TEMP B-TREE/);
        return queries.all(query);
      },
    });
    assert.deepEqual(log.forRun("run_target"), expected);
    assert.deepEqual(log.forRun("run_missing"), []);
    assert.deepEqual(log.forRun("run_other"), [{ text: "Unrelated" }, { text: "Unrelated" }]);
    log.append("th_source", "run_target", [{ text: "After upgrade" }]);
    assert.deepEqual(log.forRun("run_target"), [...expected, { text: "After upgrade" }]);
    log.dropRuns("th_copy", ["run_target"]);
    assert.deepEqual(log.forRun("run_target"), [{ text: "First" }, { text: "Second" }, { text: "After upgrade" }]);
    assert.equal(db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
    db.close();
    db = openDb(home.path);
    assert.deepEqual(modelLogRepo(sql(db)).forRun("run_target"), [
      { text: "First" },
      { text: "Second" },
      { text: "After upgrade" },
    ]);
    assert.equal(
      db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value,
      String(MIGRATIONS.length),
    );
  } finally {
    db.close();
    await home.remove();
  }
});
