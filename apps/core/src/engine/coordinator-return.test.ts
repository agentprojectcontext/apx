import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { AdmitFn } from "./engine.ts";
import { tempDir } from "../testkit/platform.ts";
import { coordinatedTaskSource } from "./task-report.ts";
import { deliverToCoordinator, startTaskWork } from "./task-work.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** A coordinator's chat and run, and a task whose work that run started. */
function fixture(store: Parameters<typeof coordinatedTaskSource>[0]) {
  const chat = store.threads.create({ kind: "loose", title: "Coordinator", agent_ids: ["superagent"] });
  const source = store.runs.create({
    thread_id: chat.id,
    agent_id: "superagent",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Coordinate" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const taskThread = store.threads.create({ kind: "task", title: "Coordinated", agent_ids: ["vera"] });
  const task = store.tasks.create({
    title: "Coordinated",
    description: "Do it",
    status: "doing",
    assignee: "vera",
    thread_id: taskThread.id,
    by: "superagent",
  });
  const workChat = store.threads.create({ kind: "loose", title: "Work", task_id: task.id, agent_ids: ["vera"] });
  const work = store.runs.create({
    thread_id: workChat.id,
    agent_id: "vera",
    trigger: "system",
    input: {
      origin: { kind: "agent", id: "superagent", name: "Super", thread_id: chat.id, run_id: source.id },
      text: "Work",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  return { chat, source, task, work };
}

test("a task started by a verified coordinator reports back to that coordinator's chat", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { chat, source, task, work } = fixture(store);
    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: chat.id, run: source.id, work_run: work.id },
    });
    const found = coordinatedTaskSource(store, store.tasks.get(task.id)!);
    assert.equal(found?.thread, chat.id);
    assert.equal(found?.run.id, source.id);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a coordinator recorded for a run that did not start the work is not trusted", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { chat, task } = fixture(store);
    const unrelated = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Something else" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: chat.id, run: unrelated.id, work_run: "run_missing" },
    });
    assert.equal(coordinatedTaskSource(store, store.tasks.get(task.id)!), undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a project head that starts a task from its own chat is recorded as its coordinator", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const dir = tempDir("apx-coord-");
  try {
    const store = env.core.store;
    fs.writeFileSync(path.join(dir.path, "AGENTS.md"), "# Acme\n");
    const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
    const head = await env.client.call("agents.create", { project_id: project.id, slug: "acme-head", name: "Head" });
    const chat = store.threads.create({
      kind: "loose",
      title: "Head chat",
      agent_ids: [head.id],
      project_id: project.id,
    });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: head.id,
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Start it" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    const taskThread = store.threads.create({
      kind: "task",
      title: "Acme work",
      agent_ids: ["vera"],
      project_id: project.id,
    });
    const task = store.tasks.create({
      title: "Acme work",
      description: "Do it",
      project_id: project.id,
      assignee: "vera",
      status: "doing",
      thread_id: taskThread.id,
      by: head.id,
    });
    const admit: AdmitFn = (a) => {
      return store.runs.create({
        thread_id: a.thread_id,
        agent_id: a.agent_id,
        trigger: a.trigger,
        input: { origin: a.origin, text: a.text },
        deadline_at: "2099-01-01T00:00:00Z",
      });
    };
    const work = startTaskWork(store, admit, store.tasks.get(task.id)!, "vera", {
      kind: "agent",
      id: head.id,
      name: "Head",
      thread_id: chat.id,
      run_id: source.id,
      depth: 1,
    });
    assert.ok(work, "the task started");
    assert.equal(store.threads.context(taskThread.id).coordination_from?.thread, chat.id);
    assert.equal(coordinatedTaskSource(store, store.tasks.get(task.id)!)?.thread, chat.id);
  } finally {
    await env.core.close();
    await env.cleanup();
    await dir.remove();
  }
});

test("a review that sends a coordinated task back is told to its coordinator once, and only then", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { chat, source, task, work } = fixture(store);
    const reviewRun = store.runs.create({
      thread_id: work.thread_id,
      agent_id: "scout",
      trigger: "system",
      input: { origin: { kind: "routine", id: "review", name: "Review" }, text: "Review" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    const admitted: Array<{ thread_id: string; agent_id: string; origin: { kind: string } }> = [];
    const admit: AdmitFn = (a) => {
      admitted.push({ thread_id: a.thread_id, agent_id: a.agent_id, origin: a.origin });
      return store.runs.create({
        thread_id: a.thread_id,
        agent_id: a.agent_id,
        trigger: a.trigger,
        input: { origin: a.origin, text: a.text },
        deadline_at: "2099-01-01T00:00:00Z",
      });
    };
    const current = () => store.tasks.get(task.id)!;

    deliverToCoordinator(store, admit, current(), reviewRun, "Scout", "REVISE: fix the header");
    assert.equal(admitted.length, 0, "no coordinator recorded, nobody is told");

    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: chat.id, run: source.id, work_run: work.id },
    });
    deliverToCoordinator(store, admit, current(), reviewRun, "Scout", "REVISE: fix the header");
    deliverToCoordinator(store, admit, current(), reviewRun, "Scout", "REVISE: fix the header");
    assert.equal(admitted.length, 1, "the same review is told once");
    assert.equal(admitted[0]?.thread_id, chat.id);
    assert.equal(admitted[0]?.origin.kind, "task_feedback");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
