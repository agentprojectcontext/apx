import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { mentioned } from "./office.ts";
import { pickUpTasks } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

// Vera and Roby keep mentioning each other: only the owner's @mentions ask anyone (DECISIONS.md#d-078).
const llm = scriptedLlm((req, { said, afterTool }) => {
  const system = String(req.messages[0]?.content);
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 120)}`);
  if (said.includes("make a task")) return callTool("t1", "task_create", { title: "Draft the launch post" });
  if (said.includes("peek at the other")) return callTool("t2", "task_list", {});
  if (said.includes("ask the owner")) return say("@JULIAN please confirm the launch date.");
  if (said.includes("hand over subtask"))
    return callTool("t4", "delegate", { agent: "vera", task: "assign a subtask to roby" });
  if (said.includes("assign a subtask to roby"))
    return callTool("t5", "task_create", { title: "Proofread the post", assignee: "roby" });
  const ping = /ping roby on (task_\w+)/.exec(said);
  if (ping) return callTool("t3", "task_comment", { task: ping[1], text: "@roby what do you think?" });
  if (system.startsWith("You are Vera")) return say("Done my part, @roby your turn.");
  if (system.startsWith("You are Roby")) return say("Thanks, back to you @vera.");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;

/** Waits until every chat a task is worked in, and every consult on it, has finished, cascades included. */
async function settleTask(task: string, ms = 8000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    const { task: t, sessions } = await env.client.call("tasks.get", { task });
    const consults = env.core.store.threads.children(t.thread_id);
    const runs = (
      await Promise.all(
        [...sessions.map((s) => s.id), ...consults].map((id) => env.client.call("threads.get", { thread: id })),
      )
    ).flatMap((x) => x.runs);
    const now = `${sessions.length}:${runs.length}:${runs.every((r) => r.ended_at)}`;
    if (runs.length && runs.every((r) => r.ended_at) && now === last) return { sessions, runs };
    last = now;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("task work did not settle");
}
const commentsOf = async (thread: string) =>
  (await env.client.call("threads.get", { thread })).messages.map((m) =>
    m.author.kind === "agent" ? m.author.id : m.author.kind,
  );
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("a task keeps its history: created, moved, assigned, done, reopened", async () => {
  const t = await env.client.call("tasks.create", { title: "Ship the newsletter", project });
  assert.equal(t.status, "backlog");
  await env.client.call("tasks.update", { task: t.id, status: "doing" });
  await env.client.call("tasks.update", { task: t.id, assignee: "vera" });
  await settleTask(t.id);
  await env.client.call("tasks.close", { task: t.id, state: "done", note: "sent" });
  await env.client.call("tasks.close", { task: t.id, state: "open" });
  const { task, events } = await env.client.call("tasks.get", { task: t.id });
  // The work Vera's assignment started answered with comments, between the assignment and the closing.
  assert.deepEqual(
    events.map((e) => e.op).filter((op) => op !== "comment"),
    ["create", "move", "assign", "done", "reopen"],
  );
  assert.equal(task.state, "open");
  await assert.rejects(
    env.client.call("tasks.update", { task: t.id, status: "nowhere" }),
    (e: unknown) => e instanceof ApxError && /no column/.test(e.message),
  );
});

test("an @mention of a teammate is a consult shown as a card on the task; the consulted agent asks no one else", async () => {
  const t = await env.client.call("tasks.create", { title: "Plan the launch", project });
  const r = await env.client.call("tasks.comment", { task: t.id, text: "@vera can you start this?" });
  assert.equal(r.runs.length, 1);
  const { sessions, runs } = await settleTask(t.id);
  // Owner → Vera, and there it stops: her answer mentions Roby, but a consult answers and asks nobody (D-074).
  assert.deepEqual(sessions, []);
  assert.equal(runs.length, 1);
  const consults = env.core.store.threads.children(t.thread_id).map((id) => env.core.store.threads.get(id));
  assert.deepEqual(
    consults.map((c) => [c?.kind, c?.agent_ids[0]]),
    [["a2a", "vera"]],
  );
  const conversation = await env.client.call("threads.get", { thread: t.thread_id });
  assert.equal(conversation.runs.length, 0);
  assert.deepEqual(conversation.thread.agent_ids, ["roby", "vera"], "whoever spoke is listed on the conversation");
  // The task shows the owner's comment and the consult's card with its answer: nothing copied twice.
  assert.deepEqual(await commentsOf(t.thread_id), ["user", "vera"]);
  const cards = conversation.messages.flatMap((m) => m.parts.filter((p) => p.type === "subthread"));
  assert.deepEqual(
    cards.map((c) => c.type === "subthread" && [c.state, c.summary]),
    [["completed", "Done my part, @roby your turn."]],
  );
  // The task lists its consults and adds up what every turn on it took.
  const detail = await env.client.call("tasks.get", { task: t.id });
  assert.equal(detail.consults.length, 1);
  assert.equal(
    detail.usage.reduce((n, u) => n + u.runs, 0),
    1,
    `every consult's turn counts: ${JSON.stringify(detail.usage)}`,
  );
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("@vera can you start this?"));
  assert.match(
    String(input?.messages.at(-1)?.content),
    /Asked on task task_\w+, assigned to nobody\.[^\n]*\]\nPlan the launch$/,
  );
});

test("an @mention of the task's own agent asks it in its chat for the task, and its answer is a comment", async () => {
  const t = await env.client.call("tasks.create", { title: "Pick the colors", project, assignee: "vera" });
  await settleTask(t.id);
  const before = (await env.client.call("threads.get", { thread: (await settleTask(t.id)).sessions[0]?.id ?? "" })).runs
    .length;
  await env.client.call("tasks.comment", { task: t.id, text: "@vera also the dark mode" });
  const { sessions } = await settleTask(t.id);
  // Vera works in her one chat; Roby, whom her answers mention, is not asked: an agent asks with delegate.
  assert.deepEqual(
    sessions.map((s) => s.agent_ids[0]),
    ["vera"],
  );
  const vera = await env.client.call("threads.get", { thread: sessions[0]?.id ?? "" });
  assert.ok(vera.runs.length > before, "the mention ran in her chat for the task");
  assert.ok(texts(vera.messages).includes("@vera also the dark mode"));
  assert.deepEqual(env.core.store.threads.children(t.thread_id), [], "nobody was consulted");
});

test("an agent's @mention in a task comment summons nobody", async () => {
  const t = await env.client.call("tasks.create", { title: "Name the release", project });
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "vera", project_id: project });
  await env.client.call("threads.send", { thread: chat.id, text: `ping roby on ${t.id}` });
  await env.settle(chat.id);
  assert.deepEqual(await commentsOf(t.thread_id), ["vera"]);
  assert.deepEqual(env.core.store.threads.children(t.thread_id), []);
  assert.deepEqual(await env.client.call("tasks.get", { task: t.id }).then((d) => d.sessions), []);
});

test("a task an agent makes while working a task is its subtask, listed on it", async () => {
  const t = await env.client.call("tasks.create", { title: "Launch: make a task for it", project, assignee: "vera" });
  await settleTask(t.id);
  const { subtasks } = await env.client.call("tasks.get", { task: t.id });
  assert.deepEqual(
    subtasks.map((s) => [s.title, s.parent_id, s.created_by]),
    [["Draft the launch post", t.id, "vera"]],
  );
});

test("an agent answering another one makes a task but gives it to nobody: it names who, and its caller assigns", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: chat.id, text: "hand over subtask" });
  await env.settle(chat.id);
  const { tasks } = await env.client.call("tasks.list", { project });
  const made = tasks.find((x) => x.title === "Proofread the post");
  assert.equal(made?.created_by, "vera");
  assert.equal(made?.assignee, undefined);
  assert.deepEqual((await env.client.call("tasks.get", { task: made?.id ?? "" })).sessions, []);
  const told = llm.calls
    .flatMap((c) => c.messages)
    .find((m) => m.role === "tool" && /give nobody work/.test(String(m.content)));
  assert.match(String(told?.content), /Name roby for task_\w+ in your answer: the agent that asked you assigns it\./);
});

test("giving a task to an agent starts it in its chat; another agent gets a new chat that knows who worked it", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Write the release notes",
    description: "Two paragraphs.",
    project,
    assignee: "vera",
  });
  const first = await settleTask(t.id);
  const vera = first.sessions.find((s) => s.agent_ids[0] === "vera");
  assert.ok(vera, "Vera's chat for the task");
  const opening = (await env.client.call("threads.get", { thread: vera.id })).messages[0];
  assert.equal(opening?.author.kind, "user");
  assert.deepEqual(opening?.parts, [{ type: "text", text: "Write the release notes\n\nTwo paragraphs." }]);
  assert.equal((await commentsOf(t.thread_id))[0], "vera");

  await env.client.call("tasks.update", { task: t.id, assignee: "roby" });
  const second = await settleTask(t.id);
  const roby = second.sessions.filter((s) => s.agent_ids[0] === "roby");
  assert.equal(roby.length, 1);
  const input = llm.calls.find(
    (c) =>
      String(c.messages[0]?.content).startsWith("You are Roby") &&
      String(c.messages.at(-1)?.content).includes("Write the release notes\n\nTwo paragraphs."),
  );
  assert.match(String(input?.messages.at(-1)?.content), /Worked on before in their own chats by: Vera\./);
});

test("the hourly pickup starts only tasks assigned since it began, the most pressing first", async () => {
  const store = env.core.store;
  const assigned = (title: string, priority: "urgent" | "low") =>
    store.tasks.create({
      title,
      project_id: project,
      assignee: "vera",
      status: "todo",
      priority,
      thread_id: store.threads.create({ kind: "task", title, agent_ids: ["vera"], project_id: project }).id,
      by: "owner",
    });
  const low = assigned("Tidy the docs", "low");
  const urgent = assigned("Fix the login", "urgent");
  const started: string[] = [];
  const admit = ((a: { thread_id: string }) => {
    started.push(store.threads.get(a.thread_id)?.task_id ?? "");
    return { id: `run_${started.length}` };
  }) as unknown as Parameters<typeof pickUpTasks>[1];
  store.settings.set("task_work_since", new Date(Date.now() + 60_000).toISOString());
  assert.deepEqual(pickUpTasks(store, admit), []);
  store.settings.set("task_work_since", new Date(Date.now() - 60_000).toISOString());
  pickUpTasks(store, admit);
  assert.deepEqual(
    started.filter((id) => id === low.id || id === urgent.id),
    [urgent.id, low.id],
  );
  // Started once: a task with a chat for it is not picked up again.
  started.length = 0;
  pickUpTasks(store, admit);
  assert.deepEqual(
    started.filter((id) => id === low.id || id === urgent.id),
    [],
  );
});

test("an agent's tasks go to its thread's project and it sees no other project's", async () => {
  const other = await env.client.call("tasks.create", { title: "Secret elsewhere" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "make a task" });
  await env.settle(t.id);
  const { tasks } = await env.client.call("tasks.list", { project });
  assert.ok(tasks.some((x) => x.title === "Draft the launch post" && x.created_by === "roby"));

  await env.client.call("tasks.update", { task: other.id, title: "Secret elsewhere" });
  const p2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks2-")));
  fs.writeFileSync(path.join(p2, "AGENTS.md"), "# Globex\n");
  const project2 = (await env.client.call("projects.register", { path: p2 })).project.id;
  await env.client.call("tasks.create", { title: "Globex only", project: project2 });
  await env.client.call("threads.send", { thread: t.id, text: "peek at the other projects" });
  await env.settle(t.id);
  assert.doesNotMatch(String(llm.calls.at(-1)?.messages.at(-1)?.content), /Globex only/);
  fs.rmSync(p2, { recursive: true, force: true });
});

test("outside any project the super-agent sees every project's board, each task with its project and last activity", async () => {
  await env.client.call("tasks.create", { title: "Northwind invoice", project });
  await env.client.call("tasks.create", { title: "Renew the base insurance" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "everything" });
  await env.client.call("threads.send", { thread: t.id, text: "peek at the other projects" });
  await env.settle(t.id);
  const seen = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  const name = (await env.client.call("projects.list", {})).projects.find((p) => p.id === project)?.name ?? "";
  assert.ok(seen.includes(`Northwind invoice (project ${name}, backlog, last activity `), seen);
  assert.match(seen, /last activity \d{4}-\d\d-\d\d \d\d:\d\d\)/);
  assert.match(seen, /Renew the base insurance \(project Default, /);
});

test("what an agent wrote in a task reaches other turns as the team's words, not outside data", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "make a task" });
  await env.settle(t.id);
  const made = (await env.client.call("tasks.list", { project })).tasks.find(
    (x) => x.title === "Draft the launch post",
  );
  if (!made) throw new Error("no task");
  await env.client.call("tasks.comment", { task: made.id, text: "@vera please look" });
  await settleTask(made.id);
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("@vera please look"));
  assert.match(String(input?.messages.at(-1)?.content), /<task created_by="roby" trust="team">\nDraft the launch post/);
});

test("an agent of one project is not assigned another project's task", async () => {
  const p2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks3-")));
  fs.writeFileSync(path.join(p2, "AGENTS.md"), "# Initech\n");
  const other = (await env.client.call("projects.register", { path: p2 })).project.id;
  const milton = await env.client.call("agents.create", { project_id: other, slug: "milton", name: "Milton" });
  assert.deepEqual(mentioned(env.core.store, `@${milton.id}`, project), []);
  assert.deepEqual(mentioned(env.core.store, `@${milton.id}`, undefined), []);
  assert.deepEqual(
    mentioned(env.core.store, `@${milton.id}`, other).map((a) => a.id),
    [milton.id],
  );
  const task = await env.client.call("tasks.create", { title: "Local discussion", project });
  const comment = await env.client.call("tasks.comment", { task: task.id, text: `@${milton.id} please look` });
  assert.equal(comment.runs.length, 0);
  await assert.rejects(
    env.client.call("tasks.create", { title: "Elsewhere", project, assignee: milton.id }),
    (e: unknown) => e instanceof ApxError && /another project/.test(e.message),
  );
  fs.rmSync(p2, { recursive: true, force: true });
});

test("long exact ids are mentioned whole and emails never summon an agent", () => {
  const id = `helper-${"long-".repeat(12)}id`;
  env.core.store.agents.upsert({
    id,
    name: "Long helper",
    kind: "agent",
    role: "Helper",
    browser_profile: "isolated",
    project_id: project,
  });
  assert.deepEqual(
    mentioned(env.core.store, `@${id}`, project).map((a) => a.id),
    [id],
  );
  assert.deepEqual(mentioned(env.core.store, "José@roby example@vera", project), []);
});

test("an agent mentions the owner by name: one notice per request, no extra turn; replying clears it", async () => {
  await env.client.call("owner.set", { name: "Julián Ríos" });
  const task = await env.client.call("tasks.create", { title: "Confirm the launch date", project });
  await env.client.call("tasks.comment", { task: task.id, text: "@vera ask the owner" });
  const result = await settleTask(task.id);
  assert.equal(result.runs.length, 1);
  assert.equal((await env.client.call("tasks.get", { task: task.id })).task.awaits_owner, true);
  const notices = (await env.client.call("notifications.list", {})).notifications.filter((n) => n.ref === task.id);
  assert.equal(notices.length, 1);
  assert.match(notices[0]?.body ?? "", /@JULIAN please confirm/);
  await env.client.call("tasks.comment", { task: task.id, text: "@vera ask the owner again" });
  await settleTask(task.id);
  assert.equal(
    (await env.client.call("notifications.list", {})).notifications.filter((n) => n.ref === task.id && !n.read_at)
      .length,
    1,
  );
  await env.client.call("tasks.comment", { task: task.id, text: "Confirmed for Friday" });
  assert.equal((await env.client.call("tasks.get", { task: task.id })).task.awaits_owner, false);
  assert.ok(
    (await env.client.call("notifications.list", {})).notifications
      .filter((n) => n.ref === task.id)
      .every((n) => n.read_at),
  );
});

test("deleting a task takes its history and conversation; subtasks and the agents' chats about it stay", async () => {
  const t = await env.client.call("tasks.create", { title: "Retire the old landing", project });
  const sub = await env.client.call("tasks.create", { title: "Redirect the old links", project, parent: t.id });
  await env.client.call("tasks.comment", { task: t.id, text: "@vera take a look" });
  const { sessions } = await settleTask(t.id);
  const seen: string[] = [];
  const off = env.core.bus.on((e) => {
    if (e.type === "task.deleted") seen.push(e.task_id);
  });
  const r = await env.client.call("tasks.delete", { task: t.id }, "task-del-1");
  off();
  assert.deepEqual(r, { deleted: t.id });
  assert.deepEqual(seen, [t.id]);
  assert.equal(env.core.store.tasks.get(t.id), undefined);
  assert.equal(env.core.store.tasks.events(t.id).length, 0);
  assert.equal(env.core.store.threads.get(t.thread_id), undefined);
  assert.equal(env.core.store.tasks.get(sub.id)?.parent_id, undefined);
  for (const s of sessions) assert.equal(env.core.store.threads.get(s.id)?.task_id, undefined);
  // The same key replays the answer; a new one finds nothing left.
  assert.deepEqual(await env.client.call("tasks.delete", { task: t.id }, "task-del-1"), r);
  await assert.rejects(env.client.call("tasks.delete", { task: t.id }), /not found|task/);
});
