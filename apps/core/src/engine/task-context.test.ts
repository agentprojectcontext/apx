// Work on a task stays legible: asking the same agent again goes on in its one session, a helper delegated from a
// task's chat knows the task and where to read its history, and the task's comments are what agents post on purpose
// (a close's report, a question for the owner), not every answer of their chat.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { answersOwner, COMMENT_PAUSE_MS, handOwnerComments, ownerTurnEnded } from "./task-inbox.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const done = req.messages.filter((m) => m.role === "tool").length;
  if (system.startsWith("You are Scout")) return say("The orders table is the largest.");
  if (system.startsWith("You are Vera")) {
    if (said.includes("Plan the migration") && !afterTool)
      return callTool("v1", "delegate", { agent: "scout", task: "Which table is the largest?" });
    if (said.includes("Ask the owner")) return say("@owner Which database should I migrate first, orders or users?");
    if (said.includes("status?")) return say("Half of the tables are moved.");
    return say("Delegated the sizing; still working on the plan.");
  }
  if (said.includes("nobody on it")) return say("Gave it to Vera.");
  if (said.includes("ask vera by another name") && !afterTool)
    return callTool("rn", "delegate", { agent: "vera", session: "vera-review-pass", task: "one more look" });
  if (said.includes("ask vera again") && !afterTool)
    return callTool("ra", "delegate", { agent: "vera", task: "one more" });
  if (said.includes("ask vera twice") && done < 2)
    return callTool(`r${done}`, "delegate", { agent: "vera", task: done ? "second request" : "first request" });
  return say(afterTool ? "Done." : "Hello.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const comments = async (thread: string) =>
  (await env.client.call("threads.get", { thread })).messages
    .filter((m) => m.author.kind === "agent")
    .flatMap((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])));

test("asking the same agent again goes on in its session instead of opening another", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "ask vera twice" });
  await env.settle(t.id);
  const sessions = env.core.store.threads.sessions(t.id);
  assert.equal(sessions.length, 1, "one session with Vera");
  const asked = (await env.client.call("threads.get", { thread: sessions[0]?.id ?? "" })).messages.filter(
    (m) => m.author.kind === "agent" && m.author.id === "roby",
  );
  assert.equal(asked.length, 2, "both requests reached the same session");
  assert.equal(
    env.core.store.threads.get(sessions[0]?.id ?? "")?.title,
    "Roby → Vera: second request",
    "it reads as the latest",
  );
});

test("a helper delegated from a task's chat reads the task; the chat's answer is not a comment", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Database migration",
    description: "Plan the migration of the legacy database.",
    assignee: "vera",
  });
  for (let i = 0; i < 100 && !env.core.store.threads.byTask(task.id).length; i++)
    await new Promise((r) => setTimeout(r, 20));
  const [chat] = env.core.store.threads.byTask(task.id);
  await env.settle(chat?.id ?? "");
  const helper = llm.calls.find((c) => String(c.messages[0]?.content).startsWith("You are Scout"));
  const input = String(helper?.messages.at(-1)?.content);
  assert.match(input, new RegExp(`Task ${task.id}:`));
  assert.match(input, new RegExp(`You are helping with this task for Vera, whose chat for it is ${chat?.id}`));
  assert.match(input, /task_get shows its latest comments/);
  assert.deepEqual(await comments(task.thread_id), [], "the work turn's answer stayed in Vera's chat");

  // An answer that asks the owner is posted to the task, as that request.
  await env.client.call("threads.send", { thread: chat?.id ?? "", text: "Ask the owner which one goes first." });
  await env.settle(chat?.id ?? "");
  assert.deepEqual(await comments(task.thread_id), ["@owner Which database should I migrate first, orders or users?"]);
  assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
});

test("the owner's comment that names no one reaches the task's agent, and shows sent, handed and read", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Check the backups", assignee: "vera" });
  const later = (ms: number) => new Date(Date.now() + ms);
  const comment = async (text: string) => (await env.client.call("tasks.comment", { task: task.id, text })).message;
  const first = await comment("When you can, finish this.");
  const second = await comment("And check last night's too.");
  assert.equal(store.messages.get(first.id)?.delivery, "sent");
  assert.equal(handOwnerComments(store, env.core.engine.admit, later(COMMENT_PAUSE_MS / 2)), 0, "it waits a moment");
  assert.equal(handOwnerComments(store, env.core.engine.admit, later(COMMENT_PAUSE_MS + 1000)), 1);
  assert.equal(store.messages.get(second.id)?.delivery, "delivered");
  const [chat] = store.threads.byTask(task.id);
  await env.settle(chat?.id ?? "");
  const asked = (await env.client.call("threads.get", { thread: chat?.id ?? "" })).messages[0];
  assert.match(JSON.stringify(asked?.parts), /finish this\.\\n\\nAnd check last night/);
  assert.equal(store.messages.get(first.id)?.delivery, "read");
  assert.equal(handOwnerComments(store, env.core.engine.admit, later(10 * COMMENT_PAUSE_MS)), 0, "handed once");
});

test("with nobody on the task, the super-agent picks the comment up", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Renew the domain" });
  await env.client.call("tasks.comment", { task: task.id, text: "Someone should take this." });
  handOwnerComments(store, env.core.engine.admit, new Date(Date.now() + COMMENT_PAUSE_MS + 1000));
  const [chat] = store.threads.byTask(task.id);
  assert.equal(chat?.agent_ids[0], "roby");
  await env.settle(chat?.id ?? "");
  const reply = (await env.client.call("threads.get", { thread: chat?.id ?? "" })).messages.at(-1);
  assert.match(JSON.stringify(reply?.parts), /Gave it to Vera/);
});

test("the owner's @mention of the task's agent gets its answer on the task, with queued comments and no second hand-off", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Move the tables", assignee: "vera" });
  const queued = (await env.client.call("tasks.comment", { task: task.id, text: "Also keep a backup." })).message;
  await env.client.call("tasks.comment", { task: task.id, text: "@vera status?" });
  const [chat] = store.threads.byTask(task.id);
  await env.settle(chat?.id ?? "");
  assert.ok((await comments(task.thread_id)).includes("Half of the tables are moved."), "the answer is on the task");
  assert.equal(store.messages.get(queued.id)?.delivery, "read", "the waiting comment went with the question");
  assert.equal(handOwnerComments(store, env.core.engine.admit, new Date(Date.now() + 10 * COMMENT_PAUSE_MS)), 0);
});

test("comments on a closed task, or from an outside app, wait for no agent", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Old errand", assignee: "vera" });
  await env.client.call("tasks.close", { task: task.id, state: "done" });
  const closed = (await env.client.call("tasks.comment", { task: task.id, text: "Thanks!" })).message;
  assert.equal(store.messages.get(closed.id)?.delivery, undefined);
  assert.deepEqual(store.threads.context(task.thread_id).owner_unread ?? [], []);
});

test("a turn that failed leaves the comments delivered and is not waited on", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Rotate the keys" });
  const comment = (await env.client.call("tasks.comment", { task: task.id, text: "Please do this soon." })).message;
  const t = store.tasks.get(task.id);
  assert.ok(t);
  const fake = { id: "run_gone", state: "failed" } as Parameters<typeof ownerTurnEnded>[2];
  answersOwner(store, t, fake);
  assert.equal(store.messages.get(comment.id)?.delivery, "delivered");
  assert.equal(ownerTurnEnded(store, t, fake), false);
  assert.deepEqual(store.threads.context(task.thread_id).owner_handed ?? [], [], "nothing left waiting on it");
});

test("an archived session is not reused: asking again opens another", async () => {
  const store = env.core.store;
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "ask vera twice" });
  await env.settle(t.id);
  const [first] = store.threads.sessions(t.id);
  await env.client.call("threads.update", { thread: first?.id ?? "", archived: true });
  await env.client.call("threads.send", { thread: t.id, text: "ask vera again" });
  await env.settle(t.id);
  assert.equal(store.threads.sessions(t.id).length, 2, "an archived session is not reused");
});

test("the plan an agent keeps on the task reaches every turn of its work, whatever the chat forgot", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Migrate invoices", assignee: "vera" });
  await env.client.call("tasks.update", {
    task: task.id,
    plan: "- [x] Export the old table\n- [ ] Import into the new one",
  });
  assert.match(store.tasks.get(task.id)?.plan ?? "", /Import into the new one/);
  const chat = store.threads.create({ kind: "loose", title: task.title, agent_ids: ["vera"], task_id: task.id });
  await env.client.call("threads.send", { thread: chat.id, text: "Go on." });
  await env.settle(chat.id);
  const input = String(
    llm.calls.findLast((c) => String(c.messages[0]?.content).startsWith("You are Vera"))?.messages.at(-1)?.content,
  );
  assert.match(
    input,
    /Plan kept on the task:\n<task_plan[^>]*trust="untrusted">\n- \[x\] Export the old table\n- \[ \] Import into the new one/,
  );
});

test("a new session name for a teammate that already has a free session here goes on in that one", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "ask vera again" });
  await env.settle(t.id);
  await env.client.call("threads.send", { thread: t.id, text: "ask vera by another name" });
  await env.settle(t.id);
  const sessions = env.core.store.threads.sessions(t.id);
  assert.equal(sessions.length, 1, "one conversation with Vera");
  assert.equal(sessions[0]?.session, "vera");
});
