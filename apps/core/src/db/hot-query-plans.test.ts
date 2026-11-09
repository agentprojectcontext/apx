// Reads the panel, the engine's ticks and startup run often must not walk whole tables: on a store of gigabytes each
// scan freezes the core for seconds (DECISIONS.md#d-201). Without ANALYZE statistics SQLite plans the same way on an
// empty store as on a large one, so the plans checked here are the ones a large store gets.
import assert from "node:assert/strict";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { createStore, type Store } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";

/** Tables that grow with every turn or message. */
const LARGE = ["threads", "messages", "runs", "steps", "model_log", "jobs", "outbox", "memory_episodes", "memory_work"];

type Ran = { sql: string; params: SQLInputValue[] };

/** The store, and the statements it ran (text and bound values) since the last `take()`. */
function recordingStore(db: DatabaseSync): { store: Store; take: () => Ran[] } {
  let ran: Ran[] = [];
  const recording = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (text: string) => {
          const st = target.prepare(text);
          return new Proxy(st, {
            get(s, method) {
              const value = Reflect.get(s, method, s);
              if (typeof value !== "function") return value;
              if (method === "all" || method === "get" || method === "run" || method === "iterate")
                return (...params: SQLInputValue[]) => {
                  ran.push({ sql: text, params });
                  return value.apply(s, params);
                };
              return value.bind(s);
            },
          });
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    store: createStore(recording, createBus()),
    take: () => {
      const out = ran;
      ran = [];
      return out;
    },
  };
}

/** Tables the plan reads row by row (`SCAN t`, not `SCAN t USING INDEX`), aliases resolved. */
function scannedTables(text: string, p: string): string[] {
  const alias = new Map([...text.matchAll(/"(\w+)" as "(\w+)"/g)].map((m) => [m[2], m[1]] as [string, string]));
  return [...p.matchAll(/^SCAN (\w+)(.*)$/gm)]
    .filter((m) => !m[2]?.startsWith(" USING"))
    .map((m) => alias.get(m[1] as string) ?? (m[1] as string));
}

function plan(db: DatabaseSync, q: Ran): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
    .all(...q.params)
    .map((row) => String(row.detail))
    .join("\n");
}

test("hot reads use an index on every large table, and paged lists never sort the whole table", async () => {
  const home = tempDir("apx-hot-plans-");
  const db = openDb(home.path);
  try {
    const { store, take } = recordingStore(db);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const reads: Array<[string, () => unknown, { paged?: boolean }?]> = [
      ["threads.children", () => store.threads.children("th_a")],
      ["threads.sessions", () => store.threads.sessions("th_a")],
      ["threads.descendants", () => store.threads.descendants("th_a")],
      ["threads.delegatedCounts", () => store.threads.delegatedCounts(["th_a", "th_b"])],
      ["threads.askedFrom", () => store.threads.askedFrom("th_a")],
      ["threads.unreadByAgents", () => store.threads.unreadByAgents()],
      ["threads.holding", () => store.threads.holding()],
      ["threads.list by project", () => store.threads.list({ project_id: "p_a" })],
      ["messages.waitingIn", () => store.messages.waitingIn()],
      ["messages.waitingIn thread", () => store.messages.waitingIn("th_a")],
      ["runs.list", () => store.runs.list("th_a", 20), { paged: true }],
      ["runs.usage since", () => store.runs.usage(since)],
      ["runs.usage of chats", () => store.runs.usage("", undefined, ["th_a", "th_b"])],
      ["runs.jobs", () => store.runs.jobs(12), { paged: true }],
      ["runs.completedSince", () => store.runs.completedSince(since), { paged: true }],
      ["runs.completedSince window", () => store.runs.completedSince(since, "2099-01-01T00:00:00.000Z")],
      ["runs.activeDelegations", () => store.runs.activeDelegations("th_a")],
      ["jobs.finished", () => store.jobs.finished(12), { paged: true }],
      ["channels.outbox.recent", () => store.channels.outbox.recent(20), { paged: true }],
      ["agents.active", () => store.agents.active("agent_a")],
    ];
    const failures: string[] = [];
    for (const [name, read, opts] of reads) {
      take();
      read();
      const ran = take();
      assert.ok(ran.length, `${name} ran no statement`);
      for (const q of ran) {
        const p = plan(db, q);
        const scans = scannedTables(q.sql, p).filter((t) => LARGE.includes(t));
        if (scans.length) failures.push(`${name} scans ${scans.join(", ")}:\n${p}`);
        if (opts?.paged && / limit /i.test(q.sql) && /USE TEMP B-TREE FOR ORDER BY/.test(p))
          failures.push(`${name} sorts before its limit:\n${p}`);
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    db.close();
    await home.remove();
  }
});

/** Tables that stay a handful of rows: a delete in their parent may scan them. */
const SMALL_CHILDREN = new Set([
  "agents.project_id",
  "addresses.person_id",
  "suggestions.person_id",
  "channel_held.person_id",
  "stickers.media_id",
  "flows.project_id",
  "flow_graph_events.revision",
  "flow_graph_events.event_id",
  "flow_graph_nodes.event_id",
  "flow_graph_nodes.revision",
]);

test("every foreign key into a growing table has an index, so a cascading delete never scans its children", async () => {
  const home = tempDir("apx-fk-index-");
  const db = openDb(home.path);
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL%'")
      .all()
      .map((r) => String(r.name))
      .filter((t) => !t.startsWith("sqlite_"));
    const missing: string[] = [];
    for (const table of tables) {
      const indexes = db
        .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`)
        .all(table)
        .map((r) => {
          const cols = db
            .prepare(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`)
            .all(String(r.name))
            .map((c) => String(c.name));
          const where = /\bWHERE\s+(.+)$/is.exec(String(r.sql ?? ""))?.[1]?.trim() ?? "";
          return { cols, where };
        });
      const pk = db
        .prepare(`SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`)
        .all(table)
        .map((c) => String(c.name));
      for (const fk of db.prepare(`SELECT "from" FROM pragma_foreign_key_list(?)`).all(table)) {
        const col = String(fk.from);
        const usable = (cols: string[], where: string) =>
          cols[0] === col && (!where || new RegExp(`^${col}\\s+IS\\s+NOT\\s+NULL$`, "i").test(where));
        if (pk[0] === col || indexes.some((i) => usable(i.cols, i.where))) continue;
        if (!SMALL_CHILDREN.has(`${table}.${col}`)) missing.push(`${table}.${col}`);
      }
    }
    assert.deepEqual(missing, []);
  } finally {
    db.close();
    await home.remove();
  }
});
