import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import type { CallContext } from "./context.ts";

const context = (thread: string): CallContext => ({
  role: "operator",
  actor: "agent",
  transport: "internal",
  session: undefined,
  log: createLog("test", true),
  agent: { id: "roby", thread_id: thread, run_id: "run_test" },
});

async function fixture() {
  const env = await startCore({ llm: scriptedLlm(() => say("Work complete.")) });
  const parent = await env.client.call("tasks.create", {
    title: "Prepare release",
    description: "Review the release.",
  });
  const work = env.core.store.threads.create({
    kind: "loose",
    title: parent.title,
    agent_ids: ["roby"],
    task_id: parent.id,
  });
  return { env, parent, work };
}

test("agent subtasks require an assignee and a specification before any task or thread is persisted", async () => {
  const { env, parent, work } = await fixture();
  try {
    const before = env.core.store.threads.list({ include_subthreads: true }).length;
    for (const [i, fields] of [
      {},
      { description: "Review the diff." },
      { assignee: "vera" },
      { assignee: "vera", description: "  \n " },
    ].entries()) {
      const result = await env.core.dispatch(
        "tasks.create",
        { title: `Review part ${i}`, ...fields },
        context(work.id),
        `missing-${i}`,
      );
      assert.equal(result.ok, false, JSON.stringify(fields));
      assert.match(!result.ok ? result.error.message : "", /assignee:|description:/);
    }
    assert.deepEqual((await env.client.call("tasks.get", { task: parent.id })).subtasks, []);
    assert.equal(env.core.store.threads.list({ include_subthreads: true }).length, before);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a complete agent subtask starts exactly once; agents cannot erase its owner or specification", async () => {
  const { env, parent, work } = await fixture();
  try {
    const created = await env.core.dispatch(
      "tasks.create",
      { title: "Review the diff", description: "Check the public contract.", assignee: "vera" },
      context(work.id),
      "complete",
    );
    assert.ok(created.ok);
    if (!created.ok) return;
    const task = created.result as { id: string; parent_id: string; assignee: string };
    assert.equal(task.parent_id, parent.id);
    assert.equal(task.assignee, "vera");
    const sessions = env.core.store.threads.byTask(task.id);
    assert.equal(sessions.length, 1);
    const session = sessions[0];
    assert.ok(session);
    await env.settle(session.id);
    assert.equal(env.core.store.runs.list(session.id).length, 1);
    for (const [i, changes] of [{ assignee: null }, { description: "   " }].entries()) {
      const result = await env.core.dispatch(
        "tasks.update",
        { task: task.id, ...changes },
        context(work.id),
        `erase-${i}`,
      );
      assert.equal(result.ok, false);
      assert.match(!result.ok ? result.error.message : "", /assignee:|description:/);
    }
    assert.equal(env.core.store.tasks.get(task.id)?.assignee, "vera");
    assert.equal(env.core.store.tasks.get(task.id)?.description, "Check the public contract.");
    const changed = await env.core.dispatch(
      "tasks.update",
      { task: task.id, status: "review" },
      context(work.id),
      "status",
    );
    assert.ok(changed.ok);
    assert.equal(env.core.store.runs.list(session.id).length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("owner drafts and agent top-level drafts remain possible; explicit parent cannot bypass the requirement", async () => {
  const { env, parent } = await fixture();
  try {
    const draft = await env.client.call("tasks.create", { title: "Owner draft", parent: parent.id });
    assert.equal(draft.assignee, undefined);
    const chat = env.core.store.threads.create({ kind: "loose", title: "Planning", agent_ids: ["roby"] });
    const created = await env.core.dispatch("tasks.create", { title: "Unassigned plan" }, context(chat.id), "plan");
    assert.ok(created.ok);
    const refused = await env.core.dispatch(
      "tasks.create",
      { title: "Unassigned child", parent: parent.id, description: "Review later." },
      context(chat.id),
      "explicit",
    );
    assert.equal(refused.ok, false);
    assert.match(!refused.ok ? refused.error.message : "", /assignee:/);
    assert.equal((await env.client.call("tasks.get", { task: parent.id })).subtasks.length, 1);
    assert.deepEqual(env.core.store.threads.byTask(draft.id), []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("moving an agent subtask cannot silently clear its project-scoped assignee", async () => {
  const { env, parent, work } = await fixture();
  try {
    env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
    env.core.store.agents.upsertApc({
      id: "northwind-builder",
      slug: "builder",
      name: "Builder",
      project_id: "northwind",
      role: "Engineering",
      prompt: "",
      extra: {},
    });
    const task = await env.client.call("tasks.create", {
      title: "Prepare delivery",
      parent: parent.id,
      project: "northwind",
      assignee: "northwind-builder",
      description: "Review the delivery.",
    });
    const result = await env.core.dispatch("tasks.update", { task: task.id, project: null }, context(work.id), "move");
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error.message : "", /assignee:/);
    assert.equal(env.core.store.tasks.get(task.id)?.project_id, "northwind");
    assert.equal(env.core.store.tasks.get(task.id)?.assignee, "northwind-builder");
    const moved = await env.client.call("tasks.update", { task: task.id, project: null });
    assert.equal(moved.project_id, undefined);
    assert.equal(moved.assignee, undefined, "the owner can deliberately move and unassign work");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("model clients cannot bypass subtask ownership through HTTP or WebSocket", async () => {
  const { env, parent } = await fixture();
  const model = new ApxClient({ url: env.core.url, actor: "agent" });
  const socket = await model.connect();
  try {
    const params = { title: "Prepare follow-up", parent: parent.id, description: "Review after delivery." };
    await assert.rejects(model.call("tasks.create", params), /assignee:/);
    await assert.rejects(socket.call("tasks.create", params), /assignee:/);
    assert.deepEqual((await env.client.call("tasks.get", { task: parent.id })).subtasks, []);
  } finally {
    socket.close();
    await env.core.close();
    await env.cleanup();
  }
});
