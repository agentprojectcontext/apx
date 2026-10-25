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

test("legacy forks retain their source family and earliest inherited run boundary after upgrading", () => {
  const { db, cleanup } = upgradeFrom("ALTER TABLE memories ADD COLUMN revision", (db) => {
    const thread = db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, context, created_at, updated_at) VALUES (?, 'loose', 'Chat', '[]', ?, ?, ?)",
    );
    thread.run("th_root", '{"kept":"root"}', "2026-10-01", "2026-10-01");
    thread.run("th_fork", '{"kept":"fork"}', "2026-10-03", "2026-10-03");
    thread.run("th_nested", "{}", "2026-10-05", "2026-10-05");
    thread.run("th_other", "{}", "2026-10-06", "2026-10-06");
    const run = db.prepare(
      "INSERT INTO runs (id, thread_id, agent_id, state, started_at, created_at) VALUES (?, ?, 'roby', 'completed', ?, ?)",
    );
    run.run("run_old", "th_root", "2026-10-02", "2026-10-02");
    run.run("run_later", "th_fork", "2026-10-04", "2026-10-04");
    const log = db.prepare("INSERT INTO model_log (thread_id, seq, run_id, item) VALUES (?, ?, ?, '{}')");
    log.run("th_root", 1, "run_old");
    log.run("th_fork", 1, "run_old");
    log.run("th_fork", 2, "run_later");
    log.run("th_nested", 1, "run_old");
    log.run("th_nested", 2, "run_later");
    db.prepare(
      "INSERT INTO memories (id, scope, text, source, created_at, updated_at) VALUES ('mem_old', 'global', 'Keep invoices.', 'owner', '2026-10-01', '2026-10-01')",
    ).run();
  });
  try {
    const context = (id: string) =>
      JSON.parse(String(db.prepare("SELECT context FROM threads WHERE id = ?").get(id)?.context ?? "null"));
    assert.deepEqual(context("th_root"), { kept: "root", memory_family: "th_root" });
    assert.deepEqual(context("th_fork"), { kept: "fork", memory_family: "th_root", memory_cutoff: "2026-10-02" });
    assert.deepEqual(context("th_nested"), { memory_family: "th_root", memory_cutoff: "2026-10-02" });
    assert.deepEqual(context("th_other"), {});
    assert.equal(db.prepare("SELECT revision FROM memories WHERE id = 'mem_old'").get()?.revision, 1);
  } finally {
    db.close();
    cleanup();
  }
});

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
    db.close();
    cleanup();
  }
});

test("Home's past messages learn the channel they came on or went out on; what was said in the app has none", () => {
  const { db, cleanup } = upgradeFrom("ALTER TABLE messages ADD COLUMN via", (db) => {
    db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES ('home', 'loose', 'Home', '[]', ?, ?)",
    ).run("2026-10-01", "2026-10-01");
    const msg = db.prepare(
      "INSERT INTO messages (id, thread_id, seq, author, parts, created_at) VALUES (?, 'home', ?, ?, '[]', '2026-10-01')",
    );
    const user = JSON.stringify({ kind: "user" });
    const agent = JSON.stringify({ kind: "agent", id: "roby" });
    msg.run("m_wa", 1, user);
    msg.run("m_wa_answer", 2, agent);
    msg.run("m_tg", 3, user);
    msg.run("m_app", 4, user);
    msg.run("m_app_answer", 5, agent);
    msg.run("m_claimed", 6, JSON.stringify({ kind: "person", id: "p", name: "Owner?", channel: "sms" }));
    const run = db.prepare(
      "INSERT INTO runs (id, thread_id, agent_id, state, started_at, created_at, input) VALUES (?, 'home', 'roby', 'completed', '2026-10-01', '2026-10-01', ?)",
    );
    const origin = (o: object) => JSON.stringify({ text: "", origin: o });
    run.run("r_wa", origin({ kind: "channel", channel: "whatsapp", role: "owner", message_id: "m_wa" }));
    run.run("r_tg", origin({ kind: "channel", channel: "tg", role: "owner", message_id: "m_tg" }));
    run.run("r_app", origin({ kind: "user", message_id: "m_app" }));
    db.prepare(
      "INSERT INTO outbox (id, channel, conversation, thread_id, kind, body, state, next_at, created_at, updated_at, message_id) VALUES ('o1', 'whatsapp', 'me', 'home', 'reply', '{}', 'sent', '2026-10-01', '2026-10-01', '2026-10-01', 'm_wa_answer')",
    ).run();
  });
  try {
    const rows = db.prepare("SELECT id, via FROM messages ORDER BY seq").all();
    assert.deepEqual(
      rows.map((r) => [r.id, r.via]),
      [
        ["m_wa", "whatsapp"],
        ["m_wa_answer", "whatsapp"],
        ["m_tg", "tg"],
        ["m_app", null],
        ["m_app_answer", null],
        ["m_claimed", "sms"],
      ],
    );
  } finally {
    db.close();
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

test("in a room's chat, the owner's words the room received become direct; their words from the app do not", () => {
  const { db, cleanup } = upgradeFrom("$.direct', json('true')", (db) => {
    const thread = db.prepare(
      `INSERT INTO threads (id, kind, title, agent_ids, channel, conversation, context, created_at, updated_at)
         VALUES (?, 'channel', ?, '[]', 'discord', ?, ?, '2026-10-01', '2026-10-01')`,
    );
    thread.run("th_room", "#help", "8002", JSON.stringify({ room: { name: "help" } }));
    thread.run("th_ana", "Ana", "222", "{}");
    const inbox = db.prepare(
      `INSERT INTO channel_inbox (id, channel, external_id, conversation, sender, payload, state, created_at)
         VALUES (?, 'discord', ?, ?, '111', ?, 'done', '2026-10-01')`,
    );
    inbox.run("in_1", "e1", "8002", JSON.stringify({ text: "the beta is out" }));
    inbox.run("in_2", "e2", "222", JSON.stringify({ text: "see you later" }));
    const msg = db.prepare(
      "INSERT INTO messages (id, thread_id, seq, author, parts, created_at) VALUES (?, ?, ?, ?, ?, '2026-10-01')",
    );
    const said = (text: string) => JSON.stringify([{ type: "text", text }]);
    msg.run("m_room", "th_room", 1, '{"kind":"user"}', said("the beta is out"));
    msg.run("m_app", "th_room", 2, '{"kind":"user"}', said("thank Ana for the issues"));
    msg.run("m_dm", "th_ana", 1, '{"kind":"user"}', said("see you later"));
  });
  const author = (id: string) =>
    JSON.parse((db.prepare("SELECT author FROM messages WHERE id = ?").get(id) as { author: string }).author);
  assert.deepEqual(author("m_room"), { kind: "user", direct: true });
  assert.deepEqual(author("m_app"), { kind: "user" });
  assert.deepEqual(author("m_dm"), { kind: "user" }, "only rooms");
  db.close();
  cleanup();
});

test("unattended limits saved at the former defaults follow the new ones; limits the owner chose stay", () => {
  const limitsAfter = (saved: object) => {
    const { db, cleanup } = upgradeFrom("setting:agent_limits", (db) => {
      db.prepare("INSERT INTO meta (key, value) VALUES ('setting:agent_limits', ?)").run(JSON.stringify(saved));
    });
    try {
      return JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key = 'setting:agent_limits'").get()?.value));
    } finally {
      db.close();
      cleanup();
    }
  };
  const scout = { scout: { runs: 4 } };
  assert.deepEqual(limitsAfter({ runs: 16, tokens: 600_000, agents: scout }), { agents: scout });
  assert.deepEqual(limitsAfter({ runs: 40, tokens: 600_000 }), { runs: 40 });
  assert.deepEqual(limitsAfter({ runs: 16, tokens: 0 }), { tokens: 0 });
});

test("stored modes take the five modes' names: ask is manual, standard and edits are auto, total stays", () => {
  const { db, cleanup } = upgradeFrom("The five permission modes", (db) => {
    const project = db.prepare("INSERT INTO projects (id, name, created_at, autonomy) VALUES (?, ?, '2026-10-01', ?)");
    const rows: Array<[string, string | null]> = [
      ["p_ask", "ask"],
      ["p_std", "standard"],
      ["p_edits", "edits"],
      ["p_total", "total"],
      ["p_none", null],
    ];
    for (const [id, a] of rows) project.run(id, id, a);
    db.prepare("INSERT INTO meta (key, value) VALUES ('setting:base_project', ?)").run(
      JSON.stringify({ name: "Home", autonomy: "ask" }),
    );
    const agent = db.prepare(
      "INSERT INTO agents (id, name, kind, created_at, extra) VALUES (?, ?, 'agent', '2026-10-01', ?)",
    );
    agent.run("a_ask", "Ann", JSON.stringify({ autonomy: "ask", tools: ["shell"] }));
    agent.run("a_edits", "Bo", JSON.stringify({ autonomy: "edits" }));
    agent.run("a_none", "Cy", null);
  });
  try {
    const rows = db.prepare("SELECT id, autonomy FROM projects ORDER BY id").all() as {
      id: string;
      autonomy: string | null;
    }[];
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.autonomy])), {
      p_ask: "manual",
      p_edits: "auto",
      p_none: null,
      p_std: "auto",
      p_total: "total",
    });
    const base = JSON.parse(
      String(db.prepare("SELECT value FROM meta WHERE key = 'setting:base_project'").get()?.value),
    );
    assert.deepEqual(base, { name: "Home", autonomy: "manual" });
    const extra = (id: string) =>
      (db.prepare("SELECT extra FROM agents WHERE id = ?").get(id) as { extra: string | null }).extra;
    assert.deepEqual(JSON.parse(extra("a_ask") ?? ""), { autonomy: "manual", tools: ["shell"] });
    assert.deepEqual(JSON.parse(extra("a_edits") ?? ""), { autonomy: "auto" });
    assert.equal(extra("a_none"), null);
  } finally {
    db.close();
    cleanup();
  }
});

test("a Home left on the computer comes back to the Mac; other chats on it stay", () => {
  const { db, cleanup } = upgradeFrom("WHERE key = 'setting:computer_chats'", (db) => {
    const thread = db.prepare(
      "INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES (?, ?, 'Chat', '[]', '2026-10-24', '2026-10-24')",
    );
    thread.run("home", "home");
    thread.run("th_shop", "loose");
    db.prepare("INSERT INTO meta (key, value) VALUES ('setting:computer_chats', ?)").run('["home","th_shop"]');
  });
  try {
    const chats = db.prepare("SELECT value FROM meta WHERE key = 'setting:computer_chats'").get()?.value;
    assert.deepEqual(JSON.parse(String(chats)), ["th_shop"]);
  } finally {
    db.close();
    cleanup();
  }
});
