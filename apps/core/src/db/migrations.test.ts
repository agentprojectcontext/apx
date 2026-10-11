import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openDb } from "./db.ts";
import { MIGRATIONS } from "./migrations.ts";

/** A database at the schema right before the migration that holds `marker`, filled by `fill`, then upgraded. */
function upgradeFrom(marker: string, fill: (db: DatabaseSync) => void) {
  const at = MIGRATIONS.findIndex((m) => m.includes(marker));
  assert.ok(at > 0, `no migration with ${marker}`);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-migrate-"));
  const old = new DatabaseSync(path.join(home, "apx.db"));
  old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const m of MIGRATIONS.slice(0, at)) old.exec(m);
  old.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(at));
  fill(old);
  old.close();
  return { db: openDb(home), cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("the copies an import made again go, unless someone touched them; their chats go with them", () => {
  const { db, cleanup } = upgradeFrom("CREATE TEMP TABLE import_dups", (db) => {
    const thread = db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, project_id, created_at, updated_at) VALUES (?, 'task', ?, '[]', ?, ?, ?)",
    );
    const task = db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, status, thread_id, due_at, kind, created_by, created_at,
         updated_at, activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?, ?)`,
    );
    const event = db.prepare("INSERT INTO task_events (task_id, at, op, by) VALUES (?, ?, ?, 'owner')");
    db.prepare("INSERT INTO projects (id, name, created_at) VALUES ('p_acme', 'Acme', '2026-09-01')").run();
    const add = (
      id: string,
      title: string,
      at: string,
      o: { project?: string; status?: string; kind?: string } = {},
    ) => {
      thread.run(`th_${id}`, title, o.project ?? null, at, at);
      task.run(id, o.project ?? null, title, "", o.status ?? "todo", `th_${id}`, null, o.kind ?? "task", at, at, at);
      event.run(id, at, "create");
    };
    // Three imports of the same task: the oldest stays, the two later copies go.
    add("a1", "Send the Northwind invoice", "2026-09-01T10:00:00Z");
    add("a2", "Send the Northwind invoice", "2026-09-02T10:00:00Z");
    add("a3", "Send the Northwind invoice", "2026-09-03T10:00:00Z");
    // A copy the owner commented on, one an agent talked in, and one whose status moved stay.
    add("b1", "Renew the Acme domain", "2026-09-01T10:00:00Z");
    add("b2", "Renew the Acme domain", "2026-09-02T10:00:00Z");
    event.run("b2", "2026-09-02T11:00:00Z", "comment");
    add("b3", "Renew the Acme domain", "2026-09-03T10:00:00Z");
    db.prepare(
      "INSERT INTO messages (id, thread_id, seq, author, parts, created_at) VALUES ('m1', 'th_b3', 1, '{}', '[]', ?)",
    ).run("2026-09-03T11:00:00Z");
    add("b4", "Renew the Acme domain", "2026-09-04T10:00:00Z", { status: "doing" });
    // Same title in another project, or as another kind, is not a copy.
    add("c1", "Send the Northwind invoice", "2026-09-02T10:00:00Z", { project: "p_acme" });
    add("c2", "Send the Northwind invoice", "2026-09-02T10:00:00Z", { kind: "commitment" });
    // What pointed at a removed copy goes too (a notice) or loses the link (a note).
    db.prepare(
      "INSERT INTO notifications (id, kind, title, thread_id, ref, created_at) VALUES ('n1', 'task', 'x', 'th_a2', 'a2', ?)",
    ).run("2026-09-02T10:00:00Z");
    db.prepare(
      `INSERT INTO memories (id, scope, text, source, thread_id, created_at, updated_at)
       VALUES ('mem1', 'global', 'Northwind pays late', 'owner', 'th_a3', ?, ?)`,
    ).run("2026-09-03T10:00:00Z", "2026-09-03T10:00:00Z");
  });
  try {
    const ids = (sql: string) => (db.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id).sort();
    assert.deepEqual(ids("SELECT id FROM tasks"), ["a1", "b1", "b2", "b3", "b4", "c1", "c2"]);
    assert.deepEqual(ids("SELECT id FROM threads"), ["th_a1", "th_b1", "th_b2", "th_b3", "th_b4", "th_c1", "th_c2"]);
    assert.deepEqual(ids("SELECT DISTINCT task_id AS id FROM task_events WHERE task_id LIKE 'a%'"), ["a1"]);
    assert.deepEqual(ids("SELECT id FROM notifications"), []);
    assert.equal(
      (db.prepare("SELECT thread_id FROM memories WHERE id = 'mem1'").get() as { thread_id: null }).thread_id,
      null,
    );
  } finally {
    db.close();
    cleanup();
  }
});

test("answers sent before outbox items named their message get linked and show sent or not sent", () => {
  const { db, cleanup } = upgradeFrom("Answers sent on a channel before their message", (db) => {
    db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES ('th_c', 'channel', 'Ana', '[]', ?, ?)",
    ).run("2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z");
    const msg = db.prepare(
      "INSERT INTO messages (id, thread_id, seq, author, parts, created_at) VALUES (?, 'th_c', ?, ?, ?, ?)",
    );
    const agent = JSON.stringify({ kind: "agent", id: "roby" });
    msg.run(
      "m_hi",
      1,
      agent,
      JSON.stringify([{ type: "text", text: "Hi Ana, the order ships on Friday." }]),
      "2026-09-01T10:00:00Z",
    );
    msg.run(
      "m_them",
      2,
      JSON.stringify({ kind: "person", id: "p", name: "Ana" }),
      JSON.stringify([{ type: "text", text: "Thanks" }]),
      "2026-09-01T10:01:00Z",
    );
    // The answer's words come after a tool call.
    msg.run(
      "m_tool",
      3,
      agent,
      JSON.stringify([
        { type: "tool", call_id: "c" },
        { type: "text", text: "Looked it up: Friday at noon." },
      ]),
      "2026-09-01T10:02:00Z",
    );
    msg.run(
      "m_lost",
      4,
      agent,
      JSON.stringify([{ type: "text", text: "This one never went out." }]),
      "2026-09-01T10:03:00Z",
    );
    const out = db.prepare(
      "INSERT INTO outbox (id, channel, conversation, thread_id, kind, body, state, next_at, created_at, updated_at) VALUES (?, 'whatsapp', 'ana', 'th_c', 'reply', ?, ?, ?, ?, ?)",
    );
    const at = (m: number) => `2026-09-01T10:0${m}:30Z`;
    out.run("o1", JSON.stringify({ text: "Hi Ana, the order ships on Friday." }), "sent", at(0), at(0), at(0));
    out.run("o2", JSON.stringify({ text: "Looked it up: Friday at noon." }), "sent", at(2), at(2), at(2));
    out.run("o3", JSON.stringify({ text: "This one never went out." }), "failed", at(3), at(3), at(3));
  });
  try {
    const rows = db.prepare("SELECT id, delivery FROM messages ORDER BY seq").all();
    assert.deepEqual(
      rows.map((r) => [r.id, r.delivery]),
      [
        ["m_hi", "sent"],
        ["m_them", null],
        ["m_tool", "sent"],
        ["m_lost", "failed"],
      ],
    );
  } finally {
    cleanup();
  }
});

test("Codex runs stored with their session's running total get each turn's share back", () => {
  const { db, cleanup } = upgradeFrom("CREATE TEMP TABLE codex_runs", (db) => {
    const thread = db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES (?, 'code', 'Chat', '[]', ?, ?)",
    );
    const run = db.prepare(
      "INSERT INTO runs (id, thread_id, agent_id, state, started_at, created_at, harness, usage) VALUES (?, ?, 'roby', 'completed', ?, ?, ?, ?)",
    );
    const at = (n: number) => `2026-10-0${n}T10:00:00Z`;
    thread.run("th_a", at(1), at(1));
    run.run("r1", "th_a", at(1), at(1), "codex", JSON.stringify({ input: 500, output: 20 }));
    run.run("r2", "th_a", at(2), at(2), "codex", JSON.stringify({ input: 560, output: 25 }));
    run.run("r3", "th_a", at(3), at(3), "native", JSON.stringify({ input: 9, output: 1 }));
    db.prepare(
      "INSERT INTO harness_sessions (thread_id, harness, session_id, updated_at) VALUES ('th_a', 'codex', 's1', ?)",
    ).run(at(2));
  });
  try {
    const usage = (id: string) =>
      JSON.parse(String(db.prepare("SELECT usage FROM runs WHERE id = ?").get(id)?.usage)) as unknown;
    // The first run of the chat keeps its figure (nothing before it to subtract), later ones their own share.
    assert.deepEqual(usage("r1"), { input: 500, output: 20 });
    assert.deepEqual(usage("r2"), { input: 60, output: 5 });
    assert.deepEqual(usage("r3"), { input: 9, output: 1 });
    // The session's total is where the next turn's share is taken from.
    const total = db.prepare("SELECT usage FROM harness_sessions WHERE thread_id = 'th_a'").get()?.usage;
    assert.deepEqual(JSON.parse(String(total)), { input: 560, output: 25 });
  } finally {
    db.close();
    cleanup();
  }
});
