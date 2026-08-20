// The core event bus: every ledger write announces itself, and no announcement
// can break the write that produced it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Anything under ~/.apx must be redirected BEFORE the modules that resolve
// those paths at import time are loaded (rule 1).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-events-"));
process.env.HOME = HOME;

const { emitMessageEvent, onMessageEvent, resetEventBus } = await import("#core/events/bus.js");
const { appendGlobalMessage, appendMessageToFs } = await import("#core/stores/messages.js");
const { startConversation, appendTurn, conversationPath, parseConversationPath } =
  await import("#core/stores/conversations.js");

/** Collect every event emitted while `fn` runs. */
function capture(fn) {
  const seen = [];
  const off = onMessageEvent((e) => seen.push(e));
  try {
    fn();
  } finally {
    off();
  }
  return seen;
}

test("appendGlobalMessage announces the channel thread it wrote to", () => {
  resetEventBus();
  const seen = capture(() =>
    appendGlobalMessage({
      channel: "telegram",
      direction: "in",
      type: "user",
      author: "@someone",
      body: "hola",
      ts: "2026-01-15T10:00:00Z",
      meta: { project_id: 7 },
    }),
  );
  assert.equal(seen.length, 1);
  assert.deepEqual(
    { scope: seen[0].scope, channel: seen[0].channel, thread: seen[0].thread, project_id: seen[0].project_id },
    { scope: "global", channel: "telegram", thread: "2026-01-15", project_id: 7 },
  );
  assert.equal(seen[0].direction, "in");
  assert.equal(seen[0].type, "user");
});

test("a global write with no project stamp announces a null project", () => {
  resetEventBus();
  const seen = capture(() =>
    appendGlobalMessage({ channel: "desktop", direction: "out", type: "agent", body: "listo" }),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].project_id, null);
});

test("appendMessageToFs announces the project root, not an id core cannot know", () => {
  resetEventBus();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-proj-"));
  const seen = capture(() =>
    appendMessageToFs({
      projectRoot: root,
      channel: "exec",
      direction: "out",
      type: "agent",
      body: "done",
      agent_slug: "rocky-pm",
      ts: "2026-01-15T11:00:00Z",
    }),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].scope, "project");
  assert.equal(seen[0].project_root, root);
  assert.equal(seen[0].agent_slug, "rocky-pm");
  assert.equal(seen[0].thread, "2026-01-15");
});

test("appendTurn announces which conversation moved", () => {
  resetEventBus();
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "apx-conv-"));
  const conv = startConversation({ storagePath: storage, agentSlug: "northwind-lead", engine: "mock" });
  const seen = capture(() => appendTurn({ filePath: conv.path, role: "assistant", content: "ok" }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].scope, "conversation");
  assert.equal(seen[0].agent_slug, "northwind-lead");
  assert.equal(seen[0].conversation_id, conv.id);
  assert.equal(seen[0].project_root, storage);
});

test("parseConversationPath is the inverse of conversationPath", () => {
  const file = conversationPath("/path/to/store", "acme-bot", "2026-01-15-01");
  assert.deepEqual(parseConversationPath(file), {
    project_root: "/path/to/store",
    agent_slug: "acme-bot",
    conversation_id: "2026-01-15-01",
  });
  // Anything that is not a conversation file is not one.
  assert.equal(parseConversationPath("/path/to/store/messages/2026-01-15.jsonl"), null);
  assert.equal(parseConversationPath(""), null);
});

test("a listener that throws does not break the write that announced it", () => {
  resetEventBus();
  const off = onMessageEvent(() => { throw new Error("subscriber exploded"); });
  try {
    const written = appendGlobalMessage({ channel: "web", direction: "in", type: "user", body: "still written" });
    assert.ok(fs.existsSync(written.file));
    assert.match(fs.readFileSync(written.file, "utf8"), /still written/);
  } finally {
    off();
  }
});

test("emitMessageEvent with no subscribers is a no-op, not a crash", () => {
  resetEventBus();
  assert.doesNotThrow(() => emitMessageEvent({ scope: "global", channel: "web" }));
});
