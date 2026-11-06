import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb, storeSize } from "../db/db.ts";
import { createStore, type Store } from "../domain/store.ts";
import { toInput } from "../providers/chatgpt-responses.ts";
import type { ChatItem } from "../providers/types.ts";
import { tempDir } from "../testkit/platform.ts";
import { HISTORY_BUDGET_CHARS, project } from "./context.ts";
import { memoryHistory } from "./memory-projection.ts";
import { compactBackupName, createRetention } from "./store-retention.ts";

const DAY = 86_400_000;
const later = (days: number) => () => new Date(Date.now() + days * DAY);

function setup() {
  const home = tempDir("apx-retention-");
  const db = openDb(home.path);
  const store = createStore(db, createBus());
  const thread = store.threads.create({ kind: "loose", title: "Chat", agent_ids: ["superagent"] });
  return { home, db, store, thread: thread.id };
}

/**
 * One finished turn as an older APX stored it: a tool call with encrypted reasoning, its result in the log (cut, with
 * a read_output ref, when `cut`) and the whole output kept in the step either way.
 */
function turn(store: Store, thread: string, i: number, o: { output: string; cut?: boolean; finish?: boolean }) {
  const r = store.runs.create({
    thread_id: thread,
    agent_id: "superagent",
    trigger: "user",
    input: { origin: { kind: "user" }, text: `question ${i}` },
    deadline_at: new Date(Date.now() + DAY).toISOString(),
  });
  const call = `call_${i}`;
  const step = store.runs.beginStep(r.id, { call_id: call, tool: "shell", args: { command: "ls" }, effect: "none" });
  const shown = o.cut
    ? `${o.output.slice(0, 12_000)}\n[full output: ${o.output.length} chars; read_output ref=${step}]`
    : o.output;
  store.runs.endStep(r.id, call, "ok", o.output.slice(0, 4000), o.output);
  store.modelLog.append(thread, r.id, [
    { role: "user", content: `question ${i}` },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: call, type: "function", function: { name: "shell", arguments: '{"command":"ls"}' } }],
      responses_reasoning: [{ model: "gpt-test", summary: [], encrypted_content: "r".repeat(3000) }],
    },
    { role: "tool", tool_call_id: call, content: shown },
    { role: "assistant", content: `answer ${i}` },
  ]);
  if (o.finish !== false) store.runs.setState(r, "completed");
  return { run: r.id, step };
}

/** What the next turn of this chat sends as history, and the request bytes a Responses model would get for it. */
function view(store: Store, thread: string): string {
  const entries = memoryHistory(store, store.modelLog.list(thread), "superagent");
  const items = project(entries, HISTORY_BUDGET_CHARS, store.threads.context(thread).compaction).items;
  return JSON.stringify([items, toInput([{ role: "system", content: "s" }, ...(items as ChatItem[])], "gpt-test")]);
}

const logBytes = (db: DatabaseSync) =>
  Number((db.prepare("SELECT sum(length(item)) AS n FROM model_log").get() as { n: number }).n);

test("compacting old turns leaves what the chat's next turn sends byte for byte the same", () => {
  const { home, db, store, thread } = setup();
  try {
    // Past the newest turns a view counts tool output as its stub: it takes many turns to leave it.
    const turns = Array.from({ length: 200 }, (_, i) =>
      turn(store, thread, i, { output: `${i}:${"x".repeat(20_000)}`, cut: i % 2 === 0 }),
    );
    const before = view(store, thread);
    const bytes = logBytes(db);
    const counts = createRetention({ store, db, now: later(30) }).pass();
    assert.equal(view(store, thread), before);
    assert.ok(counts.runs_compacted > 40, `compacted ${counts.runs_compacted}`);
    assert.ok(logBytes(db) < bytes * 0.75, `log ${bytes} → ${logBytes(db)}`);
    // The newest turns, in the chat's view, keep the outputs their log points read_output at.
    const newest = turns.at(-2);
    assert.ok(newest);
    assert.match(store.runs.output(newest.step, thread) ?? "", /^198:x/);
    // An old one keeps none: the model can no longer see its ref.
    assert.equal(store.runs.output(turns[0]?.step ?? "", thread), undefined);
    // Its log is what a view past the newest turns already read: the stub, without the encrypted reasoning.
    const old = store.modelLog.forRun(turns[0]?.run ?? "") as Array<Record<string, unknown>>;
    assert.match(
      String(old[2]?.content),
      /^\[earlier output of shell omitted: \d+ chars; call it again if you need it\]$/,
    );
    assert.equal("responses_reasoning" in (old[1] ?? {}), false);
    // Still in view, ten turns back: the stub every view already shows, its reasoning kept for the model.
    const inView = store.modelLog.forRun(turns.at(-20)?.run ?? "") as Array<Record<string, unknown>>;
    assert.match(String(inView[2]?.content), /^\[earlier output of shell omitted/);
    assert.equal("responses_reasoning" in (inView[1] ?? {}), true);
    // The newest turns, which a view shows whole, are as they were written.
    const recent = store.modelLog.forRun(turns.at(-3)?.run ?? "") as Array<Record<string, unknown>>;
    assert.match(String(recent[2]?.content), /^197:x/);
    // A second pass finds nothing left to do.
    assert.deepEqual(createRetention({ store, db, now: later(30) }).pass(), {
      runs_trimmed: 0,
      runs_compacted: 0,
      outputs_dropped: 0,
      rows: 0,
    });
  } finally {
    db.close();
    home.remove();
  }
});

test("a finished run drops the whole outputs its log already holds, and keeps the ones it cut", () => {
  const { home, db, store, thread } = setup();
  try {
    const whole = turn(store, thread, 1, { output: "short listing" });
    const cut = turn(store, thread, 2, { output: "y".repeat(30_000), cut: true });
    const counts = createRetention({ store, db }).pass();
    assert.equal(counts.runs_trimmed, 2);
    assert.equal(counts.runs_compacted, 0);
    assert.equal(store.runs.output(whole.step, thread), undefined);
    assert.equal(store.runs.steps(whole.run)[0]?.result, "short listing");
    assert.equal(store.runs.output(cut.step, thread)?.length, 30_000);
  } finally {
    db.close();
    home.remove();
  }
});

test("turns that ended recently and a chat with a turn running stay as they are", () => {
  const { home, db, store, thread } = setup();
  try {
    for (let i = 0; i < 200; i++) turn(store, thread, i, { output: "z".repeat(20_000) });
    const busy = store.threads.create({ kind: "loose", title: "Busy", agent_ids: ["superagent"] }).id;
    for (let i = 0; i < 200; i++) turn(store, busy, i, { output: "z".repeat(20_000) });
    turn(store, busy, 99, { output: "now", finish: false });
    const bytes = logBytes(db);
    // Ended less than two weeks ago: nothing is compacted, whatever its place in the chat.
    assert.equal(createRetention({ store, db, now: later(7) }).pass().runs_compacted, 0);
    assert.equal(logBytes(db), bytes);
    const counts = createRetention({ store, db, now: later(30) }).pass();
    assert.ok(counts.runs_compacted > 0);
    assert.equal(
      store.runs.list(busy, 1000).filter((r) => r.state === "completed").length,
      200,
      "the busy chat's runs are all there",
    );
    const left = (
      db.prepare("SELECT count(*) AS n FROM runs WHERE thread_id = ? AND trimmed = 2").get(busy) as {
        n: number;
      }
    ).n;
    assert.equal(left, 0);
  } finally {
    db.close();
    home.remove();
  }
});

test("compacting gives the space back: an older store is rewritten once, then frees pages by itself", () => {
  const home = tempDir("apx-retention-vacuum-");
  try {
    // A store made before auto-vacuum was set: its free pages stay in the file.
    const legacy = new DatabaseSync(path.join(home.path, "apx.db"));
    legacy.exec("PRAGMA auto_vacuum = NONE; CREATE TABLE filler (x TEXT)");
    legacy.close();
    const db = openDb(home.path);
    const store = createStore(db, createBus());
    const fill = () => {
      const insert = db.prepare("INSERT INTO filler VALUES (?)");
      for (let i = 0; i < 400; i++) insert.run("f".repeat(20_000));
      db.exec("DELETE FROM filler");
    };
    fill();
    assert.equal(storeSize(db).incremental, false);
    const retention = createRetention({ store, db });
    const short = retention.compactNow(0);
    assert.equal(short.reclaimed, "not_enough_disk");
    assert.equal(short.after_bytes, short.before_bytes);
    const rebuilt = retention.compactNow(Number.MAX_SAFE_INTEGER);
    assert.equal(rebuilt.reclaimed, "rebuilt");
    assert.ok(rebuilt.after_bytes < rebuilt.before_bytes / 2, `${rebuilt.before_bytes} → ${rebuilt.after_bytes}`);
    assert.equal(storeSize(db).incremental, true);
    fill();
    const grown = storeSize(db).bytes;
    retention.check.run(new Date());
    assert.ok(storeSize(db).bytes < grown / 2, "the office clock gives free pages back");
    db.close();
  } finally {
    home.remove();
  }
});

const keptOutputs = (db: DatabaseSync) =>
  Number((db.prepare("SELECT count(*) AS n FROM steps WHERE output IS NOT NULL").get() as { n: number }).n);

test("compacting saves a copy of the store first, and changes nothing when the disk has no room for the copy", () => {
  const { home, db, store, thread } = setup();
  try {
    for (let i = 0; i < 3; i++) turn(store, thread, i, { output: `${i}:${"y".repeat(20_000)}` });
    const retention = createRetention({ store, db });
    const backups = path.join(home.path, "backups");
    fs.mkdirSync(backups);
    const backup = path.join(backups, compactBackupName(new Date("2026-11-06T12:30:45Z")));
    assert.equal(path.basename(backup), "apx-before-compact-20261106-123045.db");

    const short = retention.compactNow(0, backup);
    assert.equal(short.reclaimed, "not_enough_disk");
    assert.equal(short.outputs_dropped, 0);
    assert.equal(short.backup, undefined);
    assert.equal(fs.existsSync(backup), false);
    assert.equal(keptOutputs(db), 3);

    const done = retention.compactNow(Number.MAX_SAFE_INTEGER, backup);
    assert.equal(done.backup, path.basename(backup));
    assert.ok(done.outputs_dropped > 0);
    assert.ok(keptOutputs(db) < 3);
    const copy = new DatabaseSync(backup, { readOnly: true });
    try {
      assert.equal(keptOutputs(copy), 3, "the copy holds the store as it was before trimming");
    } finally {
      copy.close();
    }
    db.close();
  } finally {
    home.remove();
  }
});

test("a new store is incremental from the start", () => {
  const home = tempDir("apx-retention-new-");
  try {
    const db = openDb(home.path);
    assert.equal(storeSize(db).incremental, true);
    db.close();
  } finally {
    home.remove();
  }
});

test("turns a chat's summary replaced are compacted, the summary and newer turns read the same", () => {
  const { home, db, store, thread } = setup();
  try {
    const turns = Array.from({ length: 12 }, (_, i) => turn(store, thread, i, { output: "w".repeat(20_000) }));
    const upto = Math.max(...(store.retention.spans(turns[5]?.run ?? "").map((s) => s.last) ?? [0]));
    store.threads.mergeContext(thread, {
      compaction: {
        upto,
        summary: "Earlier: the owner listed files.",
        untrusted: false,
        runs: 6,
        at: new Date().toISOString(),
      },
    });
    const before = view(store, thread);
    createRetention({ store, db, now: later(30) }).pass();
    // The six behind the summary lose their reasoning too; newer ones only get the stub, the newest stay whole.
    const levels = turns.map(
      (t) => (db.prepare("SELECT trimmed FROM runs WHERE id = ?").get(t.run) as { trimmed: number }).trimmed,
    );
    assert.deepEqual(levels, [3, 3, 3, 3, 3, 3, 2, 2, 1, 1, 1, 1]);
    assert.equal(view(store, thread), before);
  } finally {
    db.close();
    home.remove();
  }
});
