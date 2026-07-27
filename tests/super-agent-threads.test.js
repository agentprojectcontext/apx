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

test("readGlobalThread: maps user/agent to chat roles, includes tool, drops system", () => {
  const base = tmpLedger();
  writeDay(base, "telegram", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "telegram", direction: "in", type: "user", body: "hola" },
    { ts: "2026-07-01T10:00:02Z", channel: "telegram", direction: "out", type: "tool", body: "tool noise", meta: { tool: "search", args: { q: "x" }, result: { ok: true } } },
    { ts: "2026-07-01T10:00:03Z", channel: "telegram", direction: "out", type: "system", author: "system", body: "sys noise" },
    { ts: "2026-07-01T10:00:05Z", channel: "telegram", direction: "out", type: "agent", body: "buenas!" },
  ]);
  const thread = readGlobalThread({ channel: "telegram", date: "2026-07-01", _globalMessagesDir: base });
  assert.equal(thread.channel, "telegram");
  // Tool rows are surfaced so the web viewer can render tool executions the
  // same way the live stream does; system rows stay dropped (context-only).
  assert.deepEqual(
    thread.messages.map((m) => [m.role, m.content]),
    [["user", "hola"], ["tool", "tool noise"], ["assistant", "buenas!"]]
  );
  const toolMsg = thread.messages.find((m) => m.role === "tool");
  assert.equal(toolMsg.tool, "search");
  assert.deepEqual(toolMsg.args, { q: "x" });
  assert.deepEqual(toolMsg.result, { ok: true });
});

test("readGlobalThread: assistant rows carry model, usage and agent attribution", () => {
  const base = tmpLedger();
  writeDay(base, "telegram", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "telegram", direction: "in", type: "user", body: "hola" },
    {
      ts: "2026-07-01T10:00:05Z", channel: "telegram", direction: "out", type: "agent",
      author: "Roby", actor_id: "super_agent",
      body: "buenas!",
      meta: { actor_kind: "superagent", agent: "super_agent", model: "anthropic:claude-haiku-4-5", usage: { input_tokens: 120, output_tokens: 30 } },
    },
    {
      ts: "2026-07-01T10:01:00Z", channel: "telegram", direction: "out", type: "agent",
      author: "sofia", actor_id: "sofia",
      body: "y esto lo respondo yo",
      meta: { actor_kind: "agent", agent: "sofia", model: "ollama:llama3.2:3b" },
    },
  ]);
  const thread = readGlobalThread({ channel: "telegram", date: "2026-07-01", _globalMessagesDir: base });
  const [roby, sofia] = thread.messages.filter((m) => m.role === "assistant");
  assert.equal(roby.agent, "super_agent");
  assert.equal(roby.agent_name, "Roby");
  assert.equal(roby.actor_kind, "superagent");
  assert.equal(roby.model, "anthropic:claude-haiku-4-5");
  assert.deepEqual(roby.usage, { input_tokens: 120, output_tokens: 30 });
  // A different agent on the same day keeps its own attribution.
  assert.equal(sofia.agent, "sofia");
  assert.equal(sofia.actor_kind, "agent");
  assert.equal(sofia.model, "ollama:llama3.2:3b");
  assert.equal(sofia.usage, undefined);
});

test("readGlobalThread: legacy rows with no model/usage stay clean", () => {
  const base = tmpLedger();
  writeDay(base, "telegram", "2026-07-01", [
    { ts: "2026-07-01T10:00:00Z", channel: "telegram", direction: "in", type: "user", body: "hola" },
    { ts: "2026-07-01T10:00:05Z", channel: "telegram", direction: "out", type: "agent", body: "buenas!" },
  ]);
  const thread = readGlobalThread({ channel: "telegram", date: "2026-07-01", _globalMessagesDir: base });
  const assistant = thread.messages.find((m) => m.role === "assistant");
  assert.equal(assistant.model, undefined);
  assert.equal(assistant.usage, undefined);
  assert.equal(assistant.agent_name, undefined);
  // inferActorId still fills a stable actor for legacy rows.
  assert.equal(assistant.agent, "agent");
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
