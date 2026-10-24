import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { createLog } from "../log.ts";
import { taskHandlers } from "../rpc/tasks.ts";
import { reworkTask } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

let release: () => void = () => {};
const held = new Promise<void>((resolve) => {
  release = resolve;
});
const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (system.startsWith("You are Vera")) {
    if (said.includes("Hold delivery")) await held;
    const task = /Task (task_\w+):/.exec(JSON.stringify(req.messages))?.[1] ?? "";
    return callTool("deliver", "task_close", { task, state: "done", note: "Delivery ready" });
  }
  if (said.includes("<task_result")) return say("Delivery received.");
  const correction = /Correct (task_\w+)/.exec(said);
  if (correction)
    return callTool("correct", "task_close", {
      task: correction[1],
      state: "open",
      rework: true,
      note: "Increase the contrast",
    });
  if (said.includes("Create delivery"))
    return callTool("create", "task_create", {
      title: "Delivery for rework",
      description: "Prepare the delivery for review.",
      assignee: "vera",
      status: "review",
    });
  return say("ok");
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  release();
  await env.core.close();
  await env.cleanup();
});

async function settled(thread: string, count: number) {
  for (let i = 0; i < 200; i++) {
    const detail = await env.client.call("threads.get", { thread });
    if (detail.runs.length >= count && detail.runs.every((r) => r.ended_at)) return detail;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Expected ${count} finished runs in ${thread}`);
}
const rejects = (operation: Promise<unknown>, message: RegExp) =>
  assert.rejects(operation, (error: unknown) => error instanceof ApxError && message.test(error.message));

async function closedTask(title = "Delivery") {
  const task = await env.client.call("tasks.create", {
    title,
    description: "Prepare the delivery for review.",
    assignee: "vera",
    status: "review",
  });
  const session = env.core.store.threads.byTask(task.id)[0];
  assert.ok(session);
  await settled(session.id, 1);
  assert.equal(env.core.store.tasks.get(task.id)?.state, "done");
  return { task, session };
}

test("a coordinator explicitly requests corrections from the same assignee and gets the second delivery", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Coordinator" });
  await env.client.call("threads.send", { thread: chat.id, text: "Create delivery" });
  await settled(chat.id, 2);
  const task = (await env.client.call("tasks.list", { state: "done" })).tasks.find(
    (t) => t.title === "Delivery for rework",
  );
  assert.ok(task);
  const session = env.core.store.threads.byTask(task.id)[0];
  assert.ok(session);
  await env.client.call("threads.send", { thread: chat.id, text: `Correct ${task.id}` });
  const creator = await settled(chat.id, 4);
  const worker = await settled(session.id, 2);
  assert.equal(worker.runs.length, 2);
  assert.equal(creator.runs.filter((r) => r.trigger === "a2a_result").length, 2);
  assert.equal(env.core.store.threads.byTask(task.id).length, 1);
  const detail = await env.client.call("tasks.get", { task: task.id });
  assert.equal(detail.task.state, "done");
  assert.equal(detail.task.status, "review");
  assert.equal(detail.task.assignee, "vera");
  assert.equal(detail.events.find((e) => e.op === "reopen")?.data.note, "Increase the contrast");
  const request = detail.events.find((e) => typeof e.data.rework_run_id === "string");
  const run = env.core.store.runs.get(String(request?.data.rework_run_id));
  assert.equal(run?.thread_id, session.id);
  assert.equal(run?.input?.origin.kind, "agent");
  assert.match(texts(worker.messages).join("\n"), /Corrections requested:\n\nIncrease the contrast/);
  const comments = await env.client.call("threads.get", { thread: task.thread_id });
  assert.match(texts(comments.messages).join("\n"), /Increase the contrast/);
});

test("plain reopening and ordinary updates never request work; unassigned tasks may still be reopened", async () => {
  const { task, session } = await closedTask();
  await env.client.call("tasks.close", { task: task.id, state: "open", note: "Administrative reopen" });
  await env.client.call("tasks.update", { task: task.id, description: "Updated", assignee: "vera" });
  assert.equal((await env.client.call("threads.get", { thread: session.id })).runs.length, 1);
  const unassigned = await env.client.call("tasks.create", { title: "Unassigned" });
  await env.client.call("tasks.close", { task: unassigned.id, state: "done" });
  const reopened = await env.client.call("tasks.close", { task: unassigned.id, state: "open" });
  assert.equal(reopened.state, "open");
  assert.deepEqual(env.core.store.threads.byTask(unassigned.id), []);
});

test("rework validates the reason, target state, assignee and closed-to-open transition without mutating history", async () => {
  const { task, session } = await closedTask();
  const events = env.core.store.tasks.events(task.id);
  for (const note of [undefined, "  "])
    await rejects(
      env.client.call("tasks.close", { task: task.id, state: "open", rework: true, note }),
      /requires a note/,
    );
  await rejects(
    env.client.call("tasks.close", { task: task.id, state: "done", rework: true, note: "Fix it" }),
    /state:open/,
  );
  assert.deepEqual(env.core.store.tasks.events(task.id), events);
  await env.client.call("tasks.update", { task: task.id, assignee: null });
  await rejects(
    env.client.call("tasks.close", { task: task.id, state: "open", rework: true, note: "Fix it" }),
    /requires an assignee/,
  );
  await env.client.call("tasks.close", { task: task.id, state: "open" });
  await rejects(
    env.client.call("tasks.close", { task: task.id, state: "open", rework: true, note: "Again" }),
    /closed task/,
  );
  assert.equal((await env.client.call("threads.get", { thread: session.id })).runs.length, 1);
});

test("active work prevents rework and idempotent retries cannot admit duplicate runs", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Hold delivery",
    description: "Prepare the delivery for review.",
    assignee: "vera",
  });
  const session = env.core.store.threads.byTask(task.id)[0];
  assert.ok(session);
  await env.client.call("tasks.close", { task: task.id, state: "done" });
  await rejects(
    env.client.call("tasks.close", { task: task.id, state: "open", rework: true, note: "Fix it" }),
    /still active/,
  );
  assert.equal(env.core.store.tasks.get(task.id)?.state, "done");
  release();
  await settled(session.id, 1);
  const requests = await Promise.allSettled(
    [1, 2].map(() =>
      env.client.call(
        "tasks.close",
        {
          task: task.id,
          state: "open",
          rework: true,
          note: "Fix it",
        },
        "retry-corrections",
      ),
    ),
  );
  assert.equal(requests.filter((r) => r.status === "fulfilled").length, 2);
  await settled(session.id, 2);
  assert.equal(env.core.store.runs.list(session.id).length, 2);
  assert.equal(env.core.store.tasks.events(task.id).filter((e) => e.data.rework_run_id).length, 1);
});

test("rework keeps project scope, hand-off permissions and paused limits", async () => {
  const { task } = await closedTask();
  const { store, engine } = env.core;
  const handlers = taskHandlers(store, engine, env.home);
  const caller = store.threads.create({ kind: "loose", title: "Caller", agent_ids: ["roby"] });
  const context = {
    transport: "internal" as const,
    role: "operator" as const,
    actor: "agent" as const,
    session: undefined,
    log: createLog("test", true),
    agent: { id: "roby", thread_id: caller.id, run_id: "test" },
  };
  store.projects.upsert({ id: "project_other", name: "Northwind" });
  const elsewhere = await env.client.call("tasks.create", { title: "Another project", project: "project_other" });
  await env.client.call("tasks.close", { task: elsewhere.id, state: "done" });
  assert.throws(
    () =>
      handlers["tasks.close"](
        { task: elsewhere.id, state: "open", rework: true, note: "Fix it" },
        {
          ...context,
          agent: { ...context.agent, id: "vera" },
        },
      ),
    /own project's tasks/,
  );
  const consult = store.threads.create({ kind: "a2a", title: "Consult", agent_ids: ["roby", "vera"] });
  assert.throws(
    () =>
      handlers["tasks.close"](
        { task: task.id, state: "open", rework: true, note: "Fix it" },
        {
          ...context,
          agent: { ...context.agent, thread_id: consult.id },
        },
      ),
    /answering/,
  );
  store.settings.write("agent_limits", { agents: { vera: { runs: 1, tokens: 0 } } });
  // A previous autonomous turn spends Vera's allowance in this caller's chain.
  const work = store.threads.byTask(task.id)[0];
  assert.ok(work);
  store.threads.mergeContext(work.id, { asked_from: caller.id });
  engine.admit({
    thread_id: work.id,
    agent_id: "vera",
    trigger: "a2a",
    text: "ok",
    origin: { kind: "agent", id: "roby", name: "Roby", thread_id: caller.id, run_id: "test" },
    depth: 1,
  });
  await settled(work.id, 2);
  await env.client.call("tasks.close", { task: task.id, state: "done" });
  try {
    assert.throws(
      () => handlers["tasks.close"]({ task: task.id, state: "open", rework: true, note: "Fix it" }, context),
      /paused/,
    );
    assert.equal(store.tasks.get(task.id)?.state, "done");
    store.settings.write("agent_limits", { runs: 1, tokens: 0 });
    assert.throws(
      () => handlers["tasks.close"]({ task: task.id, state: "open", rework: true, note: "Fix it" }, context),
      /paused/,
    );
    assert.equal(store.tasks.get(task.id)?.state, "done");
  } finally {
    store.settings.write("agent_limits", {});
  }
});

test("WebSocket rework and HTTP retries share the same idempotent request", async () => {
  const { task, session } = await closedTask();
  const socket = await env.client.connect();
  try {
    const params = { task: task.id, state: "open" as const, rework: true, note: "Correct the layout" };
    const reopened = await socket.call("tasks.close", params, "cross-transport-rework");
    const replayed = await env.client.call("tasks.close", params, "cross-transport-rework");
    assert.deepEqual(replayed, reopened);
    await settled(session.id, 2);
    assert.equal(env.core.store.runs.list(session.id).length, 2);
  } finally {
    socket.close();
  }
});

test("failed admission rolls back the reopen, reason and run link", async () => {
  const { task, session } = await closedTask();
  const store = env.core.store;
  const current = store.tasks.get(task.id);
  assert.ok(current);
  const events = store.tasks.events(task.id);
  const messages = store.messages.list(task.thread_id);
  const workMessages = store.messages.list(session.id);
  assert.throws(
    () =>
      reworkTask(
        store,
        () => {
          throw new Error("Admission failed");
        },
        current,
        "Fix it",
        { kind: "owner" },
      ),
    /Admission failed/,
  );
  assert.equal(store.tasks.get(task.id)?.state, "done");
  assert.deepEqual(store.tasks.events(task.id), events);
  assert.deepEqual(store.messages.list(task.thread_id), messages);
  assert.deepEqual(store.messages.list(session.id), workMessages);
});
