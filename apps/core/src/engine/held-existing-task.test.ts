import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdmitFn } from "./engine.ts";
import { startHeld } from "./task-work.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("releasing a held existing task with an old work chat starts it exactly once", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    const chat = store.threads.create({ kind: "loose", title: "Coordinator", agent_ids: ["superagent"] });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Continue" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.threads.mergeContext(chat.id, {
      held: [{ task: task.id, agent: "vera", run: source.id, depth: 1, prior_runs: [old.id] }],
    });
    let admitted = 0;
    const admit: AdmitFn = (a) => {
      admitted++;
      return store.runs.create({
        thread_id: a.thread_id,
        agent_id: a.agent_id,
        trigger: a.trigger,
        input: { origin: a.origin, text: a.text },
        deadline_at: "2099-01-01T00:00:00Z",
      });
    };
    assert.equal(startHeld(store, admit, [chat.id]), 1);
    assert.equal(startHeld(store, admit, [chat.id]), 0);
    assert.equal(admitted, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a held start is not duplicated if another execution started meanwhile", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const task = store.tasks.create({
      title: "Work",
      description: "Verify work",
      status: "doing",
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Work", agent_ids: ["vera"] }).id,
      by: "superagent",
    });
    const chat = store.threads.create({ kind: "loose", title: "Coordinator", agent_ids: ["superagent"] });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Work" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.threads.mergeContext(chat.id, {
      held: [{ task: task.id, agent: "vera", run: source.id, depth: 1, prior_runs: [] }],
    });
    const workChat = store.threads.create({
      kind: "loose",
      title: "Already started",
      task_id: task.id,
      agent_ids: ["vera"],
    });
    const work = store.runs.create({
      thread_id: workChat.id,
      agent_id: "vera",
      trigger: "a2a",
      input: {
        origin: { kind: "agent", id: "superagent", name: "Lead", thread_id: chat.id, run_id: source.id },
        text: "Work",
      },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    assert.equal(store.runs.latestId(workChat.id), work.id);
    let admitted = 0;
    const admit: AdmitFn = () => {
      admitted++;
      throw new Error("must not admit a duplicate");
    };
    assert.equal(startHeld(store, admit, [chat.id]), 0);
    assert.equal(admitted, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("legacy held records without a snapshot fail closed when an old task chat exists", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const task = store.tasks.create({
      title: "Legacy work",
      description: "Verify work",
      status: "doing",
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Legacy work", agent_ids: ["vera"] }).id,
      by: "superagent",
    });
    store.threads.create({ kind: "loose", title: "Old chat", task_id: task.id, agent_ids: ["vera"] });
    const chat = store.threads.create({ kind: "loose", title: "Coordinator", agent_ids: ["superagent"] });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Work" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.threads.mergeContext(chat.id, { held: [{ task: task.id, agent: "vera", run: source.id, depth: 1 }] });
    const admit: AdmitFn = () => {
      throw new Error("legacy origin must not start");
    };
    assert.equal(startHeld(store, admit, [chat.id]), 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("released coordinator work records its source only after the execution starts", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store,
      project = "held-project",
      lead = "held-lead",
      worker = "held-worker";
    store.projects.upsert({ id: project, name: "Held" });
    store.agents.upsertApc({
      id: lead,
      name: "Held Lead",
      project_id: project,
      slug: "lead",
      role: "Lead",
      prompt: "",
      extra: { orchestrator: true },
    });
    store.agents.upsertApc({
      id: worker,
      name: "Held Worker",
      project_id: project,
      parent: lead,
      slug: "worker",
      role: "Worker",
      prompt: "",
      extra: {},
    });
    const task = store.tasks.create({
      title: "Held task",
      description: "Perform work",
      status: "doing",
      project_id: project,
      assignee: worker,
      thread_id: store.threads.create({ kind: "task", title: "Held task", project_id: project, agent_ids: [lead] }).id,
      by: lead,
    });
    const chat = store.threads.create({ kind: "loose", title: "Coordinator", project_id: project, agent_ids: [lead] });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: lead,
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Work" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.threads.mergeContext(chat.id, {
      held: [
        {
          task: task.id,
          agent: worker,
          run: source.id,
          depth: 1,
          prior_runs: [],
          coordination: { root_run: source.id },
        },
      ],
    });
    const admit: AdmitFn = (a) =>
      store.runs.create({
        thread_id: a.thread_id,
        agent_id: a.agent_id,
        trigger: a.trigger,
        input: { origin: a.origin, text: a.text },
        deadline_at: "2099-01-01T00:00:00Z",
      });
    assert.equal(store.threads.context(task.thread_id).coordination_from, undefined);
    assert.equal(startHeld(store, admit, [chat.id]), 1);
    const recorded = store.threads.context(task.thread_id).coordination_from;
    assert.equal(recorded?.run, source.id);
    const { coordinatedTaskSource } = await import("./task-report.ts");
    assert.equal(coordinatedTaskSource(store, task)?.run.id, source.id);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a paused reassignment snapshots old runs and resumes once after the budget is released", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    await env.client.call("agents.set_limits", { runs: 1, tokens: 0 });
    const task = store.tasks.create({
      title: "Previously worked",
      description: "Continue work",
      status: "doing",
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Previously worked", agent_ids: ["vera"] }).id,
      by: "superagent",
    });
    const oldChat = store.threads.create({ kind: "loose", title: "Old work", task_id: task.id, agent_ids: ["vera"] });
    const old = store.runs.create({
      thread_id: oldChat.id,
      agent_id: "vera",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Earlier" },
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    const spent = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "a2a",
      input: {
        origin: { kind: "agent", id: "vera", name: "Vera", thread_id: oldChat.id, run_id: old.id },
        text: "Prior turn",
      },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.runs.setState(spent, "completed");
    let admitted = 0;
    const admit: AdmitFn = (a) => {
      admitted++;
      return store.runs.create({
        thread_id: a.thread_id,
        agent_id: a.agent_id,
        trigger: a.trigger,
        input: { origin: a.origin, text: a.text },
        deadline_at: "2099-01-01T00:00:00Z",
      });
    };
    const { startTaskWork } = await import("./task-work.ts");
    assert.equal(
      startTaskWork(store, admit, task, "vera", {
        kind: "agent",
        id: "superagent",
        name: "Lead",
        thread_id: chat.id,
        run_id: source.id,
        depth: 1,
      }),
      undefined,
    );
    assert.deepEqual(store.threads.context(chat.id).held?.[0]?.prior_runs, [old.id]);
    await env.client.call("agents.set_limits", { runs: 0, tokens: 0 });
    assert.equal(startHeld(store, admit, [chat.id]), 1);
    assert.equal(startHeld(store, admit, [chat.id]), 0);
    assert.equal(admitted, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a held start is not revived after the owner changes and restores the assignment", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const task = store.tasks.create({
      title: "Changed assignment",
      description: "Verify work",
      status: "doing",
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Changed assignment", agent_ids: ["vera"] }).id,
      by: "superagent",
    });
    const chat = store.threads.create({ kind: "loose", title: "Coordinator", agent_ids: ["superagent"] });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Work" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    store.threads.mergeContext(chat.id, {
      held: [
        {
          task: task.id,
          agent: "vera",
          run: source.id,
          depth: 1,
          prior_runs: [],
          prior_events: store.tasks.events(task.id).length,
        },
      ],
    });
    store.tasks.change(task.id, { assignee: null }, "owner");
    store.tasks.change(task.id, { assignee: "vera" }, "owner");
    const admit: AdmitFn = () => {
      throw new Error("stale assignment must not start");
    };
    assert.equal(startHeld(store, admit, [chat.id]), 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
