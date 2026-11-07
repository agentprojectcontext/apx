import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";
import { MIGRATIONS } from "./migrations.ts";

function fixture(home: string, version: number) {
  const db = new DatabaseSync(path.join(home, "apx.db"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const migration of MIGRATIONS.slice(0, version)) db.exec(migration);
  db.prepare("INSERT INTO meta VALUES ('schema_version', ?)").run(String(version));
  db.exec(`INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at)
    VALUES ('th_kept', 'loose', 'Kept chat', '[]', '2026-10-01', '2026-10-01');
    INSERT INTO model_log (thread_id, seq, run_id, item) VALUES ('th_kept', 1, 'run_kept', '{"text":"Kept"}');`);
  return db;
}

test("a core boots from the divergent fixture, serves task writes and a real turn, then restarts with those writes intact", async () => {
  const home = tempDir();
  const db = fixture(home.path, 103);
  db.exec(MIGRATIONS[105] ?? "");
  db.exec("UPDATE meta SET value = '105' WHERE key = 'schema_version'");
  db.close();
  let env: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    env = await startCore({ home: home.path, llm: scriptedLlm(() => say("After repair")) });
    const health = await env.client.call("system.health", {});
    assert.match(health.code_sha, /^[a-f0-9]{12,40}$/);
    const task = await env.client.call("tasks.create", { title: "After repair", goal: "Keep the result" });
    await env.client.call("tasks.update", { task: task.id, goal: "Kept after restart" });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: thread.id, text: "Check the repaired store" });
    const result = await env.settle(thread.id);
    assert.ok(
      result.messages.some((message) =>
        message.parts.some((part) => part.type === "text" && part.text === "After repair"),
      ),
    );
    await env.core.close();
    env = undefined;
    env = await startCore({ home: home.path, llm: scriptedLlm(() => say("Unused")) });
    const kept = await env.client.call("tasks.get", { task: task.id });
    assert.equal(kept.task.goal, "Kept after restart");
    const replay = await env.client.call("threads.get", { thread: thread.id });
    assert.deepEqual(replay.messages, result.messages);
    assert.equal(backups(home.path).length, 1);
  } finally {
    if (env) {
      await env.core.close();
      await env.cleanup();
    }
    await home.remove();
  }
});

test("the pre-repair copy includes committed WAL rows and is kept in a private directory", async () => {
  const home = tempDir();
  const writer = fixture(home.path, 103);
  writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
  const reader = new DatabaseSync(path.join(home.path, "apx.db"));
  reader.exec("BEGIN; SELECT * FROM model_log");
  let repaired: DatabaseSync | undefined;
  try {
    writer.exec(MIGRATIONS[105] ?? "");
    writer.exec(`UPDATE meta SET value = '105' WHERE key = 'schema_version';
      INSERT INTO model_log (thread_id, seq, run_id, item) VALUES ('th_kept', 2, 'run_kept', '{"text":"In WAL"}')`);
    const expected = rows(writer);
    writer.close();
    assert.ok(fs.statSync(path.join(home.path, "apx.db-wal")).size > 0);
    repaired = openDb(home.path);
    assert.deepEqual(rows(repaired), expected);
    const file = backups(home.path)[0];
    assert.ok(file);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      assert.deepEqual(rows(copy), expected);
      assert.equal(copy.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "105");
    } finally {
      copy.close();
    }
  } finally {
    repaired?.close();
    reader.close();
    if (writer.isOpen) writer.close();
    await home.remove();
  }
});

function rows(db: DatabaseSync) {
  return db.prepare("SELECT * FROM model_log ORDER BY rowid").all();
}

function backups(home: string): string[] {
  const dir = path.join(home, "backups");
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.startsWith("migration-"))
        .map((name) => path.join(dir, name, "apx.db"))
    : [];
}

test("version 105 with an already installed log index and missing tail columns is reconciled without losing rows", async () => {
  const home = tempDir();
  let db = fixture(home.path, 103);
  try {
    db.exec(MIGRATIONS[105] ?? "");
    db.exec("UPDATE meta SET value = '105' WHERE key = 'schema_version'");
    const expected = rows(db);
    db.close();
    db = openDb(home.path);
    assert.deepEqual(rows(db), expected);
    assert.equal(
      db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value,
      String(MIGRATIONS.length),
    );
    assert.ok(db.prepare("SELECT waiting FROM messages").all());
    assert.ok(db.prepare("SELECT queue_order, trimmed FROM runs").all());
    assert.ok(db.prepare("SELECT goal, asked FROM tasks").all());
    const copies = backups(home.path);
    assert.equal(copies.length, 1);
    const copy = new DatabaseSync(copies[0] ?? "", { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "105");
      assert.deepEqual(rows(copy), expected);
      assert.throws(() => copy.prepare("SELECT goal FROM tasks"), /no such column/);
      assert.equal(copy.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    } finally {
      copy.close();
    }
    for (let restart = 0; restart < 3; restart++) {
      db.close();
      db = openDb(home.path);
      assert.deepEqual(rows(db), expected);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      assert.equal(backups(home.path).length, 1);
    }
  } finally {
    if (db.isOpen) db.close();
    await home.remove();
  }
});
