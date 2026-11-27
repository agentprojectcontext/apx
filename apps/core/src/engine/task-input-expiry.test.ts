import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const model = scriptedLlm((req, { afterTool, said }) =>
  afterTool || req.messages.some((m) => m.role === "tool") || said.includes("Their answer:")
    ? say("Noted.")
    : callTool("choice", "ask_owner", { question: "Which draft should I use?" }),
);

test("closing a task retires the card in chat history and a new assignment can still be answered", async (t) => {
  const env = await startCore({ llm: model });
  t.after(async () => {
    await env.core.close();
    await env.cleanup();
  });
  const task = await env.client.call("tasks.create", {
    title: "Draft choice",
    description: "Ask which draft to use.",
    assignee: "superagent",
    status: "doing",
  });
  const findInput = async (except?: string) => {
    let found: Awaited<ReturnType<typeof pending>>[number] | undefined;
    const pending = async () => (await env.client.call("runs.pending", {})).inputs;
    await waitFor(async () => {
      found = (await pending()).find(({ id }) => id !== except);
      return Boolean(found);
    }, "pending task question");
    assert.ok(found);
    return found;
  };
  const old = await findInput();
  const updates: string[] = [];
  const unsub = env.core.bus.on((event) => {
    if (event.type !== "message.updated") return;
    for (const part of event.message.parts) {
      if (part.type === "input" && part.input_id === old.id) updates.push(part.state);
    }
  });
  t.after(unsub);
  await env.client.call("tasks.close", { task: task.id, state: "done" });
  const { messages } = await env.client.call("threads.get", { thread: old.thread_id });
  const card = messages
    .flatMap((message) => message.parts)
    .find((part) => part.type === "input" && part.input_id === old.id);
  assert.ok(card?.type === "input");
  assert.equal(card.state, "expired");
  assert.equal(card.prompt, old.prompt);
  assert.ok(updates.includes("expired"));
  assert.deepEqual((await env.client.call("runs.pending", {})).inputs, []);
  await assert.rejects(env.client.call("runs.respond", { input: old.id, text: "Old answer" }), (error: unknown) => {
    assert.ok(error instanceof ApxError);
    assert.equal(error.code, "conflict");
    assert.deepEqual(error.detail, { reason: "input_unavailable" });
    return true;
  });
  assert.equal(env.core.store.inputs.get(old.id)?.answer, undefined);
  await env.settle(old.thread_id);
  assert.equal(env.core.store.runs.get(old.run_id)?.state, "canceled");
  assert.equal(
    env.core.store.runs.list(old.thread_id).some((run) => run.input?.origin.kind === "input_answer"),
    false,
  );
  const freshTask = await env.client.call("tasks.create", {
    title: "New draft choice",
    description: "Ask which new draft to use.",
    assignee: "superagent",
    status: "doing",
  });
  const fresh = await findInput(old.id);
  assert.equal(env.core.store.threads.get(fresh.thread_id)?.task_id, freshTask.id);
  assert.equal((await env.client.call("runs.respond", { input: fresh.id, text: "New answer" })).state, "answered");
  await env.settle(fresh.thread_id);
  assert.equal(env.core.store.tasks.get(freshTask.id)?.awaits_owner, false);
});

test("boot repairs cards that were still pending when an earlier core closed their task", async () => {
  const first = await startCore({ llm: model });
  let firstClosed = false;
  let next: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const task = await first.client.call("tasks.create", {
      title: "Draft choice before restart",
      description: "Collect a decision.",
      assignee: "superagent",
      status: "doing",
    });
    const readPending = async () => (await first.client.call("runs.pending", {})).inputs[0];
    await waitFor(async () => Boolean(await readPending()), "pending before shutdown");
    const old = await readPending();
    assert.ok(old);
    await first.core.close();
    firstClosed = true;
    const db = openDb(first.home);
    try {
      const offline = createStore(db, createBus());
      offline.tasks.change(task.id, { state: "done", awaits_owner: false }, "owner");
      assert.equal(offline.inputs.get(old.id)?.state, "pending");
    } finally {
      db.close();
    }
    next = await startCore({ home: first.home, llm: model });
    const saved = await next.client.call("threads.get", { thread: old.thread_id });
    assert.ok(
      saved.messages
        .flatMap((m) => m.parts)
        .some((p) => p.type === "input" && p.input_id === old.id && p.state === "expired"),
    );
    assert.deepEqual((await next.client.call("runs.pending", {})).inputs, []);
    assert.equal(
      saved.runs.some((r) => r.input?.origin.kind === "input_answer"),
      false,
    );
  } finally {
    if (next) await next.core.close();
    if (!firstClosed) await first.core.close();
    await first.cleanup();
  }
});
