// Super-agent channel threads: global ledger → Chats sidebar entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listGlobalThreads, readGlobalThread } from "#core/stores/messages.js";

function tmpLedger() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-threads-ledger-"));
}

function writeDay(base, channel, date, records) {
  const dir = path.join(base, channel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}.jsonl`),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
}

test("listGlobalThreads: one entry per channel+day, titled by first user turn", () => {
  const base = tmpLedger();
  writeDay(base, "telegram", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "telegram", direction: "in", type: "user", author: "manu", body: "hola roby, cómo va el deploy?" },
    { ts: "2026-07-01T10:00:05Z", channel: "telegram", direction: "out", type: "agent", body: "Va bien — 3 servicios arriba." },
  ]);
  writeDay(base, "web", "2026-07-02", [
    { ts: "2026-07-02T09:00:00Z", channel: "web", direction: "in", type: "user", body: "ping" },
    { ts: "2026-07-02T09:00:01Z", channel: "web", direction: "out", type: "agent", body: "pong" },
    { ts: "2026-07-02T09:00:02Z", channel: "web", direction: "out", type: "tool", body: "ignored tool result" },
  ]);

  const threads = listGlobalThreads({ _globalMessagesDir: base });
  assert.equal(threads.length, 2);
  // Newest activity first.
  assert.equal(threads[0].channel, "web");
  assert.equal(threads[0].id, "2026-07-02");
  assert.equal(threads[0].messages, 2); // tool turn excluded
  assert.equal(threads[0].title, "ping");
  assert.equal(threads[1].channel, "telegram");
  assert.equal(threads[1].title, "hola roby, cómo va el deploy?");
  assert.equal(threads[1].started_at, "2026-07-01T10:00:00Z");
  assert.equal(threads[1].last_ts, "2026-07-01T10:00:05Z");
});

test("listGlobalThreads: skips days with no conversational turns", () => {
  const base = tmpLedger();
  writeDay(base, "desktop", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "desktop", direction: "out", type: "system", author: "system", body: "boot" },
  ]);
  assert.deepEqual(listGlobalThreads({ _globalMessagesDir: base }), []);
});

test("readGlobalThread: maps user/agent to chat roles, drops tool/system", () => {
  const base = tmpLedger();
  writeDay(base, "telegram", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "telegram", direction: "in", type: "user", body: "hola" },
    { ts: "2026-07-01T10:00:02Z", channel: "telegram", direction: "out", type: "tool", body: "tool noise" },
    { ts: "2026-07-01T10:00:05Z", channel: "telegram", direction: "out", type: "agent", body: "buenas!" },
  ]);
  const thread = readGlobalThread({ channel: "telegram", date: "2026-07-01", _globalMessagesDir: base });
  assert.equal(thread.channel, "telegram");
  assert.deepEqual(
    thread.messages.map((m) => [m.role, m.content]),
    [["user", "hola"], ["assistant", "buenas!"]]
  );
});

test("readGlobalThread: rejects traversal-shaped channel and bad dates", () => {
  const base = tmpLedger();
  writeDay(base, "telegram", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "telegram", direction: "in", type: "user", body: "hola" },
  ]);
  assert.equal(readGlobalThread({ channel: "../telegram", date: "2026-07-01", _globalMessagesDir: base }), null);
  assert.equal(readGlobalThread({ channel: "telegram", date: "../2026-07-01", _globalMessagesDir: base }), null);
  assert.equal(readGlobalThread({ channel: "telegram", date: "2026-07-09", _globalMessagesDir: base }), null);
});

test("GET /projects/:pid/super-agent/threads/:channel/:id returns 404 for missing thread", async () => {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  const { register } = await import("../src/host/daemon/api/conversations.js");
  register(app, {
    project: () => ({ id: "p1", path: "/tmp/none", storagePath: null }),
    config: {},
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/projects/p1/super-agent/threads/nope-channel/2020-01-01`);
    assert.equal(res.status, 404);
    const list = await fetch(`http://127.0.0.1:${port}/projects/p1/super-agent/threads`);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(await list.json()));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
