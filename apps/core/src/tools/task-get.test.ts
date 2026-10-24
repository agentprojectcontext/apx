import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) =>
  afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("get", "task_get", { task: said }),
);
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  env.core.store.projects.upsert({ id: "project_a", name: "Acme" });
  env.core.store.projects.upsert({ id: "project_b", name: "Northwind" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

function recordUsage(thread_id: string, model: string) {
  const { runs } = env.core.store;
  const run = runs.create({
    thread_id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Verify" },
    deadline_at: new Date(Date.now() + 30_000).toISOString(),
    state: "queued",
  });
  runs.patch(run, { model, usage: { input: 123, output: 45 } });
  runs.setState(run, "completed");
}

async function get(task: string, project_id?: string, agent_id = "roby") {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id, project_id });
  await env.client.call("threads.send", { thread: t.id, text: task });
  await env.settle(t.id);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
}

test("task_get returns task fields, history, related work, usage and persisted conversation evidence", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Review implementation",
    description: "Verify behavior",
    project: "project_a",
    tags: ["release"],
  });
  await env.client.call("tasks.update", { task: task.id, status: "review" });
  await env.client.call("tasks.comment", { task: task.id, text: "Runtime proof: request passed" });
  const { store } = env.core;
  const session = store.threads.create({
    kind: "loose",
    title: "Implementation session",
    agent_ids: ["roby"],
    project_id: "project_a",
    task_id: task.id,
  });
  const consult = store.threads.create({
    kind: "a2a",
    title: "Risk review",
    agent_ids: ["roby", "vera"],
    project_id: "project_a",
    parent_id: task.thread_id,
  });
  store.threads.mergeContext(consult.id, { consult: { task: task.id, card: "msg_consult" } });
  const child = await env.client.call("tasks.create", {
    title: "Check callers",
    project: "project_a",
    parent: task.id,
  });
  store.messages.add({
    thread_id: task.thread_id,
    author: { kind: "agent", id: "roby" },
    parts: [
      { type: "text", text: "Evidence attached" },
      { type: "file", media_id: "med_proof", name: "proof.txt", mime: "text/plain", bytes: 20 },
      { type: "changes", cwd: "~/work/acme", files: [{ path: "index.ts", status: "modified", diff: "+verified" }] },
    ],
  });
  recordUsage(session.id, "example/model");
  const detail = await env.client.call("tasks.get", { task: task.id });
  assert.deepEqual(detail.usage, [{ model: "example/model", runs: 1, input: 123, output: 45 }]);
  const result = await get(task.id, "project_a");
  for (const text of [
    task.id,
    "Verify behavior",
    "release",
    "History:",
    '"op":"move"',
    session.id,
    consult.id,
    child.id,
    "Usage:",
    '"model":"example/model","runs":1,"input":123,"output":45',
    "Runtime proof: request passed",
    "med_proof",
    "+verified",
  ])
    assert.ok(result.includes(text), `missing ${text}: ${result}`);
  assert.equal(result.split("Runtime proof: request passed").length - 1, 1);
  assert.match(result, /trust="untrusted"/);
});

test("task_get hides other projects with the same safe error as a missing id", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Private Northwind work",
    description: "Private evidence",
    project: "project_b",
  });
  const denied = await get(task.id, "project_a");
  const missing = await get("task_absent", "project_a");
  assert.equal(denied, missing);
  assert.match(denied, /task unavailable/);
  assert.doesNotMatch(denied, /Northwind|Private evidence/);
  assert.match(await get(task.id), /Private Northwind work/);
  assert.match(await get(task.id, undefined, "vera"), /task unavailable/);
  const global = await env.client.call("tasks.create", { title: "Global board item" });
  assert.match(await get(global.id, "project_a"), /Global board item/);
});

test("task_get filters related records from other projects and bounds long conversations", async () => {
  const task = await env.client.call("tasks.create", { title: "Shared task" });
  const { store } = env.core;
  const hidden = store.threads.create({
    kind: "loose",
    title: "Hidden session",
    agent_ids: ["roby"],
    project_id: "project_b",
    task_id: task.id,
  });
  recordUsage(hidden.id, "example/hidden-model");
  const consult = store.threads.create({
    kind: "a2a",
    title: "Hidden consult",
    agent_ids: ["roby"],
    project_id: "project_b",
    parent_id: task.thread_id,
  });
  store.threads.mergeContext(consult.id, { consult: { task: task.id, card: "msg_hidden" } });
  recordUsage(consult.id, "example/hidden-model");
  await env.client.call("tasks.create", { title: "Hidden child", project: "project_b", parent: task.id });
  for (let i = 0; i < 65; i++)
    store.messages.add({
      thread_id: task.thread_id,
      author: { kind: "user" },
      parts: [{ type: "text", text: `Comment number ${i}` }],
    });
  const detail = await env.client.call("tasks.get", { task: task.id });
  assert.equal(detail.comments.length, 60);
  assert.equal(detail.comments_truncated, true);
  assert.equal(detail.comments[0]?.parts[0]?.type === "text" && detail.comments[0].parts[0].text, "Comment number 5");
  const result = await get(task.id, "project_a");
  assert.doesNotMatch(result, /Hidden session|Hidden child|hidden-model/);
  assert.ok(!result.includes(hidden.id));
  assert.match(result, /older messages omitted/);
  assert.match(result, /Comment number 64/);
  assert.ok(result.length < 12_000);
});
