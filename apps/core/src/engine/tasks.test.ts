import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { mentioned } from "./office.ts";
import { pickUpTasks } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Vera and Roby keep mentioning each other: the cascade must stop by itself.
const llm = scriptedLlm((req, { said, afterTool }) => {
  const system = String(req.messages[0]?.content);
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 120)}`);
  if (said.includes("make a task")) return callTool("t1", "task_create", { title: "Draft the launch post" });
  if (said.includes("peek at the other")) return callTool("t2", "task_list", {});
  if (said.includes("ask the owner")) return say("@JULIAN please confirm the launch date.");
  if (system.startsWith("You are Vera")) return say("Done my part, @roby your turn.");
  if (system.startsWith("You are Roby")) return say("Thanks, back to you @vera.");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;

/** Waits until every chat a task is worked in has finished, cascades included. */
async function settleTask(task: string, ms = 8000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    const { sessions } = await env.client.call("tasks.get", { task });
    const runs = (await Promise.all(sessions.map((s) => env.client.call("threads.get", { thread: s.id })))).flatMap(
      (t) => t.runs,
    );
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

test("an @mention asks the agent in its own chat for the task; answers come back as comments, and the cascade stops", async () => {
  const t = await env.client.call("tasks.create", { title: "Plan the launch", project });
  const r = await env.client.call("tasks.comment", { task: t.id, text: "@vera can you start this?" });
  assert.equal(r.runs.length, 1);
  const { sessions, runs } = await settleTask(t.id);
  // Owner → Vera (0) → Roby (1) → Vera (2), then no more; each in its own chat for the task, none in the task.
  assert.deepEqual(
    sessions.map((s) => [s.agent_ids[0], s.kind, s.task_id]),
    [
      ["vera", "loose", t.id],
      ["roby", "loose", t.id],
    ],
  );
  assert.equal(runs.length, 3);
  assert.equal((await env.client.call("threads.get", { thread: t.thread_id })).runs.length, 0);
  assert.deepEqual(await commentsOf(t.thread_id), ["user", "vera", "roby", "vera"]);
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("@vera can you start this?"));
  assert.match(
    String(input?.messages.at(-1)?.content),
    /\[task\]\nTask task_\w+:\nPlan the launch\nbacklog · assigned to nobody\n/,
  );
  assert.match(String(input?.messages.at(-1)?.content), /Your final answer is posted to the task as your comment/);
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

test("what an agent wrote in a task reaches other turns as outside data", async () => {
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
  assert.match(
    String(input?.messages.at(-1)?.content),
    /<task created_by="roby" trust="untrusted">\nDraft the launch post/,
  );
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
