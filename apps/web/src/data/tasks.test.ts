import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Task } from "@apx/protocol";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const tasks = await import("./tasks.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
else Reflect.deleteProperty(globalThis, "window");

function mockRpc(t: TestContext, handlers: Record<string, unknown>) {
  const calls: [string, unknown][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    const params = JSON.parse(String(init.body));
    calls.push([method, params]);
    assert.ok(Object.hasOwn(handlers, method), `unexpected RPC ${method}`);
    const result = handlers[method];
    if (result instanceof Error) throw result;
    return Response.json({ ok: true, result: typeof result === "function" ? await result(params) : result });
  });
  return calls;
}

const at = "2026-01-01T00:00:00Z";
const task = (id: string, state: "open" | "done" | "dropped" = "open") =>
  Task.parse({
    id,
    title: id,
    description: "Example",
    status: "todo",
    state,
    kind: "task",
    priority: "normal",
    tags: [],
    thread_id: `thr_${id}`,
    awaits_owner: false,
    renegotiated: 0,
    created_by: "owner",
    created_at: at,
    updated_at: at,
    activity_at: at,
  });

test("task board merges open and recent closed lists, and task events update and remove records", async (t) => {
  const open = task("open");
  const done = task("done", "done");
  const dropped = task("dropped", "dropped");
  const calls = mockRpc(t, {
    "tasks.list": ({ state }: { state: string }) => ({
      tasks: { open: [open], done: [done], dropped: [dropped] }[state],
      columns: [{ id: "todo", label: "To do" }],
    }),
  });
  await tasks.loadTasks();
  assert.equal(tasks.tasksLoaded(), true);
  assert.deepEqual(calls, [
    ["tasks.list", { state: "open" }],
    ["tasks.list", { state: "done", limit: 30 }],
    ["tasks.list", { state: "dropped", limit: 20 }],
  ]);
  tasks.taskChanged(task("updated"));
  tasks.taskDeleted("done");
  assert.equal(tasks.tasksLoaded(), true);
});

test("task mutations send exact fields, update cached state, and report failed destructive operations", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let response = task("task_1");
  const calls = mockRpc(t, {
    "tasks.create": () => response,
    "tasks.update": () => response,
    "tasks.close": () => response,
    "tasks.settle": () => response,
    "tasks.delete": {},
    "tasks.comment": {},
  });
  await tasks.createTask({ title: "Example", description: "A task" });
  response = task("task_1", "done");
  await tasks.updateTask("task_1", { title: "Updated" });
  await tasks.closeTask("task_1", "done");
  await tasks.settleTask("task_1", "renegotiated", "2026-02-01");
  assert.equal(await tasks.commentTask("task_1", "Progress"), true);
  assert.equal(await tasks.deleteTask("task_1"), true);
  assert.deepEqual(calls, [
    ["tasks.create", { title: "Example", description: "A task" }],
    ["tasks.update", { task: "task_1", title: "Updated" }],
    ["tasks.close", { task: "task_1", state: "done" }],
    ["tasks.settle", { task: "task_1", outcome: "renegotiated", due_at: "2026-02-01" }],
    ["tasks.comment", { task: "task_1", text: "Progress" }],
    ["tasks.delete", { task: "task_1" }],
  ]);
  mockRpc(t, { "tasks.delete": new Error("not allowed") });
  assert.equal(await tasks.deleteTask("task_1"), false);
});

test("task loading failure still ends the initial loading state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockRpc(t, { "tasks.list": new Error("offline") });
  await tasks.loadTasks();
  assert.equal(tasks.tasksLoaded(), true);
});

test("one-time task lookup resolves events and detail reads normalize optional collections", async (t) => {
  const lookedUp = task("old");
  const calls = mockRpc(t, {
    "tasks.get": ({ task: id }: { task: string }) =>
      id === "old" ? { task: lookedUp } : { task: lookedUp, events: [{ id: "ev_1" }], sessions: [] },
  });
  tasks.ensureTask("old");
  tasks.ensureTask("old");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.deepEqual(await tasks.taskDetail("old"), { consults: [], subtasks: [], usage: [] });
  assert.deepEqual(await tasks.taskDetail("with-detail"), {
    events: [{ id: "ev_1" }],
    sessions: [],
    consults: [],
    subtasks: [],
    usage: [],
  });
});

test("failed task detail and missing lookups degrade without throwing", async (t) => {
  mockRpc(t, { "tasks.get": new Error("offline") });
  tasks.ensureTask("missing");
  assert.deepEqual(await tasks.taskDetail("missing"), {
    events: [],
    sessions: [],
    consults: [],
    subtasks: [],
    usage: [],
  });
});
