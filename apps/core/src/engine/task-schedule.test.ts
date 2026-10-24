// A task can wait for its start time, and a task in review says who checks it: the owner hears it is theirs to check,
// an agent named to review it is asked to (by APX, not as the owner).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pickUpTasks, startScheduled } from "./task-work.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { system, said }) => {
  if (system.startsWith("You are Scout") && said.includes("Review task") && said.includes("Totals"))
    return say("Needs work: the totals round down a cent.");
  if (system.startsWith("You are Scout") && said.includes("Review task")) return say("Approved: the tests pass.");
  return say("On it.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

test("an assigned task with a start time ahead waits, and the office clock starts it when it comes", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", {
    title: "Rotate the keys",
    description: "Rotate the API keys of the staging server.",
    assignee: "vera",
    start_at: later(3600_000),
  });
  assert.ok(task.start_at);
  assert.equal(store.threads.byTask(task.id).length, 0, "it did not start on assignment");
  assert.deepEqual(startScheduled(store, env.core.engine.admit, new Date()), [], "not before its time");
  // Cleared (or moved to now) before it began: it begins at once.
  await env.client.call("tasks.update", { task: task.id, start_at: null });
  assert.equal(store.threads.byTask(task.id).length, 1);
  assert.deepEqual(startScheduled(store, env.core.engine.admit, new Date()), [], "started once");
});

test("when its start time comes, the office clock starts it; the hourly pickup leaves it alone until then", async () => {
  const store = env.core.store;
  store.settings.set("task_work_since", new Date(Date.now() - 60_000).toISOString());
  const task = await env.client.call("tasks.create", {
    title: "Send the report",
    description: "Send the weekly report to the team.",
    assignee: "vera",
    start_at: later(300),
  });
  assert.ok(!pickUpTasks(store, env.core.engine.admit).some((r) => r.thread_id === task.thread_id));
  assert.equal(store.threads.byTask(task.id).length, 0);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(startScheduled(store, env.core.engine.admit, new Date()).length, 1);
  assert.equal(store.threads.byTask(task.id).length, 1);
});

test("put in review with no reviewer, it is the owner's to check until it leaves review", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Check the copy" });
  await env.client.call("tasks.update", { task: task.id, status: "review" });
  const notice = () =>
    store.notifications.list({ unreadOnly: true, limit: 50 }).find((n) => n.ref === `review:${task.id}`);
  assert.equal(notice()?.level, "info");
  await env.client.call("tasks.update", { task: task.id, status: "doing" });
  assert.equal(notice(), undefined, "leaving review clears it");
});

test("an agent named to review it is asked to, by APX, in a consult shown on the task", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Payments fix", assignee: "vera" });
  const changed = await env.client.call("tasks.update", { task: task.id, status: "review", reviewer: "Scout" });
  assert.equal(changed.reviewer, "scout");
  const [review] = store.threads.sessions(task.thread_id);
  assert.equal(review?.agent_ids[0], "scout");
  const run = store.runs.list(review?.id ?? "")[0];
  assert.equal(run?.trigger, "system", "no new budget window: the owner did not write");
  await env.settle(review?.id ?? "");
  const card = (await env.client.call("threads.get", { thread: task.thread_id })).messages
    .flatMap((m) => m.parts)
    .find((p) => p.type === "subthread");
  assert.equal(card?.type === "subthread" && card.asked_by, "vera");
  assert.match(card?.type === "subthread" ? (card.summary ?? "") : "", /Approved/);
  await assert.rejects(env.client.call("tasks.update", { task: task.id, reviewer: "nobody-here" }), /reviewer/);
  await assert.rejects(
    env.client.call("tasks.update", { task: task.id, reviewer: "vera" }),
    /does not review its own work/,
  );
});

test("a task created straight in review is the owner's to check", async () => {
  const task = await env.client.call("tasks.create", { title: "Check the logo", status: "review" });
  const notice = env.core.store.notifications
    .list({ unreadOnly: true, limit: 50 })
    .find((n) => n.ref === `review:${task.id}`);
  assert.ok(notice);
});

test("a review asking for changes reaches the doer as the reviewer's words; after two rounds the owner decides", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Totals report", assignee: "vera" });
  const review = async () => {
    await env.client.call("tasks.update", { task: task.id, status: "doing" });
    await env.client.call("tasks.update", { task: task.id, status: "review", reviewer: "scout" });
    for (const s of store.threads.sessions(task.thread_id)) await env.settle(s.id);
    const chat = store.threads.byTask(task.id).find((t) => t.agent_ids[0] === "vera");
    if (chat) await env.settle(chat.id);
    return chat;
  };
  const chat = await review();
  const asked = (await env.client.call("threads.get", { thread: chat?.id ?? "" })).messages.find((m) =>
    JSON.stringify(m.parts).includes("asks for changes"),
  );
  assert.deepEqual(asked?.author, { kind: "agent", id: "scout" }, "the reviewer's words, not the owner's");
  assert.match(JSON.stringify(asked?.parts), /round down a cent/);
  assert.equal(store.tasks.get(task.id)?.status, "doing", "back to work: putting it in review again asks again");
  await review();
  const third = store.threads.sessions(task.thread_id).length;
  await env.client.call("tasks.update", { task: task.id, status: "doing" });
  await env.client.call("tasks.update", { task: task.id, status: "review" });
  assert.equal(store.threads.sessions(task.thread_id).length, third, "no third review round");
  assert.ok(
    store.notifications.list({ unreadOnly: true, limit: 50 }).some((n) => n.ref === `review:${task.id}`),
    "the owner decides",
  );
});
