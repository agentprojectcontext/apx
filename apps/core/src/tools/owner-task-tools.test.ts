// Task tools for the owner's agents route what used to be refused: progress goes on the plan, a helper's words go in
// its answer, a second comment joins the first, help asked mid-plan is recorded, and work on another project's task
// says where. Outsiders keep their fences (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { agentTools } from "./agents.ts";
import { type ToolContext, ToolFailed } from "./types.ts";

const CASES = ["PROGRESS-CASE", "HELPER-CASE", "DONE-CASE"];
/** The task Scout is asked about: the one whose work asks it. */
const helperTask = () =>
  env.core.store.tasks.list({ limit: 50 }).find((t) => t.description.includes("HELPER-CASE"))?.id ?? "";

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const tools = req.messages.filter((m) => m.role === "tool").length;
  if (system.startsWith("You are Scout")) {
    if (!afterTool) return callTool("s0", "task_comment", { task: helperTask(), text: "The hinge is loose." });
    return say("The hinge on the back door is loose.");
  }
  const latest = req.messages.findLast((m) => m.role === "user" && /Task task_\w+:/.test(String(m.content)));
  const task = /Task (task_\w+):/.exec(String(latest?.content ?? ""))?.[1] ?? "";
  const marker = CASES.find((c) => (env?.core.store.tasks.get(task)?.description ?? "").includes(c));
  if (system.startsWith("You are Vera") && marker === "PROGRESS-CASE") {
    if (tools === 0) return callTool("p0", "plan", { steps: "- [~] Count the shelves\n- [ ] Review the count" });
    if (tools === 1) return callTool("p1", "task_comment", { task, text: "Half the shelves counted." });
    return say("Counting.");
  }
  if (system.startsWith("You are Vera") && marker === "DONE-CASE") {
    if (tools === 0) return callTool("d0", "plan", { steps: "- [x] Sort the mail\n- [x] Check the sorting" });
    if (tools === 1) return callTool("d1", "task_comment", { task, text: "Mail sorted by floor." });
    if (tools === 2) return callTool("d2", "task_comment", { task, text: "The parcels wait at reception." });
    return say("Sorted.");
  }
  if (system.startsWith("You are Vera") && marker === "HELPER-CASE") {
    if (tools === 0) return callTool("h0", "plan", { steps: "- [~] Fix the doors\n- [ ] Review them" });
    if (tools === 1)
      return callTool("h1", "delegate", { agent: "scout", task: "Look at the back door hinge.", wait_s: 0 });
    return say("Fixing.");
  }
  // An owner's chat: "steps: [...]" runs those tool calls in order.
  if (said.startsWith("steps: ")) {
    const steps = JSON.parse(said.slice(7)) as { name: string; args: object }[];
    const next = steps[tools];
    return next ? callTool(`c${tools}`, next.name, next.args) : say("done");
  }
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let acme = "";
let northwind = "";
before(async () => {
  env = await startCore({ llm });
  acme = (await env.client.call("projects.create", { name: "Acme" })).project.id;
  northwind = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** Every tool call of the chat's turns, with its state and result. */
const stepsOf = (thread: string) => env.core.store.runs.list(thread).flatMap((r) => env.core.store.runs.steps(r.id));

async function owner(steps: { name: string; args: object }[], o: { project?: string; app?: boolean } = {}) {
  const thread = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    project_id: o.project,
  });
  if (o.app) env.core.store.threads.mergeContext(thread.id, { client: "external" });
  await env.client.call("threads.send", { thread: thread.id, text: `steps: ${JSON.stringify(steps)}` });
  await env.settle(thread.id);
  return stepsOf(thread.id);
}

async function work(title: string, marker: string) {
  const task = await env.client.call("tasks.create", {
    title,
    goal: `${title}, as asked`,
    description: `${title}. ${marker}`,
    assignee: "vera",
  });
  await waitFor(() => env.core.store.threads.byTask(task.id).length > 0, "its work chat");
  const [chat] = env.core.store.threads.byTask(task.id);
  await env.settle(chat?.id ?? "");
  return { task, chat: chat?.id ?? "" };
}

const agentComments = (thread: string) =>
  env.core.store.messages.list(thread, 100).filter((m) => m.author.kind === "agent");

test("from one project's chat, another project's tasks are listed and changed, and the result says where", async () => {
  const theirs = await env.client.call("tasks.create", { title: "Northwind stock count", project: northwind });
  const [list, update] = await owner(
    [
      { name: "task_list", args: { project: "Northwind" } },
      { name: "task_update", args: { task: theirs.id, priority: "high" } },
    ],
    { project: acme },
  );
  assert.equal(list?.state, "ok");
  assert.match(list?.result ?? "", /^project Northwind:\n[\s\S]*Northwind stock count/);
  assert.equal(update?.state, "ok");
  assert.match(update?.result ?? "", /This task is in project Northwind\./);
  assert.equal(env.core.store.tasks.get(theirs.id)?.priority, "high");
});

test("an outside app's chat lists and changes only its own project's tasks", async () => {
  const theirs = await env.client.call("tasks.create", { title: "Northwind private", project: northwind });
  const [list, update] = await owner(
    [
      { name: "task_list", args: { project: "Northwind" } },
      { name: "task_update", args: { task: theirs.id, priority: "high" } },
    ],
    { project: acme, app: true },
  );
  assert.match(list?.result ?? "", /lists only its own project's tasks/);
  assert.doesNotMatch(list?.result ?? "", /Northwind private/);
  // Refused by its check, before any step runs.
  assert.notEqual(update?.state, "ok");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /own project's tasks/);
  assert.equal(env.core.store.tasks.get(theirs.id)?.priority, "normal");
});

test("a second comment in the same turn joins the first instead of being refused", async () => {
  const task = await env.client.call("tasks.create", { title: "Order paper", project: acme });
  const steps = await owner(
    [
      { name: "task_comment", args: { task: task.id, text: "Ordered A4 paper." } },
      { name: "task_comment", args: { task: task.id, text: "It arrives on Friday." } },
    ],
    { project: acme },
  );
  assert.deepEqual(
    steps.map((s) => s.state),
    ["ok", "ok"],
  );
  assert.match(steps[1]?.result ?? "", /added to your comment/);
  const comments = agentComments(task.thread_id);
  assert.equal(comments.length, 1);
  assert.match(JSON.stringify(comments[0]?.parts), /Ordered A4 paper\.\\n\\nIt arrives on Friday\./);
});

test("progress from the task's own agent goes on its plan's step, not refused and not a comment", async () => {
  const { task, chat } = await work("Count the shelves", "PROGRESS-CASE");
  const comment = stepsOf(chat).find((s) => s.tool === "task_comment");
  assert.equal(comment?.state, "ok");
  assert.match(comment?.result ?? "", /noted on the plan's step "Count the shelves"/);
  assert.match(
    env.core.store.tasks.get(task.id)?.plan ?? "",
    /- \[~\] Count the shelves \(Half the shelves counted\.\)/,
  );
  assert.equal(agentComments(task.thread_id).length, 0);
});

test("with the plan done, a second comment in the turn joins the report, not the plan's last step", async () => {
  const { task, chat } = await work("Sort the mail", "DONE-CASE");
  const comments = stepsOf(chat).filter((s) => s.tool === "task_comment");
  assert.deepEqual(
    comments.map((s) => s.state),
    ["ok", "ok"],
  );
  assert.match(comments[1]?.result ?? "", /added to your comment/);
  const posted = agentComments(task.thread_id);
  assert.equal(posted.length, 1);
  assert.match(JSON.stringify(posted[0]?.parts), /Mail sorted by floor\.\\n\\nThe parcels wait at reception\./);
  assert.doesNotMatch(env.core.store.tasks.get(task.id)?.plan ?? "", /parcels/);
});

test("mid-plan, the task's agent may ask a teammate; the task records it, and the helper's words go in its answer", async () => {
  const done = await work("Fix the doors", "HELPER-CASE");
  const asked = stepsOf(done.chat).find((s) => s.tool === "delegate");
  assert.equal(asked?.state, "ok");
  assert.doesNotMatch(asked?.result ?? "", /not asked/);
  const history = env.core.store.tasks.events(done.task.id);
  assert.ok(history.some((e) => /asked Scout for: Look at the back door hinge\./.test(String(e.data.note ?? ""))));
  const [sub] = env.core.store.threads.sessions(done.chat);
  assert.ok(sub, "Scout was asked");
  await env.settle(sub.id);
  const helper = stepsOf(sub.id).find((s) => s.tool === "task_comment");
  assert.equal(helper?.state, "ok");
  assert.match(helper?.result ?? "", /part of your answer to them/);
  assert.equal(agentComments(done.task.thread_id).length, 0);
});

test("an outside app's task chat still keeps mid-plan help out", async () => {
  const { store } = env.core;
  const task = await env.client.call("tasks.create", { title: "Paint the hall", project: acme });
  store.tasks.change(task.id, { assignee: "vera", plan: "- [~] Paint the hall\n- [ ] Review it" }, "owner");
  const thread = store.threads.create({
    kind: "loose",
    title: "Paint",
    agent_ids: ["vera"],
    project_id: acme,
    task_id: task.id,
  });
  store.threads.mergeContext(thread.id, { client: "external" });
  const delegate = agentTools(store).find((t) => t.name === "delegate");
  let delegated = false;
  const ctx = {
    agent: store.agents.get("vera") as AgentRecord,
    thread: store.threads.get(thread.id) as Thread,
    run: { id: "run_absent", thread_id: thread.id },
    signal: new AbortController().signal,
    delegate: async () => {
      delegated = true;
      return "sent";
    },
  } as unknown as ToolContext;
  await assert.rejects(delegate?.run({ agent: "scout", task: "Which paint?" }, ctx) ?? Promise.reject(), (e) => {
    assert.ok(e instanceof ToolFailed);
    return /not asked/.test(e.message);
  });
  assert.equal(delegated, false);
});
