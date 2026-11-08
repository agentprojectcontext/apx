import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Thread } from "@apx/protocol";
import { lastAgentWords, superAgentNow } from "./superAgentNow.ts";

const th = (id: string, o: Partial<Thread> = {}): Thread => ({
  id,
  kind: "agent",
  title: id,
  agent_ids: ["agent_other"],
  state: "idle",
  preview: "",
  unread: 0,
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:00:00Z",
  ...o,
});

test("the card lists the super-agent's working chats and those it delegated, at any depth, newest first", () => {
  const threads = Object.fromEntries(
    [
      th("home", {
        kind: "home",
        agent_ids: ["sup"],
        state: "working",
        preview: "Building the docs",
        updated_at: "2026-11-08T10:05:00Z",
      }),
      th("child", {
        kind: "a2a",
        parent_id: "home",
        state: "working",
        title: "Run the docs build",
        updated_at: "2026-11-08T10:06:00Z",
      }),
      th("grandchild", {
        kind: "a2a",
        parent_id: "child",
        state: "submitted",
        title: "Lint",
        updated_at: "2026-11-08T10:01:00Z",
      }),
      th("unrelated", { state: "working", title: "Someone else's work" }),
      th("done", { kind: "a2a", parent_id: "home", state: "completed", title: "Finished" }),
    ].map((t) => [t.id, t]),
  );
  assert.deepEqual(
    superAgentNow(threads, "sup").map((r) => [r.threadId, r.text]),
    [
      ["child", "Run the docs build"],
      ["home", "Building the docs"],
      ["grandchild", "Lint"],
    ],
  );
  assert.equal(superAgentNow(threads, "sup", 1).length, 1);
});

test("a parent loop does not hang the walk", () => {
  const threads = { a: th("a", { parent_id: "b", state: "working" }), b: th("b", { parent_id: "a" }) };
  assert.deepEqual(superAgentNow(threads, "sup"), []);
});

test("the last words are the newest agent text, or the chat's preview when its messages are not loaded", () => {
  const home = th("home", { kind: "home", preview: "You asked about the build", updated_at: "2026-11-08T11:00:00Z" });
  const msg = (seq: number, author: Message["author"], text: string): Message => ({
    id: `m${seq}`,
    thread_id: "home",
    seq,
    author,
    parts: [{ type: "text", text }],
    created_at: `2026-11-08T10:0${seq}:00Z`,
  });
  const messages = [msg(1, { kind: "agent", id: "sup" }, "Fausto runs the build."), msg(2, { kind: "user" }, "Thanks")];
  assert.deepEqual(lastAgentWords(home, messages), { text: "Fausto runs the build.", at: "2026-11-08T10:01:00Z" });
  assert.deepEqual(lastAgentWords(home, undefined), { text: "You asked about the build", at: "2026-11-08T11:00:00Z" });
  assert.equal(lastAgentWords(undefined, undefined), undefined);
});
