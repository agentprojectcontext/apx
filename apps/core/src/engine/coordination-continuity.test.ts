import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const ownerCreated of [false, true]) {
  test(`a coordinator continues after a ${ownerCreated ? "owner" : "teammate"}-created task`, async () => {
    let first = "",
      second = "";
    const project = "continuity-project",
      lead = "continuity-lead",
      worker = "continuity-worker";
    const llm = scriptedLlm((req, { system, said, afterTool }) => {
      if (afterTool) return say("Step completed.");
      if (system.startsWith("You are Continuity Lead")) {
        if (said.includes("<task_result") && said.includes(first))
          return callTool("next", "task_update", { task: second, assignee: worker });
        if (!said.includes("<task_result")) return callTool("first", "task_update", { task: first, assignee: worker });
        return say("All delivered.");
      }
      if (system.startsWith("You are Continuity Worker")) {
        const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
        return callTool("close", "task_close", { task, state: "done", note: "Completed and verified." });
      }
      return say("ok");
    });
    const env = await startCore({ llm });
    try {
      const store = env.core.store;
      store.projects.upsert({ id: project, name: "Continuity" });
      store.agents.upsertApc({
        id: lead,
        name: "Continuity Lead",
        project_id: project,
        slug: "lead",
        role: "Lead",
        prompt: "",
        extra: { orchestrator: true },
      });
      store.agents.upsertApc({
        id: worker,
        name: "Continuity Worker",
        project_id: project,
        parent: lead,
        slug: "worker",
        role: "Worker",
        prompt: "",
        extra: {},
      });
      const old = (title: string, parent?: string) =>
        store.tasks.create({
          title,
          status: "todo",
          project_id: project,
          parent_id: parent,
          thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
          by: worker,
        });
      const a = old("Historical root"),
        b = old("Historical stage", a.id),
        c = old("Historical work", b.id);
      const ready = (title: string) =>
        store.tasks.create({
          title,
          description: "Perform and verify bounded work.",
          status: "doing",
          project_id: project,
          parent_id: c.id,
          assignee: lead,
          thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
          by: ownerCreated ? "owner" : worker,
        });
      first = ready("First task").id;
      second = ready("Second task").id;
      const chat = await env.client.call("threads.create", {
        kind: "loose",
        title: "Coordinate",
        agent_id: lead,
        project_id: project,
      });
      await env.client.call("threads.send", { thread: chat.id, text: "Coordinate ready work." });
      await waitFor(
        () => store.tasks.get(second)?.state === "done",
        "coordinator dispatches the second task after the result",
      );
      assert.equal(store.tasks.get(first)?.state, "done");
      assert.notEqual(store.tasks.get(second)?.proposed, true);
      await waitFor(
        () =>
          store.runs.list(chat.id, 20).filter((r) => r.input?.origin.kind === "task_result" && r.state === "completed")
            .length >= 2,
        "both results reach the coordinator",
      );
      assert.equal(store.runs.list(chat.id, 20).filter((r) => r.input?.origin.kind === "task_result").length, 2);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("coordination reports require the exact same-project task execution provenance", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const project = "provenance-project";
    store.projects.upsert({ id: project, name: "Provenance" });
    const task = store.tasks.create({
      title: "Work",
      description: "Verify work",
      status: "doing",
      project_id: project,
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Work", project_id: project, agent_ids: ["vera"] }).id,
      by: "superagent",
    });
    const chat = store.threads.create({
      kind: "loose",
      title: "Coordinator",
      project_id: project,
      agent_ids: ["superagent"],
    });
    const source = store.runs.create({
      thread_id: chat.id,
      agent_id: "superagent",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Coordinate" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    const workChat = store.threads.create({
      kind: "loose",
      title: "Work",
      project_id: project,
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
    const { coordinatedTaskSource } = await import("./task-report.ts");
    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: chat.id, run: source.id, work_run: work.id },
    });
    assert.equal(coordinatedTaskSource(store, task)?.run.id, source.id);
    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: chat.id, run: source.id, work_run: "missing" },
    });
    assert.equal(coordinatedTaskSource(store, task), undefined);
    const wrong = store.threads.create({ kind: "loose", title: "Outside project", agent_ids: ["superagent"] });
    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: wrong.id, run: source.id, work_run: work.id },
    });
    assert.equal(coordinatedTaskSource(store, task), undefined);
    store.threads.mergeContext(task.thread_id, {
      coordination_from: { thread: chat.id, run: source.id, work_run: work.id },
    });
    await env.client.call("tasks.update", { task: task.id, assignee: null });
    assert.equal(
      store.threads.context(task.thread_id).coordination_from,
      undefined,
      "owner unassignment revokes the old coordinator",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a coordinator can continue across many completed independent tasks without exhausting historical lineage", async () => {
  const project = "long-project",
    lead = "long-lead",
    worker = "long-worker";
  const tasks: string[] = [];
  const llm = scriptedLlm((req, { system, said, afterTool }) => {
    if (afterTool) return say("Step completed.");
    if (system.startsWith("You are Long Lead")) {
      const n = said.includes("<task_result") ? tasks.findIndex((id) => said.includes(id)) + 1 : 0;
      return n >= 0 && n < tasks.length
        ? callTool(`next-${n}`, "task_update", { task: tasks[n], assignee: worker })
        : say("All delivered.");
    }
    if (system.startsWith("You are Long Worker")) {
      const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
      return callTool("close", "task_close", { task, state: "done", note: "Completed and verified." });
    }
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const store = env.core.store;
    store.projects.upsert({ id: project, name: "Long project" });
    store.agents.upsertApc({
      id: lead,
      name: "Long Lead",
      project_id: project,
      slug: "lead",
      role: "Lead",
      prompt: "",
      extra: { orchestrator: true },
    });
    store.agents.upsertApc({
      id: worker,
      name: "Long Worker",
      project_id: project,
      parent: lead,
      slug: "worker",
      role: "Worker",
      prompt: "",
      extra: {},
    });
    const old = (title: string, parent?: string) =>
      store.tasks.create({
        title,
        status: "todo",
        project_id: project,
        parent_id: parent,
        thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
        by: worker,
      });
    const a = old("Historical root"),
      b = old("Historical stage", a.id),
      c = old("Historical work", b.id);
    for (let i = 0; i < 35; i++)
      tasks.push(
        store.tasks.create({
          title: `Task ${i}`,
          description: "Perform and verify bounded work.",
          status: "doing",
          project_id: project,
          parent_id: c.id,
          assignee: lead,
          thread_id: store.threads.create({ kind: "task", title: `Task ${i}`, project_id: project, agent_ids: [lead] })
            .id,
          by: worker,
        }).id,
      );
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      title: "Coordinate",
      agent_id: lead,
      project_id: project,
    });
    await env.client.call("threads.send", { thread: chat.id, text: "Coordinate ready work." });
    await waitFor(() => store.tasks.get(tasks.at(-1) ?? "")?.state === "done", "all independent tasks finish", {
      ms: 20000,
    });
    assert.equal(tasks.filter((id) => store.tasks.get(id)?.state === "done").length, tasks.length);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a long series of coordinator-created tasks retains verified authority for later existing work", async () => {
  const project = "created-long-project",
    lead = "created-long-lead",
    worker = "created-long-worker";
  let completed = 0,
    last = "";
  const llm = scriptedLlm((req, { system, said, afterTool }) => {
    if (afterTool) return say("Step completed.");
    if (system.startsWith("You are Created Long Lead")) {
      if (said.includes("<task_result")) completed++;
      return completed < 34
        ? callTool(`create-${completed}`, "task_create", {
            title: `Created work ${completed}`,
            description: "Perform and verify.",
            status: "doing",
            assignee: worker,
          })
        : completed === 34
          ? callTool("last", "task_update", { task: last, assignee: worker })
          : say("All delivered.");
    }
    if (system.startsWith("You are Created Long Worker")) {
      const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
      return callTool("close", "task_close", { task, state: "done", note: "Completed and verified the test output." });
    }
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const store = env.core.store;
    store.projects.upsert({ id: project, name: "Created long project" });
    for (const [id, name, parent, head] of [
      [lead, "Created Long Lead", undefined, true],
      [worker, "Created Long Worker", lead, false],
    ] as const)
      store.agents.upsertApc({
        id,
        name,
        parent,
        project_id: project,
        slug: id,
        role: name,
        prompt: "",
        extra: head ? { orchestrator: true } : {},
      });
    const old = (title: string, parent?: string) =>
      store.tasks.create({
        title,
        status: "todo",
        project_id: project,
        parent_id: parent,
        thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
        by: worker,
      });
    const a = old("History"),
      b = old("Phase", a.id),
      c = old("Branch", b.id);
    const task = store.tasks.create({
      title: "Existing last task",
      description: "Verify.",
      status: "doing",
      project_id: project,
      parent_id: c.id,
      assignee: lead,
      thread_id: store.threads.create({
        kind: "task",
        title: "Existing last task",
        project_id: project,
        agent_ids: [lead],
      }).id,
      by: worker,
    });
    last = task.id;
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      title: "Coordinate",
      agent_id: lead,
      project_id: project,
    });
    await env.client.call("threads.send", { thread: chat.id, text: "Coordinate work." });
    await waitFor(() => store.tasks.get(last)?.state === "done", "next work after 34 created tasks", { ms: 12000 });
    assert.notEqual(store.tasks.get(last)?.proposed, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a worker escalates, the coordinator resolves and the worker resumes the same task", async () => {
  const project = "roundtrip-project",
    lead = "roundtrip-lead",
    worker = "roundtrip-worker";
  let task = "",
    workerTurns = 0;
  const llm = scriptedLlm((_req, { system, afterTool }) => {
    if (afterTool) return say("Done for now.");
    if (system.startsWith("You are Roundtrip Lead"))
      return callTool("assign", "task_update", { task, assignee: worker });
    if (system.startsWith("You are Roundtrip Worker")) {
      workerTurns++;
      return workerTurns === 1
        ? callTool("escalate", "task_update", { task, assignee: lead })
        : callTool("finish", "task_close", { task, state: "done", note: "Completed and verified." });
    }
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const store = env.core.store;
    store.projects.upsert({ id: project, name: "Roundtrip" });
    store.agents.upsertApc({
      id: lead,
      name: "Roundtrip Lead",
      project_id: project,
      slug: "lead",
      role: "Lead",
      prompt: "",
      extra: { orchestrator: true },
    });
    store.agents.upsertApc({
      id: worker,
      name: "Roundtrip Worker",
      project_id: project,
      parent: lead,
      slug: "worker",
      role: "Worker",
      prompt: "",
      extra: {},
    });
    task = store.tasks.create({
      title: "Roundtrip work",
      description: "Perform bounded work.",
      status: "doing",
      project_id: project,
      assignee: lead,
      thread_id: store.threads.create({ kind: "task", title: "Task", project_id: project, agent_ids: [lead] }).id,
      by: worker,
    }).id;
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      title: "Coordinate",
      agent_id: lead,
      project_id: project,
    });
    await env.client.call("threads.send", { thread: chat.id, text: "Continue." });
    await waitFor(() => store.tasks.get(task)?.state === "done", "worker resumes and completes the original task");
    assert.notEqual(store.tasks.get(task)?.proposed, true);
    assert.equal(workerTurns, 2);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
