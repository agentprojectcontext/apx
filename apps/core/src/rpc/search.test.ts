import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { MIGRATIONS } from "../db/migrations.ts";
import { createStore } from "../domain/store.ts";
import { snippetOf } from "../domain/threads.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((_req, { said }) => say(`Anotado: ${said.slice(-40)}`));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const search = (query: string) => env.client.call("threads.search", { query });

test("a message is found by its words, accents and case aside, and by the start of a word", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "Pagá la factura de Northwind del miércoles" });
  await env.settle(t.id);
  const { hits } = await search("FACT miercoles");
  const mine = hits.find((h) => h.author.kind === "user");
  assert.equal(mine?.thread_id, t.id);
  assert.match(mine?.snippet ?? "", /factura de Northwind/);
  // Every word must be there.
  assert.equal((await search("factura Acme")).hits.length, 0);
  // The agent's answer is indexed once it is written (it streams in as updates).
  assert.ok((await search("anotado")).hits.some((h) => h.author.kind === "agent" && h.thread_id === t.id));
});

test("operators typed in the box are words, not syntax", async () => {
  assert.deepEqual((await search('"* OR NEAR(')).hits, []);
  assert.deepEqual((await search("-- )")).hits, []);
});

test("a deleted chat's messages leave the index", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "zanahoria única" });
  await env.settle(t.id);
  assert.ok((await search("zanahoria")).hits.length > 0);
  // Nothing in the app deletes a chat yet: a second connection does, as a future method would.
  const db = new DatabaseSync(path.join(env.home, "apx.db"));
  db.exec("PRAGMA foreign_keys = ON");
  db.prepare("DELETE FROM threads WHERE id = ?").run(t.id);
  db.close();
  assert.equal((await search("zanahoria")).hits.length, 0);
});

test("an install from before the index gets its old messages indexed when it upgrades", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-search-"));
  try {
    const old = new DatabaseSync(path.join(home, "apx.db"));
    old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const m of MIGRATIONS.slice(0, -1)) old.exec(m);
    old.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(MIGRATIONS.length - 1));
    const at = new Date().toISOString();
    old
      .prepare("INSERT INTO threads (id, kind, title, agent_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("t_old", "loose", "Old", "[]", at, at);
    old
      .prepare("INSERT INTO messages (id, thread_id, seq, author, parts, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("m_old", "t_old", 1, '{"kind":"user"}', '[{"type":"text","text":"el presupuesto de Acme"}]', at);
    old.close();
    const db = openDb(home);
    const hits = createStore(db, createBus()).messages.search("presupuesto");
    db.close();
    assert.deepEqual(
      hits.map((h) => h.message.id),
      ["m_old"],
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a snippet is cut around the first word searched for", () => {
  const long = `${"palabra ".repeat(40)}la clave está acá ${"relleno ".repeat(40)}`;
  const s = snippetOf(long, "clave");
  assert.match(s, /^….*la clave está acá.*…$/);
  assert.equal(snippetOf("corto", "nada"), "corto");
});
