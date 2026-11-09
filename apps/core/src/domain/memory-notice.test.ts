import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { tellWaitingNotes } from "./memory-notice.ts";
import { createStore } from "./store.ts";

test("notes about the owner that waited before the tray could tell are told once, at start", async () => {
  await using home = tempDir("apx-memory-notice-");
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    const notices = () => store.notifications.list({ unreadOnly: false, limit: 10 }).filter((n) => n.kind === "memory");
    store.memories.add({
      scope: "global",
      text: "The owner prefers short answers.",
      source: "agent",
      pending: true,
      tainted: true,
    });
    tellWaitingNotes(store);
    assert.equal(notices().length, 1);
    assert.match(notices()[0]?.body ?? "", /short answers/);
    store.notifications.read();
    tellWaitingNotes(store);
    assert.equal(store.notifications.unread(), 0, "read once, it is not told again on the next start");
  } finally {
    db.close();
  }
});
