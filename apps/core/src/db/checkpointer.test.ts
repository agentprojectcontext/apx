import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { waitFor } from "../testkit/wait.ts";
import { startCheckpointer } from "./checkpointer.ts";
import { openDb } from "./db.ts";

const autoPages = (db: ReturnType<typeof openDb>) =>
  Number(Object.values(db.prepare("PRAGMA wal_autocheckpoint").get() ?? {})[0]);

// See DECISIONS.md#d-259: the core's connection never syncs the log itself while the thread does it.
test("while its thread is up the core never checkpoints, and what it writes still reaches the store", async () => {
  await using home = tempDir("apx-ckpt-");
  const db = openDb(home.path);
  const checkpointer = startCheckpointer(db, home.path, { everyMs: 20 });
  try {
    await waitFor(() => autoPages(db) === 0, "the thread to take over checkpoints");
    const file = path.join(home.path, "apx.db");
    const before = fs.statSync(file).size;
    db.exec("CREATE TABLE ckpt (body BLOB)");
    // Well past SQLite's own threshold of 1000 pages, so the core would have checkpointed by itself.
    const insert = db.prepare("INSERT INTO ckpt (body) VALUES (?)");
    for (let i = 0; i < 40; i++) insert.run(Buffer.alloc(128 * 1024, i));
    await waitFor(() => fs.statSync(file).size > before + 4 * 1024 * 1024, "the log to be copied into the store");
    assert.equal(autoPages(db), 0);
  } finally {
    await checkpointer.close();
    db.close();
  }
});

test("once the thread closes, the core checkpoints on its own again", async () => {
  await using home = tempDir("apx-ckpt-");
  const db = openDb(home.path);
  const checkpointer = startCheckpointer(db, home.path, { everyMs: 20 });
  try {
    await waitFor(() => autoPages(db) === 0, "the thread to take over checkpoints");
    await checkpointer.close();
    assert.equal(autoPages(db), 1000);
    await checkpointer.close();
  } finally {
    db.close();
  }
});
