import assert from "node:assert/strict";
import test from "node:test";
import type { Thread } from "@apx/protocol";
import { chatDescendants } from "./process-scope.ts";

const thread = (id: string, parent_id?: string): Thread => ({
  id,
  parent_id,
  kind: parent_id ? "a2a" : "agent",
  title: id,
  agent_ids: ["agent"],
  state: "idle",
  preview: "",
  unread: 0,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});

test("a chat includes nested workers and archived children, excluding the same agent's other chats", () => {
  const threads = [
    thread("root"),
    thread("other"),
    thread("child", "root"),
    thread("nested", "child"),
    { ...thread("archived", "root"), archived: true },
    thread("unrelated", "other"),
  ];
  assert.deepEqual(
    chatDescendants(threads, "root").map((t) => t.id),
    ["child", "nested", "archived"],
  );
});

test("missing ancestors and malformed parent cycles cannot pull unrelated work into a chat", () => {
  const threads = [
    thread("root"),
    thread("orphan", "missing"),
    thread("a", "b"),
    thread("b", "a"),
    thread("root", "root"),
  ];
  assert.deepEqual(chatDescendants(threads, "root"), []);
});
