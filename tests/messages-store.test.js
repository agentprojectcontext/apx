import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  appendMessageToFs,
  parseDayFile,
  rebuildMessagesFromFs,
  appendMessage,
} from "../src/core/messages-store.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      session_id INTEGER,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL,
      external_id TEXT,
      author TEXT,
      body TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      ts TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO agents (slug) VALUES (?)").run("sofia");
  return db;
}

test("appendMessageToFs writes JSONL — one record per line", () => {
  const root = makeTempProject({ agents: [{ slug: "sofia", role: "Support" }] });
  try {
    appendMessageToFs({
      projectRoot: root,
      channel: "telegram",
      direction: "in",
      author: "@user",
      body: "hola",
      ts: "2026-05-08T10:00:00Z",
    });
    appendMessageToFs({
      projectRoot: root,
      channel: "telegram",
      direction: "out",
      author: "apx",
      body: "hi back",
      ts: "2026-05-08T10:00:05Z",
      meta: { chat_id: 1, tools_called: [{ tool: "list_agents", args: {} }] },
    });
    const file = path.join(root, "messages", "2026-05-08.jsonl");
    const text = fs.readFileSync(file, "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    const r1 = JSON.parse(lines[0]);
    const r2 = JSON.parse(lines[1]);
    assert.equal(r1.body, "hola");
    assert.equal(r1.direction, "in");
    assert.equal(r2.body, "hi back");
    assert.deepEqual(r2.meta.tools_called, [{ tool: "list_agents", args: {} }]);
  } finally {
    cleanupTempProject(root);
  }
});

test("parseDayJsonl reads JSONL", async () => {
  const { parseDayJsonl } = await import("../src/core/messages-store.js");
  const text = [
    JSON.stringify({ ts: "2026-05-08T10:00:00Z", channel: "telegram", direction: "in", author: "@a", body: "hola", meta: { chat_id: 1 } }),
    JSON.stringify({ ts: "2026-05-08T10:00:01Z", channel: "telegram", direction: "out", author: "apx", body: "hi", meta: {} }),
    "", // blank line should be ignored
    "not-json", // garbage line should be skipped
  ].join("\n");
  const rows = parseDayJsonl(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].body, "hola");
  assert.equal(rows[0].meta.chat_id, 1);
  assert.equal(rows[1].body, "hi");
});

test("parseDayFile (legacy md) still works for backward compat", () => {
  const text = `# Messages — 2026-05-08

## 2026-05-08T10:00:00Z  telegram  in  @user
hola
<!-- meta: {"chat_id":99} -->
`;
  const rows = parseDayFile(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, "hola");
  assert.equal(rows[0].meta.chat_id, 99);
});

test("getRecentTelegramTurns — pulls per chat_id in chronological order", async () => {
  const { getRecentTelegramTurns } = await import("../src/core/messages-store.js");
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  const db = freshDb();
  try {
    const append = (await import("../src/core/messages-store.js")).appendMessage;
    // Two chats interleaved
    append({ projectRoot: root, db, channel: "telegram", direction: "in",  author: "@a", body: "hola A1", ts: "2026-05-08T10:00:00Z", meta: { chat_id: 1 } });
    append({ projectRoot: root, db, channel: "telegram", direction: "out", author: "apx", body: "respuesta A1", ts: "2026-05-08T10:00:01Z", meta: { chat_id: 1 } });
    append({ projectRoot: root, db, channel: "telegram", direction: "in",  author: "@b", body: "hola B1", ts: "2026-05-08T10:00:02Z", meta: { chat_id: 2 } });
    append({ projectRoot: root, db, channel: "telegram", direction: "in",  author: "@a", body: "y A2?", ts: "2026-05-08T10:00:03Z", meta: { chat_id: 1 } });

    const aTurns = getRecentTelegramTurns(db, { chat_id: 1, limit: 10, max_age_hours: 999_999 });
    assert.equal(aTurns.length, 3);
    assert.deepEqual(aTurns.map((t) => t.role), ["user", "assistant", "user"]);
    assert.deepEqual(aTurns.map((t) => t.content), ["hola A1", "respuesta A1", "y A2?"]);

    const bTurns = getRecentTelegramTurns(db, { chat_id: 2, limit: 10, max_age_hours: 999_999 });
    assert.equal(bTurns.length, 1);
    assert.equal(bTurns[0].content, "hola B1");
  } finally {
    db.close();
    cleanupTempProject(root);
  }
});

test("getRecentTelegramTurns — respects max_age_hours and limit", async () => {
  const { getRecentTelegramTurns, appendMessage } = await import("../src/core/messages-store.js");
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  const db = freshDb();
  try {
    // Old message, just over 24h ago
    const oldTs = new Date(Date.now() - 25 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    appendMessage({ projectRoot: root, db, channel: "telegram", direction: "in", author: "@a", body: "old", ts: oldTs, meta: { chat_id: 1 } });
    // Recent message
    appendMessage({ projectRoot: root, db, channel: "telegram", direction: "in", author: "@a", body: "new", meta: { chat_id: 1 } });

    const turns = getRecentTelegramTurns(db, { chat_id: 1, limit: 10, max_age_hours: 24 });
    assert.equal(turns.length, 1);
    assert.equal(turns[0].content, "new");
  } finally {
    db.close();
    cleanupTempProject(root);
  }
});

test("getRecentTelegramTurns — sanitizes assistant turns with factual data", async () => {
  const { getRecentTelegramTurns, appendMessage } = await import("../src/core/messages-store.js");
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  const db = freshDb();
  try {
    appendMessage({ projectRoot: root, db, channel: "telegram", direction: "in",  author: "@a", body: "qué agentes hay?", meta: { chat_id: 1 }, ts: "2026-05-08T10:00:00Z" });
    appendMessage({ projectRoot: root, db, channel: "telegram", direction: "out", author: "apx", body: "Hay 2 agentes:\n- sofia: claude-haiku-4-5\n- martin: claude-sonnet-4-6", meta: { chat_id: 1 }, ts: "2026-05-08T10:00:01Z" });
    const turns = getRecentTelegramTurns(db, { chat_id: 1, limit: 10, max_age_hours: 999_999 });
    assert.equal(turns[0].content, "qué agentes hay?");
    // assistant turn was redacted because it contained model ids + bullet list
    assert.match(turns[1].content, /Re-call the tool/);
    assert.doesNotMatch(turns[1].content, /claude-haiku/);
  } finally {
    db.close();
    cleanupTempProject(root);
  }
});

test("getRecentTelegramTurns — keeps short conversational turns intact", async () => {
  const { getRecentTelegramTurns, appendMessage } = await import("../src/core/messages-store.js");
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  const db = freshDb();
  try {
    appendMessage({ projectRoot: root, db, channel: "telegram", direction: "in",  author: "@a", body: "hola",                meta: { chat_id: 1 }, ts: "2026-05-08T10:00:00Z" });
    appendMessage({ projectRoot: root, db, channel: "telegram", direction: "out", author: "apx", body: "Hola, ¿cómo estás?", meta: { chat_id: 1 }, ts: "2026-05-08T10:00:01Z" });
    const turns = getRecentTelegramTurns(db, { chat_id: 1, limit: 10, max_age_hours: 999_999 });
    assert.equal(turns[0].content, "hola");
    assert.equal(turns[1].content, "Hola, ¿cómo estás?");
  } finally {
    db.close();
    cleanupTempProject(root);
  }
});

test("getRecentTelegramTurns — empty when no chat_id", async () => {
  const { getRecentTelegramTurns } = await import("../src/core/messages-store.js");
  const db = freshDb();
  try {
    assert.deepEqual(getRecentTelegramTurns(db, { chat_id: null }), []);
    assert.deepEqual(getRecentTelegramTurns(db, {}), []);
  } finally {
    db.close();
  }
});

test("rebuildMessagesFromFs reads BOTH .jsonl and .md (legacy) and merges by ts", async () => {
  const { rebuildMessagesFromFs, appendMessage } = await import("../src/core/messages-store.js");
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  const db = freshDb();
  try {
    // Write a legacy .md by hand
    const dir = path.join(root, "messages");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "2026-05-07.md"),
      `# Messages — 2026-05-07\n\n## 2026-05-07T10:00:00Z  telegram  in  @old\nlegacy\n<!-- meta: {"chat_id":1} -->\n`
    );
    // Write modern .jsonl via appendMessage
    appendMessage({
      projectRoot: root, db,
      channel: "telegram", direction: "in", author: "@new", body: "moderno",
      ts: "2026-05-08T10:00:00Z", meta: { chat_id: 1 },
    });

    // Wipe SQL, rebuild
    db.exec("DELETE FROM messages");
    const r = rebuildMessagesFromFs(db, root);
    assert.equal(r.count, 2, "merged legacy + modern");

    const bodies = db
      .prepare("SELECT body FROM messages ORDER BY ts")
      .all()
      .map((r) => r.body);
    assert.deepEqual(bodies, ["legacy", "moderno"]);
  } finally {
    db.close();
    cleanupTempProject(root);
  }
});

test("appendMessage + rebuildMessagesFromFs — wipe SQL and replay survives", () => {
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  const db = freshDb();
  try {
    // Write 3 messages through the public API
    for (let i = 0; i < 3; i++) {
      appendMessage({
        projectRoot: root,
        db,
        channel: "engine",
        direction: i % 2 === 0 ? "in" : "out",
        author: i % 2 === 0 ? "user" : "sofia",
        body: `msg ${i}`,
        ts: `2026-05-08T10:00:0${i}Z`,
        agent_slug: "sofia",
      });
    }
    let cnt = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
    assert.equal(cnt, 3, "messages went to SQL");

    // Wipe SQL cache, replay from FS
    db.exec("DELETE FROM messages");
    cnt = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
    assert.equal(cnt, 0);

    const result = rebuildMessagesFromFs(db, root);
    assert.equal(result.count, 3);
    cnt = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
    assert.equal(cnt, 3, "messages survived a SQL wipe via FS replay");

    // Verify body content was preserved
    const bodies = db.prepare("SELECT body FROM messages ORDER BY ts").all().map((r) => r.body);
    assert.deepEqual(bodies, ["msg 0", "msg 1", "msg 2"]);
  } finally {
    db.close();
    cleanupTempProject(root);
  }
});
