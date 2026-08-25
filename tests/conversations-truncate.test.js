// truncateConversation — the rewind that "regenerate" and "edit & resend" stand
// on. It keeps the first K VISIBLE (user/assistant) turns and drops the rest,
// carrying interleaved system/compact context with them, so the file lines up
// with the pane (which hides system/compact) regardless of turn timestamps.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-trunc-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { startConversation, appendTurn, truncateConversation, readConversation } =
  await import("#core/stores/conversations.js");

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-trunc-"));
  return { storagePath: path.join(root, "storage"), root };
}

function seed(storagePath, slug) {
  const { path: file } = startConversation({ storagePath, agentSlug: slug, engine: "mock", channel: "web", id: "c1" });
  appendTurn({ filePath: file, role: "user", content: "one" });
  appendTurn({ filePath: file, role: "assistant", content: "reply one" });
  appendTurn({ filePath: file, role: "user", content: "two" });
  appendTurn({ filePath: file, role: "assistant", content: "reply two" });
  appendTurn({ filePath: file, role: "user", content: "three" });
  appendTurn({ filePath: file, role: "assistant", content: "reply three" });
  return file;
}

test("keepVisible drops the turns after the K-th visible turn", () => {
  const s = makeStore();
  try {
    seed(s.storagePath, "scout");
    // Keep the first two visible turns: user "one" + assistant "reply one".
    const ok = truncateConversation(s.storagePath, "scout", "c1", { keepVisible: 2 });
    assert.equal(ok, true);
    const conv = readConversation(s.storagePath, "scout", "c1");
    assert.deepEqual(conv.turns.map((t) => t.content), ["one", "reply one"]);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("keepVisible 0 empties the body but keeps the file/frontmatter", () => {
  const s = makeStore();
  try {
    seed(s.storagePath, "scout");
    truncateConversation(s.storagePath, "scout", "c1", { keepVisible: 0 });
    const conv = readConversation(s.storagePath, "scout", "c1");
    assert.equal(conv.turns.length, 0);
    assert.equal(conv.fm.channel, "web", "frontmatter survives the rewind");
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("keepVisible beyond the turns present is a no-op rewind", () => {
  const s = makeStore();
  try {
    seed(s.storagePath, "scout");
    truncateConversation(s.storagePath, "scout", "c1", { keepVisible: 99 });
    const conv = readConversation(s.storagePath, "scout", "c1");
    assert.equal(conv.turns.length, 6, "nothing dropped when K exceeds what exists");
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("system/compact turns ride along with the visible ones before the cut", () => {
  const s = makeStore();
  try {
    const { path: file } = startConversation({ storagePath: s.storagePath, agentSlug: "scout", engine: "mock", channel: "web", id: "c2" });
    appendTurn({ filePath: file, role: "system", content: "ctx" });
    appendTurn({ filePath: file, role: "user", content: "one" });
    appendTurn({ filePath: file, role: "assistant", content: "reply one" });
    appendTurn({ filePath: file, role: "user", content: "two" });
    appendTurn({ filePath: file, role: "assistant", content: "reply two" });
    // Keep the first visible turn (user "one"); the leading system turn stays.
    truncateConversation(s.storagePath, "scout", "c2", { keepVisible: 1 });
    const conv = readConversation(s.storagePath, "scout", "c2");
    assert.deepEqual(conv.turns.map((t) => `${t.role}:${t.content}`), ["system:ctx", "user:one"]);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("missing conversation returns false", () => {
  const s = makeStore();
  try {
    assert.equal(truncateConversation(s.storagePath, "nobody", "nope", { keepVisible: 1 }), false);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});
