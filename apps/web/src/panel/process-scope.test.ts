import assert from "node:assert/strict";
import test from "node:test";
import type { Thread } from "@apx/protocol";
import { chatDescendants, delegationRunning } from "./process-scope.ts";

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

test("the teammates a chat asked on its task, and those they called, are the chat's; the task's others are not", () => {
  const threads = [
    thread("root"),
    thread("asked", "task"),
    thread("theirs", "asked"),
    thread("owner-asked", "task"),
    thread("child", "root"),
  ];
  assert.deepEqual(
    chatDescendants(threads, "root", ["asked"]).map((t) => t.id),
    ["asked", "theirs", "child"],
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

test("a chat's agents are running while a conversation it handed out, or one handed out from it, works", () => {
  const threads = { root: {}, child: { parent_id: "root" }, nested: { parent_id: "child" }, other: {} };
  const job = (parent_thread_id?: string, ended_at?: string) => ({
    kind: "agent" as const,
    ...(parent_thread_id ? { parent_thread_id } : {}),
    ...(ended_at ? { ended_at } : {}),
  });
  assert.equal(delegationRunning([job("root")], threads, "root"), true);
  assert.equal(delegationRunning([job("nested")], threads, "root"), true);
  assert.equal(delegationRunning([job("root", "2026-01-01")], threads, "root"), false);
  assert.equal(delegationRunning([job("other"), job()], threads, "root"), false);
  assert.equal(delegationRunning([{ kind: "terminal" as const, parent_thread_id: "root" }], threads, "root"), false);
});
