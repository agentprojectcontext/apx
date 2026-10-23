import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { realpath } from "../paths.ts";
import { mentioned } from "./office.ts";
import { pickUpTasks } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

// The bridge task's first step waits here, so its work chat is mid-turn while the owner writes on the task.
let releaseBridge: () => void = () => {};
const bridgeHeld = new Promise<void>((r) => {
  releaseBridge = r;
});

// Vera and Roby keep mentioning each other: an answer to an agent's @mention asks no one further (DECISIONS.md#d-132).
const llm = scriptedLlm(async (req, { said, afterTool }) => {
  const system = String(req.messages[0]?.content);
  const steer = req.messages.find((m) => m.role === "user" && String(m.content).startsWith("[The owner adds"));
  if (steer) return say(`Steered: ${String(steer.content).split("\n")[1]}`);
  if (said.includes("Rebuild the desktop bridge") && !afterTool) {
    await bridgeHeld;
    return callTool("b1", "task_list", {});
  }
  // Works until stopped: the owner interrupts it from the task.
  if (said.includes("Translate the onboarding guide") && !afterTool) {
    await new Promise((r) => req.signal.addEventListener("abort", r, { once: true }));
    return say("Stopped");
  }
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 120)}`);
  if (said.includes("make a task"))
    return callTool("t1", "task_create", {
      title: "Draft the launch post",
      assignee: "roby",
      description: "Write the launch draft.",
    });
  if (said.includes("peek at the other")) return callTool("t2", "task_list", {});
  if (said.includes("open the reel tasks"))
    return callTool("t6", "task_create", {
      title: "Cut the tools reel",
      assignee: "vera",
      description: "Edit the tools reel from the brief.",
    });
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
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  releaseBridge();
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("a task keeps its history: created, moved, assigned, done, reopened", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Ship the newsletter",
    description: "Send the weekly newsletter.",
    project,
  });
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

test("a bare @mention after the owner's question asks that question, not just the name", async () => {
  const t = await env.client.call("tasks.create", { title: "Check the release notes", project });
  const quiet = await env.client.call("tasks.comment", { task: t.id, text: "Did the smoke tests pass?" });
  assert.equal(quiet.runs.length, 0, "a comment with no @mention asks nobody");
  const r = await env.client.call("tasks.comment", { task: t.id, text: "@vera" });
  assert.equal(r.runs.length, 1);
  await settleTask(t.id);
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("Did the smoke tests pass?"));
  assert.match(String(input?.messages.at(-1)?.content), /\nDid the smoke tests pass\?\n\n@vera\n/);
});

test("an @mention of the task's own agent asks it in its chat for the task, and its answer is a comment", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Pick the colors",
    description: "Choose the light and dark palettes.",
    project,
    assignee: "vera",
  });
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

test("the owner writing in a task's conversation reaches its agent's working turn, never a second turn", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Rebuild the desktop bridge",
    description: "Update the bridge protocol.",
    project,
    assignee: "vera",
  });
  const work = env.core.store.threads.byTask(t.id)[0]?.id ?? "";
  const vera = () =>
    [t.thread_id, ...env.core.store.threads.byTask(t.id).map((s) => s.id)]
      .flatMap((id) => env.core.store.runs.list(id))
      .filter((r) => r.agent_id === "vera");
  for (let i = 0; i < 200 && vera()[0]?.state !== "working"; i++) await new Promise((r) => setTimeout(r, 10));
  const working = vera()[0];
  assert.equal(working?.state, "working");
  const sent = await env.client.call("threads.send", {
    thread: t.thread_id,
    text: "@roby check the bridge's tests too, and use the staging config",
    mode: "steer",
  });
  // One working turn for Vera on this task: her chat's, which takes the owner's words.
  assert.equal(sent.run?.id, working?.id);
  assert.deepEqual(
    vera().map((r) => r.id),
    [working?.id],
  );
  releaseBridge();
  const { sessions } = await settleTask(t.id);
  assert.deepEqual(
    sessions.map((s) => s.id),
    [work],
  );
  assert.deepEqual(env.core.store.runs.list(t.thread_id), [], "nothing ran in the task's conversation");
  assert.equal(vera().length, 1);
  const chat = await env.client.call("threads.get", { thread: work });
  assert.ok(texts(chat.messages).includes("@roby check the bridge's tests too, and use the staging config"));
  assert.ok(texts(chat.messages).some((x) => x.startsWith("Steered: @roby check the bridge")));
  // The words stay on the task as the owner's comment, and the @mention of a teammate is still a consult.
  const conversation = await env.client.call("threads.get", { thread: t.thread_id });
  assert.ok(
    conversation.messages.some(
      (m) =>
        m.author.kind === "user" &&
        texts([m]).includes("@roby check the bridge's tests too, and use the staging config"),
    ),
  );
  assert.deepEqual(
    env.core.store.threads.children(t.thread_id).map((id) => env.core.store.threads.get(id)?.agent_ids[0]),
    ["roby"],
  );
});

/** Vera's runs in a task's work chat, oldest first. */
const workRuns = (task: string) =>
  env.core.store.threads
    .byTask(task)
    .flatMap((s) => env.core.store.runs.list(s.id))
    .filter((r) => r.agent_id === "vera")
    .sort((a, b) => a.started_at.localeCompare(b.started_at));

test("the owner writing on a task whose work chat is idle starts its next turn there, words and all", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Tidy the changelog",
    description: "Group entries by release.",
    project,
    assignee: "vera",
  });
  const { sessions } = await settleTask(t.id);
  const work = sessions[0]?.id ?? "";
  const before = workRuns(t.id).length;
  const sent = await env.client.call("threads.send", { thread: t.thread_id, text: "also bump the version" });
  await settleTask(t.id);
  const runs = workRuns(t.id);
  assert.equal(runs.length, before + 1, "one more turn, in the work chat");
  assert.equal(runs.at(-1)?.id, sent.run?.id);
  assert.equal(runs.at(-1)?.state, "completed");
  assert.equal(env.core.store.runs.get(sent.run?.id ?? "")?.input?.text, "also bump the version");
  assert.deepEqual(env.core.store.runs.list(t.thread_id), [], "nothing ran in the task's conversation");
  const chat = await env.client.call("threads.get", { thread: work });
  assert.ok(texts(chat.messages).includes("also bump the version"));
  const asked = llm.calls.find((c) => JSON.stringify(c.messages.at(-1)).includes("also bump the version"));
  assert.ok(asked && String(asked.messages[0]?.content).startsWith("You are Vera"), "Vera's model read the words");
});

test("interrupting from a task stops the work chat's turn and starts one with the owner's words", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Translate the onboarding guide",
    description: "Translate the guide into Spanish.",
    project,
    assignee: "vera",
  });
  for (let i = 0; i < 200 && workRuns(t.id)[0]?.state !== "working"; i++) await new Promise((r) => setTimeout(r, 10));
  const working = workRuns(t.id)[0];
  assert.equal(working?.state, "working");
  const sent = await env.client.call("threads.send", {
    thread: t.thread_id,
    text: "stop, use the new template",
    mode: "interrupt",
  });
  assert.notEqual(sent.run?.id, working?.id);
  assert.ok(!sent.steered);
  await settleTask(t.id);
  const runs = workRuns(t.id);
  assert.deepEqual(
    runs.map((r) => r.id),
    [working?.id, sent.run?.id],
  );
  assert.equal(runs[0]?.state, "canceled");
  assert.equal(runs[1]?.state, "completed");
  assert.equal(runs[1]?.input?.text, "stop, use the new template");
  assert.deepEqual(env.core.store.runs.list(t.thread_id), [], "nothing ran in the task's conversation");
});

test("files the owner attaches on a task reach the work chat's turn", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Review the logo",
    description: "Check the attached logo.",
    project,
    assignee: "vera",
  });
  const { sessions } = await settleTask(t.id);
  const work = sessions[0]?.id ?? "";
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const { media } = await env.client.call("media.upload", { name: "logo.png", mime: "image/png", data: PNG });
  const sent = await env.client.call("threads.send", {
    thread: t.thread_id,
    text: "this one",
    attachments: [media.id],
  });
  await settleTask(t.id);
  assert.deepEqual(
    env.core.store.runs.get(sent.run?.id ?? "")?.input?.attachments?.map((a) => a.media_id),
    [media.id],
  );
  const chat = await env.client.call("threads.get", { thread: work });
  const said = chat.messages.findLast((m) => m.author.kind === "user");
  assert.ok(
    said?.parts.some((p) => p.type === "image" && p.media_id === media.id),
    "shown in the work chat",
  );
  const asked = llm.calls.findLast((c) => JSON.stringify(c.messages).includes("this one"));
  const item = asked?.messages.findLast((m) => m.role === "user" && m.images?.length) as
    | { images?: Array<{ media_id: string }> }
    | undefined;
  assert.deepEqual(
    item?.images?.map((i) => i.media_id),
    [media.id],
    "Vera's model got the picture",
  );
});

test("an agent's @mention in a task comment asks that agent, and the answer comes back to the chat it asked from", async () => {
  const store = env.core.store;
  const t = await env.client.call("tasks.create", { title: "Name the release", project });
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "vera", project_id: project });
  await env.client.call("threads.send", { thread: chat.id, text: `ping roby on ${t.id}` });
  await env.settle(chat.id);
  const consult = store.threads.get(store.threads.children(t.thread_id)[0] ?? "");
  assert.equal(consult?.agent_ids[0], "roby");
  assert.deepEqual(store.threads.context(consult?.id ?? "").consult?.asker, { agent: "vera", thread: chat.id });
  await env.settle(consult?.id ?? "");
  await env.settle(chat.id);
  const back = store.messages.list(chat.id, 50).find((m) => m.author.kind === "agent" && m.author.id === "roby");
  assert.match(JSON.stringify(back?.parts), /Roby (answered|could not answer) your question/);
  assert.deepEqual(
    await env.client.call("tasks.get", { task: t.id }).then((d) => d.sessions),
    [],
    "no chat of Vera's opens on a task that is not hers",
  );
});

test("a task an agent makes while working a task is its subtask, listed on it", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Launch: make a task for it",
    description: "Create a draft task for the launch.",
    project,
    assignee: "vera",
  });
  await settleTask(t.id);
  const { subtasks } = await env.client.call("tasks.get", { task: t.id });
  assert.deepEqual(
    subtasks.map((s) => [s.title, s.parent_id, s.created_by]),
    [["Draft the launch post", t.id, "vera"]],
  );
});

test("an answering agent cannot silently drop a requested assignee and leave an orphan task", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: chat.id, text: "hand over subtask" });
  await env.settle(chat.id);
  const { tasks } = await env.client.call("tasks.list", { project });
  assert.equal(
    tasks.find((x) => x.title === "Proofread the post"),
    undefined,
  );
  const refusal = llm.calls
    .flatMap((c) => c.messages)
    .find((m) => m.role === "tool" && /so you start no task work/.test(String(m.content)));
  assert.match(String(refusal?.content), /the agent that asked you|assigns it/);
});

test("an agent the owner consults on a task can create and start the tasks the owner asks for", async () => {
  const t = await env.client.call("tasks.create", { title: "Plan the reel series", project });
  await env.client.call("tasks.comment", { task: t.id, text: "@roby open the reel tasks and start them" });
  await settleTask(t.id);
  const { subtasks } = await env.client.call("tasks.get", { task: t.id });
  assert.deepEqual(
    subtasks.map((s) => [s.title, s.assignee, s.created_by]),
    [["Cut the tools reel", "vera", "roby"]],
  );
  const reel = subtasks[0];
  assert.ok(reel);
  const started = await settleTask(reel.id);
  assert.equal(started.sessions.length, 1, "the new task's work started in its agent's chat");
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
  // A work turn's answer stays in its chat: the task's comments are what agents post there on purpose.
  assert.deepEqual(await commentsOf(t.thread_id), []);

  await env.client.call("tasks.update", { task: t.id, assignee: "roby" });
  const second = await settleTask(t.id);
  const roby = second.sessions.filter((s) => s.agent_ids[0] === "roby");
  assert.equal(roby.length, 1);
  const input = llm.calls.find(
    (c) =>
      String(c.messages[0]?.content).startsWith("You are Roby") &&
      String(c.messages.at(-1)?.content).includes("Write the release notes\n\nTwo paragraphs."),
  );
  assert.match(String(input?.messages.at(-1)?.content), new RegExp(`Worked on before by: Vera \\(chat ${vera.id}\\)`));
});

test("the hourly pickup starts only tasks assigned since it began, the most pressing first", async () => {
  const store = env.core.store;
  const assigned = (title: string, priority: "urgent" | "low") =>
    store.tasks.create({
      title,
      description: "Resolve the documentation issue.",
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
  const p2 = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks2-")));
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
  const p2 = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks3-")));
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
