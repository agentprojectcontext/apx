import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdmitFn } from "./engine.ts";
import { startHeld } from "./task-work.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** A task with an old work chat, and a coordinator's chat that held its start. */
function fixture(store: Parameters<typeof startHeld>[0]) {
  const task = store.tasks.create({
    title: "Existing work",
    description: "Continue this work",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Existing work", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const oldChat = store.threads.create({
    kind: "loose",
    title: "Previous work",
    task_id: task.id,
    agent_ids: ["vera"],
  });
  const old = store.runs.create({
    thread_id: oldChat.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Old work" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  store.runs.setState(old, "completed");
  const chat = store.threads.create({ kind: "loose", title: "Coordinator", agent_ids: ["superagent"] });
  const source = store.runs.create({
    thread_id: chat.id,
    agent_id: "superagent",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Continue" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  return { task, chat, source, old };
}

const admitting = (store: Parameters<typeof startHeld>[0]) => {
  const admitted = { count: 0 };
  const admit: AdmitFn = (a) => {
    admitted.count++;
    return store.runs.create({
      thread_id: a.thread_id,
      agent_id: a.agent_id,
      trigger: a.trigger,
      input: { origin: a.origin, text: a.text },
      deadline_at: "2099-01-01T00:00:00Z",
    });
  };
  return { admit, admitted };
};

test("a held start resumes once when nothing changed since the hold", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { task, chat, source, old } = fixture(store);
    store.threads.mergeContext(chat.id, {
      held: [
        {
          task: task.id,
          agent: "vera",
          run: source.id,
          depth: 1,
          prior_runs: [old.id],
          prior_events: store.tasks.events(task.id).length,
        },
      ],
    });
    const { admit, admitted } = admitting(store);
    assert.equal(startHeld(store, admit, [chat.id]), 1);
    assert.equal(startHeld(store, admit, [chat.id]), 0);
    assert.equal(admitted.count, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a held start does not resume after the owner changes its status meanwhile", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { task, chat, source, old } = fixture(store);
    store.threads.mergeContext(chat.id, {
      held: [
        {
          task: task.id,
          agent: "vera",
          run: source.id,
          depth: 1,
          prior_runs: [old.id],
          prior_events: store.tasks.events(task.id).length,
        },
      ],
    });
    store.tasks.change(task.id, { status: "review" }, "owner");
    const { admit, admitted } = admitting(store);
    assert.equal(startHeld(store, admit, [chat.id]), 0);
    assert.equal(admitted.count, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a held start does not resume when a new run started in an existing chat of the task", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { task, chat, source, old } = fixture(store);
    store.threads.mergeContext(chat.id, {
      held: [
        {
          task: task.id,
          agent: "vera",
          run: source.id,
          depth: 1,
          prior_runs: [old.id],
          prior_events: store.tasks.events(task.id).length,
        },
      ],
    });
    const oldChat = store.threads.byTask(task.id)[0];
    store.runs.create({
      thread_id: oldChat!.id,
      agent_id: "vera",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Newer work" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    const { admit, admitted } = admitting(store);
    assert.equal(startHeld(store, admit, [chat.id]), 0);
    assert.equal(admitted.count, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
