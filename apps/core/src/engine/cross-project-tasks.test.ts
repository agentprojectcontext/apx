import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Task } from "@apx/protocol";
import { createLog } from "../log.ts";
import type { CallContext } from "../rpc/context.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const project = "northwind";
const other = "acme";
const worker = "northwind-builder";
const orchestrator = "northwind-lead";
const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const last = String(req.messages.at(-1)?.content);
  if (system.startsWith("You are Project lead")) {
    if (!afterTool)
      return callTool("prepare", "task_create", {
        title: "Coordinated delivery",
        description: "Prepare the delivery for review.",
      });
    return say(last);
  }
  if (said === "coordinate delivery") {
    if (!afterTool)
      return callTool("coordinate", "delegate", {
        agent: orchestrator,
        project,
        task: "Create an unassigned task for delivery and return its id. I will assign it.",
      });
    if (req.messages.filter((m) => m.role === "tool").length === 1) {
      const id = /created (task_\w+)/.exec(last)?.[1];
      assert.ok(id, last);
      return callTool("assign", "task_update", { task: id, assignee: worker });
    }
    return say(last);
  }
  if (said.startsWith("create ")) {
    if (afterTool) return say(last);
    const args = JSON.parse(said.slice(7));
    return callTool("create", "task_create", args);
  }
  return say("Work received.");
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  for (const id of [project, other]) env.core.store.projects.upsert({ id, name: id });
  for (const [id, name, parent] of [
    [orchestrator, "Project lead", undefined],
    [worker, "Project builder", orchestrator],
  ] as const)
    env.core.store.agents.upsertApc({
      id,
      name,
      parent,
      project_id: project,
      slug: id,
      role: "Engineering",
      prompt: "",
      extra: { orchestrator: id === orchestrator ? true : undefined },
    });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function chat(agent: string, project_id?: string) {
  return env.client.call("threads.create", { kind: "loose", agent_id: agent, project_id });
}
function context(agent: string, thread: string): CallContext {
  return {
    transport: "internal",
    role: "operator",
    actor: "agent",
    session: undefined,
    log: createLog("test", true),
    agent: { id: agent, thread_id: thread, run_id: "test" },
  };
}
async function ask(agent: string, text: string, project_id?: string) {
  const thread = await chat(agent, project_id);
  await env.client.call("threads.send", { thread: thread.id, text });
  const result = await env.settle(thread.id);
  return { thread, output: texts(result.messages).join("\n") };
}
const tasks = () => env.core.store.tasks.list({ limit: 200 });

function assertDestination(task: Task | undefined) {
  assert.ok(task);
  assert.equal(task.project_id, project);
  assert.equal(task.assignee, worker);
  assert.equal(env.core.store.threads.get(task.thread_id)?.project_id, project);
  const sessions = env.core.store.threads.byTask(task.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.project_id, project);
  assert.deepEqual(sessions[0]?.agent_ids, [worker]);
}

test("the global super-agent's task tool infers the assignee's project and starts the right agent", async () => {
  const { output } = await ask(
    "roby",
    `create ${JSON.stringify({ title: "Direct delivery", description: "Prepare the delivery for review.", assignee: worker })}`,
  );
  assert.match(output, /starts on it now/);
  assertDestination(tasks().find((t) => t.title === "Direct delivery"));
});

test("the router uses the same destination rule, while the owner still chooses a project explicitly", async () => {
  const thread = await chat("roby");
  const response = await env.core.dispatch(
    "tasks.create",
    { title: "Router delivery", description: "Prepare the delivery for review.", assignee: worker },
    context("roby", thread.id),
    "router-create",
  );
  assert.equal(response.ok, true);
  assertDestination(tasks().find((t) => t.title === "Router delivery"));
  await assert.rejects(
    env.client.call("tasks.create", {
      title: "Owner global mismatch",
      description: "Prepare the delivery for review.",
      assignee: worker,
    }),
    /another project/,
  );
  const explicit = await env.client.call("tasks.create", {
    title: "Owner delivery",
    project,
    description: "Prepare the delivery for review.",
    assignee: worker,
  });
  assertDestination(explicit);
});

test("the global super-agent may explicitly choose a project for an unassigned task", async () => {
  await ask("roby", `create ${JSON.stringify({ title: "Destination draft", project })}`);
  const task = tasks().find((t) => t.title === "Destination draft");
  assert.equal(task?.project_id, project);
  assert.equal(task?.assignee, undefined);
  const thread = await chat("roby");
  for (const [title, destination, assignee] of [
    ["Explicit mismatch", other, worker],
    ["Missing destination", "missing-project", undefined],
    ["Missing assignee", project, "missing-agent"],
  ] as const) {
    const result = await env.core.dispatch(
      "tasks.create",
      { title, project: destination, assignee },
      context("roby", thread.id),
      title,
    );
    assert.equal(result.ok, false);
    assert.ok(!tasks().some((t) => t.title === title));
  }
});

test("ordinary global agents and project-bound callers gain no cross-project creation or assignment", async () => {
  for (const [agent, place] of [
    ["vera", undefined],
    [worker, other],
    ["roby", other],
  ] as const) {
    const thread = await chat(agent, place);
    for (const explicit of [false, true]) {
      const title = `Refused ${agent} ${explicit}`;
      const result = await env.core.dispatch(
        "tasks.create",
        { title, description: "Prepare the delivery for review.", assignee: worker, ...(explicit ? { project } : {}) },
        context(agent, thread.id),
        title,
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, explicit ? "unauthorized" : "bad_request");
      assert.ok(!tasks().some((t) => t.title === title));
    }
    const own = await env.client.call("tasks.create", { title: `Unassigned ${agent}`, project: place });
    const assigned = await env.core.dispatch(
      "tasks.update",
      { task: own.id, assignee: worker },
      context(agent, thread.id),
      `assign-${agent}`,
    );
    assert.equal(assigned.ok, false);
    assert.equal(env.core.store.tasks.get(own.id)?.assignee, undefined);
  }
  const { output } = await ask(
    "vera",
    `create ${JSON.stringify({ title: "Tool escape", description: "Prepare the delivery for review.", assignee: worker, project })}`,
  );
  assert.match(output, /only in its own project/);
  assert.ok(!tasks().some((t) => t.title === "Tool escape"));
});

test("global unassigned tasks and same-project assignments keep their existing scope", async () => {
  for (const agent of ["roby", "vera"]) {
    const title = `Global draft ${agent}`;
    await ask(agent, `create ${JSON.stringify({ title })}`);
    const task = tasks().find((t) => t.title === title);
    assert.ok(task);
    assert.equal(task.project_id, undefined);
    assert.equal(task.assignee, undefined);
  }
  await ask(
    worker,
    `create ${JSON.stringify({ title: "Local delivery", description: "Prepare the delivery for review.", assignee: worker, project })}`,
    project,
  );
  assertDestination(tasks().find((t) => t.title === "Local delivery"));
});

test("the super-agent can choose the project orchestrator to prepare the task, then assign it itself", async () => {
  const { thread } = await ask("roby", "coordinate delivery");
  const task = tasks().find((t) => t.title === "Coordinated delivery");
  assertDestination(task);
  assert.ok(task);
  assert.equal(task.created_by, orchestrator);
  const events = env.core.store.tasks.events(task.id);
  assert.equal(events[0]?.by, orchestrator);
  assert.ok(events.some((e) => e.by === "roby" && e.op === "assign"));
  const children = env.core.store.threads.children(thread.id).flatMap((id) => env.core.store.threads.get(id) ?? []);
  assert.equal(children[0]?.project_id, project);
  assert.deepEqual(children[0]?.agent_ids, [orchestrator, "roby"]);
});

test("an answering orchestrator still cannot start task work through the router", async () => {
  const thread = env.core.store.threads.create({
    kind: "a2a",
    title: "Prepare delivery",
    agent_ids: [orchestrator, "roby"],
    project_id: project,
  });
  const result = await env.core.dispatch(
    "tasks.create",
    { title: "No chained work", description: "Prepare the delivery for review.", assignee: worker },
    context(orchestrator, thread.id),
    "no-chained-work",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /answering.*start no task work/);
  assert.ok(!tasks().some((t) => t.title === "No chained work"));
});
