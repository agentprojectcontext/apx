import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Task, Thread } from "@apx/protocol";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" }, addEventListener: () => undefined },
});
const { archiveTaskChats, taskChatIds } = await import("./taskChats.ts");
Reflect.deleteProperty(globalThis, "window");
const at = "2026-01-01T00:00:00Z";
const task = Task.parse({
  id: "task_example",
  title: "Example",
  description: "",
  status: "doing",
  state: "open",
  kind: "task",
  priority: "normal",
  tags: [],
  thread_id: "task_root",
  project_id: "project_a",
  awaits_owner: false,
  renegotiated: 0,
  created_by: "owner",
  created_at: at,
  updated_at: at,
  activity_at: at,
});
const chat = (id: string, patch: Partial<Thread> = {}) =>
  Thread.parse({
    id,
    kind: "agent",
    title: id,
    agent_ids: ["builder"],
    project_id: task.project_id,
    task_id: task.id,
    state: "idle",
    unread: 0,
    created_at: at,
    updated_at: at,
    ...patch,
  });
const sessions = [
  chat("a"),
  chat("b", { archived: true }),
  chat("wrong_task", { task_id: "other" }),
  chat("wrong_project", { project_id: "other" }),
  chat("home", { kind: "home" }),
  chat("a"),
];

function transport(t: TestContext, fail?: string) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    const params = JSON.parse(String(init.body));
    calls.push({ method, params });
    if (method === fail) throw new Error("offline");
    if (method === "tasks.get") return Response.json({ ok: true, result: { task, sessions } });
    assert.equal(method, "threads.update");
    return Response.json({ ok: true, result: chat(String(params.thread), { archived: Boolean(params.archived) }) });
  });
  return calls;
}

test("archive selects the complete task group without other tasks, projects or Home", () => {
  assert.deepEqual(taskChatIds(task, sessions), ["task_root", "a", "b"]);
});

test("archive and restore only arrange task chats; no send, close, delete or execution", async (t) => {
  const calls = transport(t);
  assert.equal(await archiveTaskChats(task.id, true), true);
  assert.equal(await archiveTaskChats(task.id, false), true);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "tasks.get",
      "threads.update",
      "threads.update",
      "threads.update",
      "tasks.get",
      "threads.update",
      "threads.update",
      "threads.update",
    ],
  );
  assert.deepEqual(
    calls.filter((c) => c.method === "threads.update").map((c) => c.params),
    [true, false].flatMap((archived) => ["task_root", "a", "b"].map((thread) => ({ thread, archived }))),
  );
});

test("failed lookup performs no writes and failed archive stops with a visible failure", async (t) => {
  const calls = transport(t, "tasks.get");
  assert.equal(await archiveTaskChats(task.id, true), false);
  assert.equal(calls.length, 1);
});

test("an update failure never continues mutating the remaining chats", async (t) => {
  const calls = transport(t, "threads.update");
  assert.equal(await archiveTaskChats(task.id, true), false);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["tasks.get", "threads.update"],
  );
});
