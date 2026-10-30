import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewChat, newChatId, newChatThread, parseNewChat } from "./newChat.ts";

test("a new chat's id says who it is with, where and with which engine, and reads back the same", () => {
  const chat = { agent: "scout", project: "acme:web", engine: "claude" };
  const id = newChatId(chat);
  assert.ok(isNewChat(id));
  assert.equal(newChatId(chat), id);
  assert.deepEqual(parseNewChat(id), chat);
  assert.deepEqual(parseNewChat(newChatId({ agent: "superagent" })), { agent: "superagent" });
});

test("only a new chat's id is read as one", () => {
  assert.equal(isNewChat("home"), false);
  assert.equal(isNewChat(undefined), false);
  assert.equal(parseNewChat("home"), undefined);
  assert.equal(parseNewChat("new:"), undefined);
});

test("a new session is a code thread with its engine; a new chat is a loose one", () => {
  const session = newChatThread({ agent: "superagent", project: "acme", engine: "codex" }, "Codex");
  assert.equal(session.kind, "code");
  assert.equal(session.engine, "codex");
  assert.equal(session.project_id, "acme");
  const chat = newChatThread({ agent: "scout" }, "New chat");
  assert.equal(chat.kind, "loose");
  assert.equal(chat.engine, undefined);
  assert.deepEqual(chat.agent_ids, ["scout"]);
});
