import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { inboxEntries } from "./groupThreads.ts";
import { listRoot, listTab } from "./listTab.ts";

const thread = (id: string, extra: Partial<Thread> = {}): Thread =>
  ({
    id,
    kind: "loose",
    title: id,
    agent_ids: ["superagent"],
    state: "completed",
    preview: "",
    unread: 0,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ...extra,
  }) as Thread;

const byId = (...list: Thread[]): Record<string, Thread> => Object.fromEntries(list.map((t) => [t.id, t]));

const threads = byId(
  thread("chat"),
  thread("call", { kind: "call" }),
  thread("taskchat", { task_id: "t1" }),
  thread("asked", { kind: "a2a", parent_id: "taskchat" }),
  thread("askedagain", { kind: "a2a", parent_id: "asked" }),
  thread("run", { kind: "routine", routine_id: "r1" }),
  thread("old", { archived: true }),
  thread("oldkid", { kind: "a2a", parent_id: "old" }),
  thread("orphan", { kind: "a2a", parent_id: "gone", task_id: "t2" }),
  thread("loopa", { kind: "a2a", parent_id: "loopb" }),
  thread("loopb", { kind: "a2a", parent_id: "loopa" }),
);

test("a chat opens its own tab: chats and calls in Chats, a task's chat in Tasks, a routine run in Routines", () => {
  assert.equal(listTab(threads, "chat"), "chats");
  assert.equal(listTab(threads, "call"), "chats");
  assert.equal(listTab(threads, "taskchat"), "tasks");
  assert.equal(listTab(threads, "run"), "routines");
});

test("a delegated chat opens the tab of the chat it hangs under, however deep", () => {
  assert.equal(listRoot(threads, "askedagain")?.id, "taskchat");
  assert.equal(listTab(threads, "askedagain"), "tasks");
});

test("an archived chat, and what it delegated, are under Chats", () => {
  assert.equal(listTab(threads, "old"), "chats");
  assert.equal(listTab(threads, "oldkid"), "chats");
});

test("a delegated chat whose caller is not loaded stands on its own", () => {
  assert.equal(listRoot(threads, "orphan")?.id, "orphan");
  assert.equal(listTab(threads, "orphan"), "tasks");
});

test("a teammate asked on a task hangs under the task's own chat, not loaded, and is listed in Tasks", () => {
  const asked = byId(thread("bruno", { kind: "a2a", parent_id: "taskhome" }));
  assert.equal(listTab(asked, "bruno"), "chats");
  assert.equal(listTab(asked, "bruno", new Set(["taskhome"])), "tasks");
  const loaded = byId(thread("taskhome"), thread("bruno", { kind: "a2a", parent_id: "taskhome" }));
  assert.equal(listTab(loaded, "bruno", new Set(["taskhome"])), "tasks");
});

test("a chat not loaded yet has no tab, and a loop of callers cannot trap it", () => {
  assert.equal(listTab(threads, "missing"), undefined);
  assert.equal(listTab(threads, undefined), undefined);
  assert.ok(listTab(threads, "loopa"));
});

test("the tab agrees with where the Inbox lists each row", () => {
  const listed = byId(threads.chat as Thread, threads.taskchat as Thread, threads.run as Thread);
  for (const e of inboxEntries(listed, { routines: true })) {
    const want = e.kind === "thread" ? "chats" : e.kind === "task" ? "tasks" : "routines";
    for (const t of e.kind === "thread" ? [e.thread] : e.threads) assert.equal(listTab(listed, t.id), want);
  }
});
