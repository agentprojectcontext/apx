import assert from "node:assert/strict";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";

// See DECISIONS.md#d-249: a commit waits on no fsync; the log reaches the disk at checkpoints.
test("the store opens with a write-ahead log whose commits are synced at checkpoints", async () => {
  await using home = tempDir("apx-db-");
  const db = openDb(home.path);
  try {
    const value = (name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
    assert.equal(value("journal_mode"), "wal");
    // 1 is NORMAL; FULL (2) would fsync the log on every commit.
    assert.equal(value("synchronous"), 1);
  } finally {
    db.close();
  }
});
