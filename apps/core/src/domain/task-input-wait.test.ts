import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { createInputDelivery } from "../engine/input-delivery.ts";
import { createInputs } from "../engine/inputs.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import {
  awaitTaskInput,
  commentTaskWait,
  manualTaskWait,
  settleTaskInput,
  taskInputIsCurrent,
} from "./task-input-wait.ts";

async function fixture(t: TestContext) {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready.")) });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await env.core.close();
    await env.cleanup();
  };
  t.after(close);
  const store = env.core.store;
  const task = await env.client.call("tasks.create", {
    title: "Draft choices",
    description: "Collect two choices.",
    status: "review",
  });
  store.tasks.change(task.id, { assignee: "superagent" }, "owner");
  const thread = store.threads.create({
    kind: "loose",
    title: "Draft work",
    task_id: task.id,
    agent_ids: ["superagent"],
  });
  const run = store.runs.create({
    thread_id: thread.id,
    agent_id: "superagent",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Prepare the draft." },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.runs.setState(run, "completed");
  let serial = 0;
  const input = (kind: "question" | "confirm" = "question") =>
    store.inputs.create({
      run_id: run.id,
      thread_id: thread.id,
      agent_id: "superagent",
      call_id: `question-${++serial}`,
      kind,
      ...(kind === "confirm" ? { approval: { key: "shell.delete", group: "shell" }, tool: "shell" } : {}),
      prompt: kind === "confirm" ? "Remove the draft?" : "Which draft choice?",
      waitMs: 60_000,
    });
  const current = () => {
    const value = store.tasks.get(task.id);
    assert.ok(value);
    return value;
  };
  const answer = (id: string) => {
    const settled = store.inputs.settle(id, "answered", "Blue") ?? store.inputs.get(id);
    assert.ok(settled);
    settleTaskInput(store, settled);
  };
  return {
    ...env,
    store,
    task,
    thread,
    input,
    current,
    answer,
    close,
  };
}

test("independent native waits settle by identity and repeated events cannot release another wait", async (t) => {
  const f = await fixture(t);
  try {
    const first = f.input();
    const second = f.input();
    f.store.tx(() => {
      awaitTaskInput(f.store, first);
      awaitTaskInput(f.store, second);
      awaitTaskInput(f.store, first);
    });
    assert.equal(f.current().awaits_owner, true);
    assert.equal(f.store.threads.context(f.task.thread_id).task_input_wait?.inputs.length, 2);
    f.store.tx(() => {
      f.answer(first.id);
      f.answer(first.id);
    });
    assert.equal(f.current().awaits_owner, true);
    assert.equal(
      f.core.engine.releaseTaskInputs(f.task.id),
      0,
      "one answer cannot run through another unresolved wait",
    );
    assert.equal(f.store.runs.list(f.thread.id).length, 1);
    f.store.tx(() => f.answer(second.id));
    assert.equal(f.current().awaits_owner, false);
    assert.equal(f.current().status, "review", "an answer cannot bypass a review");
    assert.equal(f.current().state, "open");
    assert.equal(f.core.engine.releaseTaskInputs(f.task.id), 2);
    await f.settle(f.thread.id);
    assert.equal(f.store.runs.list(f.thread.id).filter((r) => r.input?.origin.kind === "input_answer").length, 1);
    assert.equal(f.core.engine.releaseTaskInputs(f.task.id), 0);
  } finally {
    await f.close();
  }
});

test("a manual blocker predating a card survives, and an optional untracked answer cannot release it", async (t) => {
  const f = await fixture(t);
  try {
    f.store.tasks.change(f.task.id, { awaits_owner: true }, "owner");
    const first = f.input();
    awaitTaskInput(f.store, first);
    f.answer(first.id);
    f.answer(f.input().id);
    assert.equal(f.current().awaits_owner, true);
    assert.equal(f.store.threads.context(f.task.thread_id).task_input_wait?.manual, true);
  } finally {
    await f.close();
  }
});

test("client-owned sessions and consultants cannot attach a task wait", async (t) => {
  const f = await fixture(t);
  try {
    f.store.threads.mergeContext(f.thread.id, { client: "external-app" });
    awaitTaskInput(f.store, f.input());
    assert.equal(f.current().awaits_owner, false);
    f.store.threads.mergeContext(f.thread.id, {
      client: undefined,
      consult: { task: f.task.id, card: "consult-card" },
    });
    awaitTaskInput(f.store, f.input());
    assert.equal(f.current().awaits_owner, false);
    assert.equal(f.store.threads.context(f.task.thread_id).task_input_wait, undefined);
  } finally {
    await f.close();
  }
});

test("an answer from a previous assignee cannot release the new assignment's wait", async (t) => {
  const f = await fixture(t);
  try {
    const first = f.input();
    awaitTaskInput(f.store, first);
    f.store.tasks.change(f.task.id, { assignee: null }, "owner");
    f.answer(first.id);
    assert.equal(f.current().awaits_owner, true);
  } finally {
    await f.close();
  }
});

test("a comment reply removes only comment attention, not a native card or manual privacy hold", async (t) => {
  const f = await fixture(t);
  try {
    assert.equal(commentTaskWait(f.store, f.current(), true), true);
    f.store.tasks.change(f.task.id, { awaits_owner: true }, "system");
    const first = f.input();
    awaitTaskInput(f.store, first);
    assert.equal(commentTaskWait(f.store, f.current(), false), true);
    f.store.inputs.settle(first.id, "answered", "Blue");
    f.answer(first.id);
    assert.equal(f.current().awaits_owner, false);
    const manual = manualTaskWait(f.store, f.current(), true);
    f.store.tasks.change(f.task.id, { awaits_owner: manual }, "owner");
    commentTaskWait(f.store, f.current(), true);
    assert.equal(commentTaskWait(f.store, f.current(), false), true);
  } finally {
    await f.close();
  }
});

test("reassignment to the same agent invalidates old cards and cannot grant or admit stale work", async (t) => {
  const f = await fixture(t);
  const first = f.input("confirm");
  awaitTaskInput(f.store, first);
  f.store.tasks.change(f.task.id, { assignee: "superagent" }, "owner");
  assert.equal(taskInputIsCurrent(f.store, first), false);
  assert.throws(() => f.core.engine.respond(first.id, { decision: "approve", scope: "always" }), {
    shape: {
      code: "conflict",
      message: "This request is no longer available.",
      detail: { reason: "input_unavailable" },
    },
  });
  assert.equal(f.store.inputs.get(first.id)?.state, "expired");
  assert.equal(
    f.store.approvals.list(f.thread.id).some((grant) => grant.key === "shell.delete"),
    false,
  );
  assert.equal(f.current().awaits_owner, true);
  assert.equal(f.store.runs.list(f.thread.id).length, 1);
  assert.equal(manualTaskWait(f.store, f.current(), false), false, "explicit release can discard a stale wait");
});

test("closing and reopening a task starts a fresh wait cycle without reviving an old card", async (t) => {
  const f = await fixture(t);
  const first = f.input();
  awaitTaskInput(f.store, first);
  f.store.tasks.change(f.task.id, { state: "done", awaits_owner: false }, "owner");
  f.store.tasks.change(f.task.id, { state: "open", awaits_owner: false }, "owner");
  const second = f.input();
  awaitTaskInput(f.store, second);
  assert.equal(taskInputIsCurrent(f.store, first), false);
  assert.equal(taskInputIsCurrent(f.store, second), true);
  assert.throws(() => f.core.engine.respond(first.id, { text: "Red" }), /no longer available/);
  assert.equal(f.current().awaits_owner, true);
  f.answer(second.id);
  assert.equal(f.current().awaits_owner, false);
  assert.equal(f.current().state, "open");
  assert.equal(f.core.engine.releaseTaskInputs(f.task.id), 1);
  await f.settle(f.thread.id);
  assert.equal(f.store.threads.context(f.thread.id).task_inputs?.[second.id], undefined);
});

test("a listener notification stays durable until consumption, so losing the listener cannot lose the owner's answer", async (t) => {
  const f = await fixture(t);
  const input = f.input();
  awaitTaskInput(f.store, input);
  f.answer(input.id);
  const record = f.store.inputs.get(input.id);
  assert.ok(record);
  let notified = 0;
  const delivery = createInputDelivery({
    store: f.store,
    admit: f.core.engine.admit,
    pauseWait: new Map(),
    settleCard: () => undefined,
    waiting: new Map([
      [
        input.id,
        () => {
          notified++;
        },
      ],
    ]),
  });
  delivery.deliver(record);
  assert.equal(notified, 1);
  assert.equal(f.store.runs.list(f.thread.id).length, 1);
  assert.equal(f.store.threads.context(f.thread.id).task_inputs?.[input.id]?.delivery, input.run_id);
  // The engine instance has no live listener, as after a process loss before consumption.
  assert.equal(f.core.engine.releaseTaskInputs(f.task.id), 1);
  await f.settle(f.thread.id);
  assert.equal(f.store.runs.list(f.thread.id).filter((r) => r.input?.origin.kind === "input_answer").length, 1);
  assert.equal(f.core.engine.releaseTaskInputs(f.task.id), 0);
});

test("failed wake admission rolls back both the answer and the task transition, so a retry cannot lose work", async (t) => {
  const f = await fixture(t);
  try {
    const first = f.input();
    awaitTaskInput(f.store, first);
    const failed = createInputs({
      store: f.store,
      home: f.home,
      hold: () => () => undefined,
      admit: () => {
        throw new Error("admission unavailable");
      },
    });
    assert.throws(() => failed.respond(first.id, { text: "Blue" }), /admission unavailable/);
    assert.equal(f.store.inputs.get(first.id)?.state, "pending");
    assert.equal(f.current().awaits_owner, true);
    assert.deepEqual(f.store.threads.context(f.task.thread_id).task_input_wait?.inputs, [first.id]);
    f.core.engine.respond(first.id, { text: "Blue" });
    await f.settle(f.thread.id);
    assert.equal(f.store.inputs.get(first.id)?.state, "answered");
    assert.equal(f.current().awaits_owner, false);
    assert.equal(f.store.runs.list(f.thread.id).filter((r) => r.input?.origin.kind === "input_answer").length, 1);
  } finally {
    await f.close();
  }
});
