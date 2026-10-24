import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pickUpTasks, startTaskWork } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let waitingTask = "";
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (said.includes("request completion"))
    return callTool("consult", "delegate", { agent: "vera", task: "Complete pending specification" });
  if (said.includes("Complete pending specification"))
    return callTool("fill", "task_update", { task: waitingTask, description: "Write the implementation plan." });
  return say("Work complete.");
});
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const blank = [undefined, "", " \t\n "];
const sessions = (id: string) => env.core.store.threads.byTask(id);
const runs = (id: string) => sessions(id).flatMap((s) => env.core.store.runs.list(s.id));
async function finish(id: string) {
  for (const s of sessions(id)) await env.settle(s.id);
}

for (const description of blank) {
  const label = JSON.stringify(description) ?? "omitted";
  test(`create waits for a description (${label}) and starts exactly once when completed`, async () => {
    const t = await env.client.call("tasks.create", { title: "Describe the work", assignee: "vera", description });
    assert.equal(t.assignee, "vera");
    assert.equal(t.description, description ?? "");
    assert.deepEqual(sessions(t.id), []);
    await env.client.call("tasks.update", { task: t.id, status: "doing", description: "   " });
    assert.deepEqual(sessions(t.id), []);
    await env.client.call("tasks.update", { task: t.id, description: "Write a short summary." });
    await finish(t.id);
    assert.equal(runs(t.id).length, 1);
    assert.equal(runs(t.id)[0]?.state, "completed");
    await env.client.call("tasks.update", { task: t.id, description: "Revise the summary.", assignee: "vera" });
    await env.client.call("tasks.update", { task: t.id, description: "" });
    await env.client.call("tasks.update", { task: t.id, description: "Restore the specification." });
    assert.equal(runs(t.id).length, 1, "editing work already begun does not restart it");
  });

  test(`assignment waits for a description (${label}) without losing the pending task`, async () => {
    const t = await env.client.call("tasks.create", { title: "Pending idea", description });
    assert.equal(t.assignee, undefined);
    assert.deepEqual(sessions(t.id), []);
    const assigned = await env.client.call("tasks.update", { task: t.id, assignee: "vera", description });
    assert.equal(assigned.assignee, "vera");
    assert.deepEqual(sessions(t.id), []);
    await env.client.call("tasks.update", { task: t.id, assignee: "roby", description: "\t" });
    assert.deepEqual(sessions(t.id), []);
    await env.client.call("tasks.update", { task: t.id, description: "Turn the idea into a plan." });
    await finish(t.id);
    assert.equal(runs(t.id).length, 1);
    assert.equal(runs(t.id)[0]?.agent_id, "roby");
  });
}

test("a complete description with assignment starts immediately, but an unassigned task stays pending", async () => {
  const t = await env.client.call("tasks.create", { title: "Pending plan" });
  await env.client.call("tasks.update", { task: t.id, description: "Write the plan." });
  assert.deepEqual(sessions(t.id), []);
  await env.client.call("tasks.update", { task: t.id, description: "Finish the plan.", assignee: "vera" });
  await finish(t.id);
  assert.equal(runs(t.id).length, 1);
  const created = await env.client.call("tasks.create", {
    title: "Complete specification",
    description: "Write the release summary.",
    assignee: "vera",
  });
  await finish(created.id);
  assert.equal(runs(created.id).length, 1);
});

test("completing a closed or unassigned waiting task does not start work", async () => {
  const t = await env.client.call("tasks.create", { title: "Closed idea", assignee: "vera" });
  await env.client.call("tasks.close", { task: t.id, state: "done" });
  await env.client.call("tasks.update", { task: t.id, description: "No longer needed." });
  assert.deepEqual(sessions(t.id), []);
  const pending = await env.client.call("tasks.create", { title: "Unassigned idea", assignee: "vera" });
  await env.client.call("tasks.update", { task: pending.id, assignee: null, description: "Wait for an assignee." });
  assert.deepEqual(sessions(pending.id), []);
});

test("an agent answering another agent cannot start waiting work by completing its description", async () => {
  const t = await env.client.call("tasks.create", { title: "Waiting for specification", assignee: "roby" });
  waitingTask = t.id;
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: chat.id, text: "request completion" });
  await env.settle(chat.id);
  assert.equal(env.core.store.tasks.get(t.id)?.description, "", "refused before persisting the specification");
  assert.deepEqual(sessions(t.id), []);
  const refusal = llm.calls
    .flatMap((c) => c.messages)
    .find((m) => m.role === "tool" && String(m.content).includes("so you start no task work"));
  assert.ok(refusal, "completing a description respects the same hand-off restriction as assigning");
  await env.client.call("tasks.close", { task: t.id, state: "dropped" });
});

for (const state of ["done", "dropped"] as const) {
  test(`an agent answering another agent may complete a ${state} task without starting work`, async () => {
    const t = await env.client.call("tasks.create", { title: "Closed specification", assignee: "roby" });
    await env.client.call("tasks.close", { task: t.id, state });
    waitingTask = t.id;
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: "request completion" });
    await env.settle(chat.id);
    assert.equal(env.core.store.tasks.get(t.id)?.description, "Write the implementation plan.");
    assert.equal(env.core.store.tasks.get(t.id)?.state, state);
    assert.deepEqual(sessions(t.id), []);
  });
}

test("automatic starts and pickup skip incomplete legacy tasks without consuming pickup slots", () => {
  const store = env.core.store;
  const create = (description: string | undefined) =>
    store.tasks.create({
      title: "Legacy pending work",
      description,
      assignee: "vera",
      priority: description?.trim() ? "low" : "urgent",
      status: "todo",
      thread_id: store.threads.create({ kind: "task", title: "Legacy work", agent_ids: ["vera"] }).id,
      by: "owner",
    });
  const incomplete = [...blank, " "].map(create);
  const complete = create("Complete the documented work.");
  let admitted = 0;
  const admit = (() => {
    admitted++;
    return { id: "run_pickup" };
  }) as unknown as Parameters<typeof pickUpTasks>[1];
  for (const t of incomplete) {
    assert.equal(startTaskWork(store, admit, t, "vera", { kind: "owner" }), undefined);
    assert.deepEqual(sessions(t.id), []);
  }
  assert.equal(admitted, 0);
  store.settings.set("task_work_since", new Date(Date.now() - 60_000).toISOString());
  assert.equal(pickUpTasks(store, admit).length, 1);
  assert.equal(admitted, 1);
  assert.equal(sessions(complete.id).length, 1);
  for (const t of incomplete) assert.deepEqual(sessions(t.id), []);
  assert.deepEqual(pickUpTasks(store, admit), []);
});
