import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type CoreEvent, Message } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { MIGRATIONS } from "../db/migrations.ts";
import { tempDir } from "../testkit/platform.ts";
import { createStore } from "./store.ts";

const author = { kind: "agent", id: "agent_test" } as const;

test("upgrading stored model labels leaves provenance unknown, including copied history", () => {
  const home = tempDir("apx-message-upgrade-");
  const old = new DatabaseSync(path.join(home.path, "apx.db"));
  const at = MIGRATIONS.findIndex((m) => m.includes("ALTER TABLE messages ADD COLUMN model_reported"));
  assert.ok(at > 0);
  try {
    old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const migration of MIGRATIONS.slice(0, at)) old.exec(migration);
    old.prepare("INSERT INTO meta VALUES ('schema_version', ?)").run(String(at));
    old
      .prepare(
        "INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES ('th_legacy', 'loose', 'Chat', '[]', '2026-10-01', '2026-10-01')",
      )
      .run();
    const insert = old.prepare(
      "INSERT INTO messages (id, thread_id, seq, author, parts, model, created_at) VALUES (?, 'th_legacy', ?, ?, '[]', ?, '2026-10-01')",
    );
    insert.run("msg_claude", 1, JSON.stringify(author), "requested-claude");
    insert.run("msg_codex", 2, JSON.stringify(author), "requested-codex");
  } finally {
    old.close();
  }
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    const messages = store.messages.list("th_legacy");
    assert.deepEqual(
      messages.map((m) => [m.model, m.model_reported]),
      [
        ["requested-claude", undefined],
        ["requested-codex", undefined],
      ],
    );
    assert.ok(messages.every((m) => !Object.hasOwn(m, "model_reported")));
    assert.deepEqual(
      db
        .prepare("SELECT model_reported FROM messages ORDER BY seq")
        .all()
        .map((r) => r.model_reported),
      [null, null],
    );
    const fork = store.threads.create({ kind: "loose", title: "Fork", agent_ids: [] });
    store.messages.copyInto(fork.id, messages);
    assert.deepEqual(
      store.messages.list(fork.id).map((m) => [m.model, m.model_reported]),
      messages.map((m) => [m.model, m.model_reported]),
    );
    assert.equal(Message.parse(messages[0]).model_reported, undefined);
  } finally {
    db.close();
    home.remove();
  }
});

test("model provenance survives add, update, events, reopen and fork without conflating false with unknown", () => {
  const home = tempDir("apx-message-provenance-");
  let db = openDb(home.path);
  try {
    const bus = createBus();
    const events: CoreEvent[] = [];
    bus.on((event) => events.push(event));
    const store = createStore(db, bus);
    const thread = store.threads.create({ kind: "loose", title: "Chat", agent_ids: [] });
    const messages = [true, false, undefined].map((reported) =>
      store.messages.add({
        thread_id: thread.id,
        author,
        parts: [{ type: "text", text: "Model provenance" }],
        model: "example-model",
        ...(reported === undefined ? {} : { model_reported: reported }),
      }),
    );
    assert.deepEqual(
      messages.map((m) => m.model_reported),
      [true, false, undefined],
    );
    assert.deepEqual(
      events.flatMap((e) => (e.type === "message.created" ? [e.message.model_reported] : [])),
      [true, false, undefined],
    );
    assert.deepEqual(
      db
        .prepare("SELECT model_reported FROM messages ORDER BY seq")
        .all()
        .map((r) => r.model_reported),
      [1, 0, null],
    );
    for (const message of messages) assert.equal(Message.parse(message).model_reported, message.model_reported);
    const first = messages[0];
    assert.ok(first);
    const changed = store.messages.update({ ...first, model: "other-model", model_reported: false });
    assert.equal(changed.model_reported, false);
    assert.equal(store.messages.get(first.id)?.model_reported, false);
    store.messages.update({ ...changed, model_reported: true });
    assert.equal(store.messages.get(first.id)?.model_reported, true);
    const last = events.at(-1);
    assert.equal(last?.type === "message.updated" ? last.message.model_reported : undefined, true);
    const fork = store.threads.create({ kind: "loose", title: "Fork", agent_ids: [] });
    store.messages.copyInto(fork.id, store.messages.list(thread.id));
    db.close();
    db = openDb(home.path);
    const reopened = createStore(db, createBus());
    for (const id of [thread.id, fork.id]) {
      assert.deepEqual(
        reopened.messages.list(id).map((m) => [m.model, m.model_reported]),
        [
          ["other-model", true],
          ["example-model", false],
          ["example-model", undefined],
        ],
      );
    }
    const { model_reported: _reported, ...unknown } = changed;
    reopened.messages.update(unknown);
    assert.equal(reopened.messages.get(first.id)?.model_reported, undefined);
    assert.equal(db.prepare("SELECT model_reported FROM messages WHERE id = ?").get(first.id)?.model_reported, null);
  } finally {
    db.close();
    home.remove();
  }
});
