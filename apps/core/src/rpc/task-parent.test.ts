import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";

const context = (thread: string) => ({
  role: "operator" as const,
  actor: "agent" as const,
  transport: "internal" as const,
  session: undefined,
  log: createLog("test", true),
  agent: { id: "superagent", thread_id: thread, run_id: "run_test" },
});

test("existing tasks regroup and detach over HTTP/WS without losing history or starting work again", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Complete.")) });
  const ws = await env.client.connect();
  try {
    const parent = await env.client.call("tasks.create", { title: "Prepare delivery" });
    const child = await env.client.call("tasks.create", {
      title: "Review delivery",
      description: "Review the delivery.",
      assignee: "vera",
    });
    const session = env.core.store.threads.byTask(child.id)[0];
    assert.ok(session);
    await env.settle(session.id);
    await env.client.call("tasks.comment", { task: child.id, text: "Keep this evidence." });
    const before = await env.client.call("tasks.get", { task: child.id });
    const runs = env.core.store.runs.list(session.id).map((r) => r.id);
    const linked = await env.client.call("tasks.update", { task: child.id, parent: parent.id });
    assert.equal(linked.parent_id, parent.id);
    assert.equal(linked.id, child.id);
    assert.equal(linked.thread_id, child.thread_id);
    assert.equal(linked.assignee, child.assignee);
    assert.equal(linked.state, child.state);
    assert.equal(linked.status, child.status);
    const after = await env.client.call("tasks.get", { task: child.id });
    assert.deepEqual(after.sessions, before.sessions);
    assert.deepEqual(after.comments, before.comments);
    assert.deepEqual(after.events.slice(0, -1), before.events);
    assert.equal(after.events.at(-1)?.data.parent_id, parent.id);
    assert.deepEqual(
      env.core.store.runs.list(session.id).map((r) => r.id),
      runs,
    );
    assert.equal((await env.client.call("tasks.get", { task: parent.id })).subtasks[0]?.id, child.id);
    assert.equal((await ws.call("tasks.update", { task: child.id, parent: null })).parent_id, undefined);
    assert.deepEqual((await env.client.call("tasks.get", { task: parent.id })).subtasks, []);
    await env.client.call("tasks.close", { task: child.id, state: "done" });
    const closed = await ws.call("tasks.update", { task: child.id, parent: parent.id });
    assert.equal(closed.state, "done");
    assert.equal(closed.assignee, child.assignee);
    assert.deepEqual(
      env.core.store.threads.byTask(child.id).map((s) => s.id),
      [session.id],
    );
    assert.deepEqual(
      env.core.store.runs.list(session.id).map((r) => r.id),
      runs,
    );
  } finally {
    ws.close();
    await env.core.close();
    await env.cleanup();
  }
});

test("task hierarchy stays in one project when creating and moving tasks", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Complete.")) });
  try {
    env.core.store.projects.upsert({ id: "acme", name: "Acme" });
    env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
    const parent = await env.client.call("tasks.create", { title: "Delivery", project: "acme" });
    const child = await env.client.call("tasks.create", { title: "Review", parent: parent.id, project: "acme" });
    for (const project of [undefined, "northwind"]) {
      await assert.rejects(
        env.client.call("tasks.create", { title: "Wrong project", parent: parent.id, project }),
        /same project/,
      );
    }
    for (const task of [parent.id, child.id]) {
      for (const project of [null, "northwind"]) {
        await assert.rejects(env.client.call("tasks.update", { task, project }), /detach subtasks|same project/);
        const unchanged = await env.client.call("tasks.get", { task });
        assert.equal(unchanged.task.project_id, "acme");
        assert.equal(unchanged.events.length, 1);
      }
    }
    const moved = await env.client.call("tasks.update", { task: child.id, project: "northwind", parent: null });
    assert.equal(moved.project_id, "northwind");
    assert.equal(moved.parent_id, undefined);
    assert.equal((await env.client.call("tasks.update", { task: parent.id, project: null })).project_id, undefined);
    const historical = await env.client.call("tasks.create", { title: "Historical review" });
    await env.client.call("tasks.close", { task: historical.id, state: "done" });
    const model = new ApxClient({ url: env.core.url, actor: "agent" });
    const grouped = await model.call("tasks.update", { task: historical.id, parent: parent.id });
    assert.equal(grouped.parent_id, parent.id);
    assert.equal(grouped.state, "done");
    assert.equal(grouped.assignee, undefined);
    assert.equal(grouped.description, historical.description);
    assert.deepEqual(env.core.store.threads.byTask(historical.id), []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("reparenting refuses self, descendant cycles, missing and cross-project parents without partial writes", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Complete.")) });
  try {
    const a = await env.client.call("tasks.create", { title: "Delivery" });
    const b = await env.client.call("tasks.create", { title: "Review", parent: a.id });
    const c = await env.client.call("tasks.create", { title: "Evidence", parent: b.id });
    env.core.store.projects.upsert({ id: "acme", name: "Acme" });
    const other = await env.client.call("tasks.create", { title: "Other delivery", project: "acme" });
    for (const parent of [a.id, b.id, c.id, "missing", other.id]) {
      await assert.rejects(env.client.call("tasks.update", { task: a.id, parent, title: "Must not change" }));
      const current = await env.client.call("tasks.get", { task: a.id });
      assert.equal(current.task.title, "Delivery");
      assert.equal(current.task.parent_id, undefined);
      assert.equal(current.events.length, 1);
    }
    const chat = env.core.store.threads.create({
      kind: "loose",
      title: "Scoped",
      project_id: "acme",
      agent_ids: ["superagent"],
    });
    env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
    const hidden = await env.client.call("tasks.create", { title: "Hidden", project: "northwind" });
    const denied = await env.core.dispatch(
      "tasks.update",
      { task: other.id, parent: hidden.id },
      context(chat.id),
      "hidden",
    );
    assert.equal(denied.ok, false);
    assert.match(!denied.ok ? denied.error.message : "", /own project's tasks/);
    const model = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(model.call("tasks.update", { task: a.id, parent: b.id }), /parent:/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an agent regroups a task but never moves it higher up, which would skip the hand-off depth rule", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Complete.")) });
  try {
    const a = await env.client.call("tasks.create", { title: "Plan" });
    const b = await env.client.call("tasks.create", { title: "Phase", parent: a.id });
    const c = await env.client.call("tasks.create", { title: "Branch", parent: b.id });
    const sibling = await env.client.call("tasks.create", { title: "Other branch", parent: b.id });
    const work = await env.client.call("tasks.create", { title: "Work", parent: c.id });
    const chat = env.core.store.threads.create({ kind: "loose", title: "Agent", agent_ids: ["vera"] });
    const agent = { ...context(chat.id), agent: { id: "vera", thread_id: chat.id, run_id: "run_test" } };
    for (const parent of [null, a.id, b.id]) {
      const refused = await env.core.dispatch("tasks.update", { task: work.id, parent }, agent, `up-${parent}`);
      assert.equal(refused.ok, false);
      assert.match(!refused.ok ? refused.error.message : "", /higher up/);
      assert.equal(env.core.store.tasks.get(work.id)?.parent_id, c.id);
    }
    const level = await env.core.dispatch("tasks.update", { task: work.id, parent: sibling.id }, agent, "level");
    assert.equal(level.ok, true);
    assert.equal(env.core.store.tasks.get(work.id)?.parent_id, sibling.id);
    assert.equal((await env.client.call("tasks.update", { task: work.id, parent: null })).parent_id, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a project subtask under a global task, as earlier releases made them, stays editable", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Complete.")) });
  try {
    env.core.store.projects.upsert({ id: "acme", name: "Acme" });
    env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
    const parent = await env.client.call("tasks.create", { title: "Plan the launch" });
    const thread = env.core.store.threads.create({ kind: "task", title: "Site copy", agent_ids: ["vera"] });
    const child = env.core.store.tasks.create({
      title: "Site copy",
      project_id: "acme",
      status: "todo",
      parent_id: parent.id,
      thread_id: thread.id,
      by: "superagent",
    });
    const edited = await env.client.call("tasks.update", { task: child.id, title: "Site copy, final" });
    assert.equal(edited.title, "Site copy, final");
    assert.equal(edited.parent_id, parent.id);
    assert.equal(edited.project_id, "acme");
    const chat = env.core.store.threads.create({
      kind: "loose",
      title: "Scoped",
      project_id: "acme",
      agent_ids: ["superagent"],
    });
    const moved = await env.core.dispatch("tasks.update", { task: child.id, status: "doing" }, context(chat.id), "st");
    assert.equal(moved.ok, true);
    assert.equal(env.core.store.tasks.get(child.id)?.status, "doing");
    await assert.rejects(env.client.call("tasks.update", { task: child.id, project: "northwind" }), /same project/);
    await assert.rejects(env.client.call("tasks.update", { task: child.id, parent: parent.id }), /same project/);
    const fresh = await env.client.call("tasks.create", { title: "Pricing page", project: "acme" });
    await assert.rejects(
      env.client.call("tasks.update", { task: fresh.id, parent: parent.id, title: "Must not change" }),
      /same project/,
    );
    const unchanged = env.core.store.tasks.get(fresh.id);
    assert.equal(unchanged?.title, "Pricing page");
    assert.equal(unchanged?.parent_id, undefined);
    const detached = await env.client.call("tasks.update", { task: child.id, project: "northwind", parent: null });
    assert.equal(detached.project_id, "northwind");
    assert.equal(detached.parent_id, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("from a global task's chat the super-agent hands work to a project agent under that task", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Complete.")) });
  try {
    env.core.store.projects.upsert({ id: "acme", name: "Acme" });
    env.core.store.agents.upsertApc({
      id: "acme-builder",
      name: "Acme builder",
      project_id: "acme",
      slug: "acme-builder",
      role: "Engineering",
      prompt: "",
      extra: {},
    });
    const global = await env.client.call("tasks.create", { title: "Plan the launch" });
    const work = {
      title: "Build the pricing page",
      description: "Build the pricing page from the plan.",
      assignee: "acme-builder",
    };
    const made = await env.core.dispatch("tasks.create", work, context(global.thread_id), "chat-create");
    assert.equal(made.ok, true, !made.ok ? made.error.message : "");
    const task = made.ok ? (made.result as { id: string }) : undefined;
    const saved = task && env.core.store.tasks.get(task.id);
    assert.equal(saved?.project_id, "acme");
    assert.equal(saved?.parent_id, global.id);
    assert.equal(saved?.assignee, "acme-builder");
    const vague = await env.core.dispatch(
      "tasks.create",
      { title: "Something", assignee: "acme-builder" },
      context(global.thread_id),
      "chat-vague",
    );
    assert.equal(vague.ok, false);
    assert.match(!vague.ok ? vague.error.message : "", /description:/);
    const explicit = await env.core.dispatch(
      "tasks.create",
      { ...work, title: "Named parent", parent: global.id },
      context(global.thread_id),
      "chat-explicit",
    );
    assert.equal(explicit.ok, false);
    assert.match(!explicit.ok ? explicit.error.message : "", /same project/);
    // The link keeps counting hand-offs: three tasks up, the new one waits for the owner.
    const phase = await env.client.call("tasks.create", { title: "Phase", parent: global.id });
    const step = await env.client.call("tasks.create", { title: "Step", parent: phase.id });
    const deep = await env.core.dispatch("tasks.create", work, context(step.thread_id), "chat-deep");
    assert.equal(deep.ok, true, !deep.ok ? deep.error.message : "");
    const held = deep.ok ? env.core.store.tasks.get((deep.result as { id: string }).id) : undefined;
    assert.equal(held?.parent_id, step.id);
    assert.equal(held?.proposed, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
